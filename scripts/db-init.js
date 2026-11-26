require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

async function main() {
  const connStr = (
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    process.env.NEON_DATABASE_URL ||
    ''
  ).trim();
  if (!connStr) {
    console.error('DATABASE_URL (or POSTGRES_URL) is required to run db:init.');
    process.exit(1);
  }
  const pool = new Pool({
    connectionString: connStr,
    ssl: connStr.includes('localhost') || connStr.includes('127.0.0.1')
      ? false
      : { rejectUnauthorized: false },
  });
  const sql = fs.readFileSync(path.join(__dirname, '..', 'database', 'schema.sql'), 'utf8');
  try {
    await pool.query(sql);
    console.log('Database schema initialized successfully.');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('db:init failed:', err.message);
  process.exit(1);
});
