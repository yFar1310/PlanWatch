// server/src/db/pg.ts
import pg from 'pg';                    // ✅ import default
const { Pool } = pg;                    // ✅ destructure

export const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  // ssl: { rejectUnauthorized: false } // (si jamais tu passes en prod managée)
});

export async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS plans (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      expected_minutes INT CHECK (expected_minutes > 0),
      actual_minutes INT CHECK (actual_minutes >= 0),
      due_at TIMESTAMPTZ NOT NULL,
      note TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}
