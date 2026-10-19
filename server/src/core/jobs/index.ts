import type { Db } from '../db.js';
import type { LogSink } from '../logger.js';
import type { Redis } from '../redis.js';
import type { StorageDriver } from '../storage/index.js';
import { COMPACT_INTERVAL_MS, runCompaction } from './compact.js';
import { purgeOldActivity, purgePendingAssets, runDailyPurge } from './purge.js';
import type { JobDefinition } from './scheduler.js';

export { Scheduler, cronLockKey, type JobDefinition } from './scheduler.js';

const HOUR_MS = 60 * 60_000;
const DAILY = { dailyAtUtc: { hour: 3 } } as const;

export interface JobDeps {
  db: Db;
  redis: Redis;
  logger: LogSink;
  instanceId: string;
}

// Los que solo tocan Postgres y Redis corren siempre en collab.
export function documentJobs(deps: JobDeps): JobDefinition[] {
  return [
    {
      name: 'compact',
      schedule: { everyMs: COMPACT_INTERVAL_MS },
      lockTtlMs: 5 * 60_000,
      run: (signal) => runCompaction(deps, signal),
    },
    {
      name: 'activity-purge',
      schedule: DAILY,
      lockTtlMs: 10 * 60_000,
      run: async () => ({ events: await purgeOldActivity(deps.db) }),
    },
  ];
}

// Los que borran objetos del storage corren donde está el volumen: en la API con `local`, en collab con `s3`.
export function storageJobs(deps: JobDeps & { storage: StorageDriver }): JobDefinition[] {
  return [
    {
      name: 'assets-pending',
      schedule: { everyMs: HOUR_MS },
      lockTtlMs: 10 * 60_000,
      run: async () => ({ assets: await purgePendingAssets(deps) }),
    },
    {
      name: 'purge',
      schedule: DAILY,
      lockTtlMs: 30 * 60_000,
      run: () => runDailyPurge(deps),
    },
  ];
}
