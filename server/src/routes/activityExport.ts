// server/src/routes/activityExport.ts
import type { Context } from 'hono';
import PDFDocument from 'pdfkit';
import { getMongoDb } from '../db/mongo.js';
import type { JWTPayload } from '../middlewares/auth.js';

export default async function activityExportHandler(c: Context) {
  try {
    const user = c.get('user') as JWTPayload | undefined;
    if (!user) {
      return c.json({ ok: false, error: 'unauthorized' }, 401);
    }

    const db = await getMongoDb();

    const events = await db
      .collection('events')
      .find({
        $or: [{ userId: user.userId }, { userId: { $exists: false } }],
      })
      .sort({ at: -1 })
      .toArray();

    const pdfBuffer = await new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({
        size: 'A4',
        margin: 40,
      });

      const chunks: Uint8Array[] = [];
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      doc.fontSize(18).text('PlanWatch – Activity log', { align: 'left' });
      doc.moveDown();
      doc
        .fontSize(10)
        .fillColor('#666')
        .text(`Exported at: ${new Date().toLocaleString()}`);
      doc.moveDown();

      if (!events.length) {
        doc.fillColor('#000').fontSize(12).text('No events yet.');
      } else {
        doc.fillColor('#000').fontSize(12);

        for (const e of events) {
          const type =
            e.type === 'plan_submitted'
              ? 'Created'
              : e.type === 'plan_updated'
              ? 'Updated'
              : e.type === 'plan_deleted'
              ? 'Deleted'
              : String(e.type);

          const when = e.at ? new Date(e.at).toLocaleString() : 'n/a';
          const planId = e.planId != null ? `Plan #${e.planId}` : 'Unknown plan';

          doc.font('Helvetica-Bold').text(`${type} – ${planId}`);
          doc.font('Helvetica').fontSize(10).fillColor('#555').text(when);
          doc.moveDown(0.5);

          doc
            .moveTo(doc.page.margins.left, doc.y)
            .lineTo(doc.page.width - doc.page.margins.right, doc.y)
            .strokeColor('#dddddd')
            .lineWidth(0.5)
            .stroke();
          doc.moveDown(0.5);

          doc.fontSize(12).fillColor('#000');
        }
      }

      doc.end();
    });

    return new Response(pdfBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition':
          'attachment; filename="planwatch-activity.pdf"',
      },
    });
  } catch (e: any) {
    console.error('activityExport error', e);
    return c.json(
      { ok: false, error: 'internal', message: e?.message ?? 'internal_error' },
      500,
    );
  }
}
