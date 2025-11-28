// server/src/routes/auth.ts
import type { Context } from 'hono';
import { pool } from '../db/pg.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { JWTPayload } from '../middlewares/auth.js';
import { JWT_SECRET } from '../middlewares/auth.js';

export async function loginHandler(c: Context) {
  const body = await c.req.json().catch(() => null);
  const email = String(body?.email || '').toLowerCase().trim();
  const password = String(body?.password || '');

  if (!email || !password) {
    return c.json({ ok: false, error: 'missing_credentials' }, 400);
  }

  const { rows } = await pool.query(
    'SELECT id, email, password_hash FROM users WHERE email = $1',
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
    user: { id: user.id, email: user.email },
  });
}

export async function meHandler(c: Context) {
  const user = c.get('user') as JWTPayload | undefined;
  if (!user) {
    return c.json({ ok: false, error: 'unauthorized' }, 401);
  }
  return c.json({
    ok: true,
    user: { id: user.userId, email: user.email },
  });
}
