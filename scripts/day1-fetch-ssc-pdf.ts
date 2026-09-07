import fs from 'node:fs/promises';
import path from 'node:path';
import { PDFParse } from 'pdf-parse';
import { prisma } from '../src/db.js';
import crypto from 'node:crypto';
// Official notification PDF for SSC CGL 2026 from ssc.gov.in
const SSC_CGL_2026_PDF_URL =
  'https://ssc.gov.in/api/attachment/uploads/masterData/NoticeBoards/Notice_of_adv_cgl_2026.pdf';

const DOWNLOAD_DIR = path.resolve('downloads');
const LOCAL_PDF_PATH = path.join(DOWNLOAD_DIR, 'ssc-cgl-2026.pdf');


export async function pdfWordExtractor() {
  // 1. Ensure download directory exists
  await fs.mkdir(DOWNLOAD_DIR, { recursive: true });

  // 2. Download PDF if not already cached locally
  let pdfBuffer: Buffer;
  try {
    pdfBuffer = await fs.readFile(LOCAL_PDF_PATH);
    console.log(`[Cache] Loaded existing PDF from ${LOCAL_PDF_PATH}`);
  } catch {
    console.log(`[Download] Fetching SSC CGL 2026 PDF from official portal...`);
    const response = await fetch(SSC_CGL_2026_PDF_URL);

    if (!response.ok) {
      throw new Error(`Failed to download PDF: ${response.status} ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    pdfBuffer = Buffer.from(arrayBuffer);
    await fs.writeFile(LOCAL_PDF_PATH, pdfBuffer);
    console.log(`[Saved] Saved ${pdfBuffer.byteLength} bytes to ${LOCAL_PDF_PATH}`);
  }

  // 3. Extract text from PDF
  console.log('[Parse] Extracting text with pdf-parse...');
  const parser = new PDFParse({ data: pdfBuffer });
  const result = await parser.getText();

  console.log(`[Done] Extracted ${result.text.length} characters across ${result.total} pages.\n`);

  // 4. Print full extracted text to console
  console.log('--- FULL TEXT ---');
  console.log(result.text);
  console.log('--- END OF TEXT ---');


// Keep original case for the LLM — lowercasing destroyed signal like
// category codes (SC/ST) that only make sense in their original casing.
const fullText = result.text;
const rawHash = crypto.createHash('sha256').update(fullText).digest('hex');

const earlierSource = await prisma.source.findFirst({
  where: { url: SSC_CGL_2026_PDF_URL },
});

// Compare hash-to-hash, not hash-to-raw-text, so this actually detects
// "nothing changed" and skips a paid LLM call.
if (earlierSource && earlierSource.rawHash === rawHash) {
  console.log(`[Skip] Unchanged, already extracted as Source ID: ${earlierSource.id}`);
  return { fullText, sourceId: earlierSource.id, unchanged: true };
}

const source = earlierSource
  ? await prisma.source.update({
      where: { id: earlierSource.id },
      data: { rawHash },
    })
  : await prisma.source.create({
      data: {
        name: 'SSC CGL 2026',
        url: SSC_CGL_2026_PDF_URL,
        rawHash,
      },
    });

console.log(`Saved Source ID: ${source.id}`);

return { fullText, sourceId: source.id, unchanged: false };
}

