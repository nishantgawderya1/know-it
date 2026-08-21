// Next only reads a .env sitting beside the app, but the worker, drizzle and this app all
// share one connection string at the repo root. Loading it here keeps a single .env for the
// whole monorepo rather than a copy per app that drifts out of sync.
// Real deployments set these as Vercel environment variables and this file finds nothing.
try {
  process.loadEnvFile(new URL('../../.env', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
} catch {
  // No root .env — expected on Vercel, where the values arrive as real env vars.
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Workspace packages ship TypeScript source rather than a build step, so Next compiles
  // them alongside the app. One fewer build to keep in sync for a two-person team.
  transpilePackages: ['@knowit/core', '@knowit/db', '@knowit/adapters'],
  // The workspace packages are TypeScript ESM: they import each other with explicit `.js`
  // specifiers, which is what Node requires but points at files a bundler cannot find,
  // since only the `.ts` exists. This maps one onto the other. Without it the build fails
  // on `Can't resolve './client.js'` while `tsc` passes, because tsc resolves those itself.
  //
  // Neither bundler does this by default, and Turbopack has no equivalent of
  // `extensionAlias` — which is why the scripts pass `--webpack` explicitly rather than
  // taking Next 16's Turbopack default.
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      '.js': ['.ts', '.tsx', '.js'],
    };
    return config;
  },
  experimental: {
    // The dashboard reads live ingestion state; caching it would show stale health.
    staleTimes: { dynamic: 0, static: 0 },
  },
};

export default nextConfig;
