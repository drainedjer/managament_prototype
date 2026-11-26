/**
 * db.js - Selects PostgreSQL (Neon via DATABASE_URL) in production or when configured,
 * and falls back to ephemeral in-memory data ONLY in non-production preview/test environments.
 */
if (!process.env.DATABASE_URL && (process.env.NODE_ENV === 'production' || process.env.VERCEL)) {
  throw new Error('DATABASE_URL environment variable is required in production/Vercel.');
}

if (process.env.DATABASE_URL) {
  module.exports = require('./db-pg');
} else {
  console.warn('[db] DATABASE_URL not set — using non-persistent preview/test store. Set DATABASE_URL for Neon Postgres.');
  module.exports = require('./db-mem');
}
