import type { Context } from 'hono';
import { z } from 'zod';
import { getMongoDb } from '../db/mongo.js';

const qSchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

export default async function activityHandler(c: Context) {
  const qp = qSchema.parse(Object.fromEntries(new URL(c.req.url).searchParams));
  const db = await getMongoDb();

  const docs = await db
    .collection('events')
    .find({})
    .sort({ at: -1 })
    .limit(qp.limit)
    .toArray();

  const items = docs.map((d: any) => ({
    id: d._id?.toString(),
    type: d.type,
    at: d.at instanceof Date ? d.at.toISOString() : d.at,
    planId: d.planId ?? null,
    dependsOn: d.dependsOn ?? (d.payload?.dependsOn ?? null),
  }));

  return c.json({ items });
}
