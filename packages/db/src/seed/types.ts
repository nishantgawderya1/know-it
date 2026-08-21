import type {
  AuditStrategy,
  FetchType,
  SourceKind,
  SourceRole,
  SourceType,
  Vertical,
} from '@knowit/core';

/**
 * A registry row as written in the seed files.
 *
 * Only `slug`, `name`, `vertical`, `sourceType`, `fetchType` and `feedUrl` are required;
 * everything else has a sensible default in `toInsert`. Keeping the seed terse matters —
 * this file is read and edited by humans far more often than it is executed.
 */
export interface SeedSource {
  /** Stable key. Changing it creates a new source rather than updating the existing one. */
  slug: string;
  name: string;
  vertical: Vertical;
  sourceType: SourceType;
  fetchType: FetchType;
  feedUrl: string;

  sourceKind?: SourceKind;
  sourceRole?: SourceRole;
  indexUrl?: string;
  /** Regex matching this source's article URLs on its index page. Required for `scrape`. */
  indexLinkPattern?: string;
  /** Treat URL paths as case-insensitive. Enable for IIS/ASP.NET hosts. */
  lowercaseUrlPath?: boolean;
  auditStrategy?: AuditStrategy;

  activeHoursTz?: string;
  activeStartHour?: number;
  activeEndHour?: number;
  activeIntervalMin?: number;
  offIntervalMin?: number;

  /** Override the default bot User-Agent for this source only. See sources.user_agent. */
  userAgent?: string;
  reliabilityWeight?: number;
  isFullText?: boolean;
  isActive?: boolean;
  topics?: string[];
  notes?: string;
}

/** Indian market hours plus a margin either side — when regulators and exchanges publish. */
export const IST_BUSINESS = {
  activeHoursTz: 'Asia/Kolkata',
  activeStartHour: 9,
  activeEndHour: 19,
} as const;

/** Indian outlets publish from early morning to late evening IST. */
export const IST_EXTENDED = {
  activeHoursTz: 'Asia/Kolkata',
  activeStartHour: 6,
  activeEndHour: 23,
} as const;

/** Global tech publishes around the clock, weighted to US working hours. */
export const US_WEIGHTED = {
  activeHoursTz: 'America/New_York',
  activeStartHour: 8,
  activeEndHour: 22,
} as const;
