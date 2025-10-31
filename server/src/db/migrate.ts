import dotenv from 'dotenv';
import { pool } from './pg.js';

dotenv.config();

async function migrate() {
  const create = `
  CREATE TABLE IF NOT EXISTS plans (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    expected_minutes INT CHECK (expected_minutes > 0),
    actual_minutes INT NULL CHECK (actual_minutes >= 0),
    due_at TIMESTAMPTZ NOT NULL,
    note TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  `;

  await pool.query(create);
  console.log('Migration complete');
  await pool.end();
}

migrate().catch((e) => {
  console.error(e);
  process.exit(1);
});
