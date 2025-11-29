// server/src/routes/activity.ts
import type { Context } from 'hono';
import type { JWTPayload } from '../middlewares/auth.js';
import { getMongoDb } from '../db/mongo.js';

export default async function activityHandler(c: Context) {
  const auth = c.get('user') as JWTPayload | undefined;
  if (!auth) {
    return c.json({ ok: false, error: 'unauthorized' }, 401);
  }

  const url = new URL(c.req.url);
  const limit = Math.min(Number(url.searchParams.get('limit') ?? '20'), 100);
  const beforeStr = url.searchParams.get('before');
  const before = beforeStr ? new Date(beforeStr) : new Date();

  const db = await getMongoDb();

  const cursor = db
    .collection('events')
    .find({
      userId: auth.userId,          // ⬅️ très important
      at: { $lt: before },
    })
    .sort({ at: -1 })
    .limit(limit + 1);

  const docs = await cursor.toArray();
  const hasMore = docs.length > limit;

  const slice = hasMore ? docs.slice(0, limit) : docs;

  const items = slice.map((doc: any) => ({
    id: String(doc._id),
    type: doc.type,                // 'plan_submitted' | 'plan_updated' | 'plan_deleted'
    at: doc.at,
    planId: doc.planId,
    dependsOn: doc.dependsOn ?? null,
    title: doc.payload?.title ?? `Plan #${doc.planId}`,
  }));

  const nextCursor =
    hasMore && docs[limit]?.at ? docs[limit].at.toISOString() : null;

  return c.json({ items, nextCursor });
}
