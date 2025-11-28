// server/src/middlewares/auth.ts
import type { Context, Next } from 'hono';
import jwt from 'jsonwebtoken';

export const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

export type JWTPayload = {
  userId: number;
  email: string;
};

export async function requireAuth(c: Context, next: Next) {
  const header = c.req.header('Authorization') || '';
  const [type, token] = header.split(' ');

  if (type !== 'Bearer' || !token) {
    return c.json({ ok: false, error: 'unauthorized' }, 401);
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET) as JWTPayload;
    c.set('user', payload);
    await next();
  } catch {
    return c.json({ ok: false, error: 'invalid_token' }, 401);
  }
}
