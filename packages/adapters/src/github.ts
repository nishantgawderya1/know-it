/**
 * GitHub releases for a tracked set of repositories.
 *
 * 60 requests/hour unauthenticated, 5000 with a token. One request per repo per poll, so
 * the tracked list must be sized against that ceiling — at the default 4-hourly cadence
 * this list stays inside the unauthenticated limit, but adding repos without a token
 * will silently start returning 403s.
 */

import { conditionalGet } from './http.js';
import {
  AdapterError,
  type AdapterSource,
  type ConditionalState,
  type FetchAdapter,
  type FetchContext,
  type FetchResult,
  type FetchedItem,
} from './types.js';

/**
 * Tracked repositories. Kept here rather than in the registry because they are the
 * adapter's configuration, not a source of their own — one registry row covers all of them.
 * Override with GITHUB_TRACKED_REPOS as a comma-separated owner/repo list.
 */
const DEFAULT_REPOS = [
  'facebook/react',
  'vercel/next.js',
  'nodejs/node',
  'microsoft/TypeScript',
  'python/cpython',
  'pytorch/pytorch',
  'kubernetes/kubernetes',
  'postgres/postgres',
];

const RELEASES_PER_REPO = 5;

interface GithubRelease {
  html_url?: string;
  name?: string | null;
  tag_name?: string | null;
  published_at?: string | null;
  body?: string | null;
  draft?: boolean;
  prerelease?: boolean;
  author?: { login?: string | null } | null;
}

export function trackedRepos(): string[] {
  const configured = process.env.GITHUB_TRACKED_REPOS;
  if (!configured) return DEFAULT_REPOS;
  return configured
    .split(',')
    .map((repo) => repo.trim())
    .filter((repo) => repo.length > 0);
}

export const githubAdapter: FetchAdapter = {
  kind: 'github_api',

  async fetch(
    _source: AdapterSource,
    _conditional: ConditionalState,
    context: FetchContext,
  ): Promise<FetchResult> {
    const repos = trackedRepos();
    const items: FetchedItem[] = [];
    const failures: string[] = [];

    for (const repo of repos) {
      const url = `https://api.github.com/repos/${repo}/releases?per_page=${RELEASES_PER_REPO}`;
      const headers: FetchContext = {
        ...context,
        userAgent: context.userAgent,
      };

      try {
        const response = await githubGet(url, headers);
        const releases = JSON.parse(response) as GithubRelease[];
        if (!Array.isArray(releases)) {
          failures.push(`${repo}: unexpected response shape`);
          continue;
        }

        for (const release of releases) {
          if (release.draft || !release.html_url) continue;
          items.push({
            urlRaw: release.html_url,
            title: `${repo} ${release.name?.trim() || release.tag_name || 'release'}`,
            publishedAtRaw: release.published_at ?? null,
            summary: release.body?.trim().slice(0, 2000) ?? null,
            author: release.author?.login ?? null,
          });
        }
      } catch (error: unknown) {
        failures.push(`${repo}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // Partial failure is tolerable; total failure means the token or the limit is the
    // problem and must surface rather than look like a quiet release week.
    if (items.length === 0 && failures.length > 0) {
      throw new AdapterError(
        `github: every tracked repo failed (${failures.slice(0, 3).join('; ')})`,
        'github',
      );
    }

    return { httpStatus: 200, notModified: false, items };
  },
};

async function githubGet(url: string, context: FetchContext): Promise<string> {
  const timeout = AbortSignal.timeout(context.timeoutMs);
  const signal = context.signal ? AbortSignal.any([context.signal, timeout]) : timeout;

  const headers: Record<string, string> = {
    'user-agent': context.userAgent,
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
  };
  if (context.githubToken) headers.authorization = `Bearer ${context.githubToken}`;

  const response = await fetch(url, { headers, signal });
  if (!response.ok) {
    const remaining = response.headers.get('x-ratelimit-remaining');
    const hint = remaining === '0' ? ' (rate limit exhausted — set GITHUB_TOKEN)' : '';
    throw new AdapterError(`HTTP ${response.status}${hint}`, 'http', response.status);
  }
  return response.text();
}
