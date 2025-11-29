// server/src/routes/auth.ts
import type { Context } from 'hono';
import { pool } from '../db/pg.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import type { JWTPayload } from '../middlewares/auth.js';
import { JWT_SECRET } from '../middlewares/auth.js';

const profileSchema = z.object({
  fullName: z.string().trim().min(1).max(120).optional(),
  avatarData: z.string().max(200_000).nullable().optional(), // data URL
});

const signupSchema = z.object({
  email: z.string().email().trim(),
  password: z.string().min(8), // tu peux ajuster
  fullName: z.string().trim().min(1).max(120).optional(),
});

// --------- SIGNUP -----------------------------------------------------------

export async function signupHandler(c: Context) {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: 'invalid_json' }, 400);
  }

  const parsed = signupSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ ok: false, error: 'validation_error' }, 400);
  }

  const { email, password, fullName } = parsed.data;
  const normEmail = email.toLowerCase();

  // email déjà utilisé ?
  const existing = await pool.query(
    'SELECT 1 FROM users WHERE email = $1',
    [normEmail],
  );
  if (existing.rows.length) {
    return c.json({ ok: false, error: 'email_taken' }, 409);
  }

  const hash = await bcrypt.hash(password, 10);

  const { rows } = await pool.query(
    `INSERT INTO users (email, password_hash, full_name)
     VALUES ($1, $2, $3)
     RETURNING id, email, full_name, avatar_data`,
    [normEmail, hash, fullName ?? null],
  );

  const user = rows[0];
  try {
    await pool.query(
      `
      INSERT INTO plans (user_id, title, expected_minutes, actual_minutes, due_at, note, depends_on, status)
      VALUES
        ($1, 'Welcome to PlanWatch', 15, NULL, (now() + interval '1 hour')::timestamptz,
             'Quick tour of the dashboard & features.', NULL, 'not_started'),
        ($1, 'Define your focus areas', 30, NULL, (now() + interval '1 day')::timestamptz,
             'List the 3 main areas you want to track (study, work, sports…).', NULL, 'not_started'),
        ($1, 'Plan your next week', 60, NULL, (now() + interval '3 days')::timestamptz,
             'Create a few plans for the upcoming week.', NULL, 'not_started')
      `,
      [user.id],
    );
  } catch (e) {
    console.error('Failed to seed default plans for new user', e);
  }

  const payload: JWTPayload = { userId: user.id, email: user.email };
  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });

  return c.json({
    ok: true,
    token,
    user: {
      id: user.id,
      email: user.email,
      fullName: user.full_name,
      avatarData: user.avatar_data,
    },
  });
}

// --------- LOGIN ------------------------------------------------------------

export async function loginHandler(c: Context) {
  const body = await c.req.json().catch(() => null);
  const email = String(body?.email || '').toLowerCase().trim();
  const password = String(body?.password || '');

  if (!email || !password) {
    return c.json({ ok: false, error: 'missing_credentials' }, 400);
  }

  const { rows } = await pool.query(
    'SELECT id, email, password_hash, full_name, avatar_data FROM users WHERE email = $1',
    [email],
  );

  if (!rows.length) {
    return c.json({ ok: false, error: 'invalid_credentials' }, 401);
  }

  const user = rows[0];
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) {
    return c.json({ ok: false, error: 'invalid_credentials' }, 401);
  }

  const payload: JWTPayload = { userId: user.id, email: user.email };
  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });

  return c.json({
    ok: true,
    token,
    user: {
      id: user.id,
      email: user.email,
      fullName: user.full_name,
      avatarData: user.avatar_data,
    },
  });
}

// --------- ME ---------------------------------------------------------------

export async function meHandler(c: Context) {
  const user = c.get('user') as JWTPayload | undefined;
  if (!user) {
    return c.json({ ok: false, error: 'unauthorized' }, 401);
  }

  const { rows } = await pool.query(
    'SELECT id, email, full_name, avatar_data FROM users WHERE id = $1',
    [user.userId],
  );
  if (!rows.length) {
    return c.json({ ok: false, error: 'not_found' }, 404);
  }

  const u = rows[0];

  return c.json({
    ok: true,
    user: {
      id: u.id,
      email: u.email,
      fullName: u.full_name,
      avatarData: u.avatar_data,
    },
  });
}

// --------- UPDATE PROFILE ---------------------------------------------------

export async function updateProfileHandler(c: Context) {
  const auth = c.get('user') as JWTPayload | undefined;
  if (!auth) {
    return c.json({ ok: false, error: 'unauthorized' }, 401);
  }

  let parsed;
  try {
    const body = await c.req.json();
    parsed = profileSchema.parse(body);
  } catch {
    return c.json({ ok: false, error: 'validation_error' }, 400);
  }

  const updates: string[] = [];
  const vals: any[] = [];
  let i = 1;

  if (parsed.fullName !== undefined) {
    updates.push(`full_name = $${i++}`);
    vals.push(parsed.fullName.trim() || null);
  }
  if (parsed.avatarData !== undefined) {
    updates.push(`avatar_data = $${i++}`);
    vals.push(parsed.avatarData ?? null);
  }

  if (!updates.length) {
    return c.json({ ok: false, error: 'empty_patch' }, 400);
  }

  vals.push(auth.userId);

  const { rows } = await pool.query(
    `UPDATE users
     SET ${updates.join(', ')}
     WHERE id = $${i}
     RETURNING id, email, full_name, avatar_data`,
    vals,
  );

  const u = rows[0];

  return c.json({
    ok: true,
    user: {
      id: u.id,
      email: u.email,
      fullName: u.full_name,
      avatarData: u.avatar_data,
    },
  });
}
