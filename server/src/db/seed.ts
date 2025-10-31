import dotenv from 'dotenv';
import { pool } from './pg.js';

dotenv.config();

async function seed() {
  const now = new Date();
  const plans = [
    ['Write project proposal', 60, null, new Date(now.getTime() + 24 * 3600 * 1000).toISOString(), 'Initial draft'],
    ['Refactor auth module', 90, 80, new Date(now.getTime() + 3 * 24 * 3600 * 1000).toISOString(), 'Follow security checklist']
  ];

  for (const p of plans) {
    await pool.query(`INSERT INTO plans (title, expected_minutes, actual_minutes, due_at, note) VALUES ($1,$2,$3,$4,$5)` , p);
  }
  console.log('Seed complete');
  await pool.end();
}

seed().catch((e) => { console.error(e); process.exit(1); });
