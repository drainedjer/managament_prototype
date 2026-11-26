/**
 * db.js - Selects PostgreSQL (Neon via DATABASE_URL / POSTGRES_URL) in production or when configured,
 * and falls back to ephemeral in-memory data ONLY in non-production preview/test environments.
 */
function resolveDatabaseUrl() {
  return (
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    process.env.NEON_DATABASE_URL ||
    process.env.DATABASE_URL_UNPOOLED ||
    process.env.POSTGRES_URL_NON_POOLING ||
    ''
  ).trim();
}

const dbUrl = resolveDatabaseUrl();
if (dbUrl && !process.env.DATABASE_URL) {
  process.env.DATABASE_URL = dbUrl;
}

if (dbUrl) {
  module.exports = require('./db-pg');
} else if (process.env.NODE_ENV === 'production' || process.env.VERCEL) {
  const makeConfigError = () => {
    const err = new Error(
      'Database is not configured. Connect Neon Postgres (DATABASE_URL or POSTGRES_URL) in Vercel Environment Variables.'
    );
    err.statusCode = 503;
    return err;
  };
  module.exports = new Proxy(
    {
      isPostgres: () => true,
      async healthCheck() {
        return {
          ok: false,
          db: 'unconfigured',
          error: 'DATABASE_URL / POSTGRES_URL environment variable is not set.',
        };
      },
      async logAudit() {},
    },
    {
      get(target, prop) {
        if (prop in target) return target[prop];
        return async () => {
          throw makeConfigError();
        };
      },
    }
  );
} else {
  console.warn('[db] DATABASE_URL not set — using non-persistent preview/test store. Set DATABASE_URL for Neon Postgres.');
  module.exports = require('./db-mem');
}
