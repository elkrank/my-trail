import pg from 'pg';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export async function pingDatabase() {
  await pool.query('SELECT 1');
}
