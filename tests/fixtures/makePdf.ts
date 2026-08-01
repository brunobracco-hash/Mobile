import { PDFDocument, StandardFonts } from 'pdf-lib';

/**
 * Gera um PDF simples em memória para os testes de extração.
 * Cada item de `pages` vira uma página; cada string do array vira uma linha.
 */
export async function makePdf(pages: string[][], options?: { title?: string }): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  if (options?.title) pdf.setTitle(options.title);
  const font = await pdf.embedFont(StandardFonts.Helvetica);

  for (const lines of pages) {
    const page = pdf.addPage([595, 842]); // A4
    let y = 780;
    for (const line of lines) {
      page.drawText(line, { x: 56, y, size: 12, font });
      y -= 20;
    }
  }

  return pdf.save();
}

export function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}
