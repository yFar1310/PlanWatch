import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

/** Runtime compatibility probe only; the weekly report template comes in a later milestone. */
export async function createPdfProbe() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([595.28, 841.89]);
  page.drawText('PlanWatch 2.0', { x: 48, y: 760, size: 24, font, color: rgb(0.25, 0.2, 0.5) });
  page.drawText('PDF generation works inside the Workers runtime.', { x: 48, y: 720, size: 12, font });
  doc.setTitle('PlanWatch runtime compatibility check');
  return doc.save();
}
