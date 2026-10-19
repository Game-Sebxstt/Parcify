import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import type { Config } from './config.js';

export type Db = PrismaClient;

export function createDb(config: Pick<Config, 'databaseUrl' | 'databasePoolMax'>): Db {
  const adapter = new PrismaPg({
    connectionString: config.databaseUrl,
    max: config.databasePoolMax,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
  });
  return new PrismaClient({ adapter });
}

export async function pingDb(db: Db): Promise<void> {
  await db.$queryRaw`SELECT 1`;
}
