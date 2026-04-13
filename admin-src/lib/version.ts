export const APP_VERSION = '1.1.0';

export const VERSION_HISTORY = [
  {
    version: '1.1.0',
    date: '2026-04-13',
    changes: [
      'Lighthouse performance score: 80 → 100, CLS: 0.4 → 0',
      'Fix auth state flickering causing intermittent data loss on navigation',
      'Fix header search broken by stale orgId in callback',
      'Fix nesting_status 400 error (wrong column name)',
      'Remove Conservation Metrics section, simplify dashboard layout',
      'Stable layout shell renders immediately, content gates on auth',
    ],
  },
  {
    version: '1.0.0',
    date: '2026-04-12',
    changes: [
      'Add org_id tenant isolation to all database queries',
      'Optimize dashboard performance: parallel queries, stats caching, reduced payloads',
      'Add observation map with GPS filtering and 500-record limit',
      'Fix layout shifts for improved Lighthouse performance score',
      'Switch observation queries to LEFT joins to prevent silent data loss',
    ],
  },
];
