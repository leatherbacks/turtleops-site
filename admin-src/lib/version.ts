export const APP_VERSION = '1.0.0';

export const VERSION_HISTORY = [
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
