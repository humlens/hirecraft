import { PrismaClient } from '@prisma/client';
import { tenantGuard } from './tenantGuard';

const createClient = () =>
  new PrismaClient({
    //log: ["error"],
  });

type BaseClient = ReturnType<typeof createClient>;
type GuardedClient = ReturnType<BaseClient['$extends']>;

declare global {
  // allow global `var` declarations
  // eslint-disable-next-line no-var
  var prismaBase: BaseClient | undefined;
}

const base = global.prismaBase || createClient();

if (process.env.NODE_ENV !== 'production') {
  global.prismaBase = base;
}

/**
 * The application Prisma client. Queries on tenant models (see
 * `lib/tenantGuard.ts`) without a `teamId` filter are refused.
 */
export const prisma = base.$extends(tenantGuard) as unknown as BaseClient &
  GuardedClient;

/**
 * Escape hatch that bypasses the tenant guard. Only for platform-level
 * code (platform admin, migrations, retention jobs). Never use it in
 * tenant-facing request handlers.
 */
export const unguardedPrisma: BaseClient = base;
