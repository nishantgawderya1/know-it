/**
 * Registry data with no database attached.
 *
 * Exported separately so tools can read the registry without a connection string — the
 * probe verifies every feed URL against the live network before Supabase exists.
 */
export { financeSources } from './finance.js';
export { techSources } from './tech.js';
export type { SeedSource } from './types.js';

import { financeSources } from './finance.js';
import { techSources } from './tech.js';

export const allSources = [...financeSources, ...techSources];
