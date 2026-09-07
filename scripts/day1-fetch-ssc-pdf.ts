import fs from 'node:fs/promises';
import path from 'node:path';
import { PDFParse } from 'pdf-parse';

// Official notification PDF for SSC CGL 2026 from ssc.gov.in
const SSC_CGL_2026_PDF_URL =
  'https://ssc.gov.in/api/attachment/uploads/masterData/NoticeBoards/Notice_of_adv_cgl_2026.pdf';

const DOWNLOAD_DIR = path.resolve('downloads');
const LOCAL_PDF_PATH = path.join(DOWNLOAD_DIR, 'ssc-cgl-2026.pdf');

async function main() {
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


  const fullText = result.text.toLowerCase();

  let impText = '';

  const textToCompare = ['eligibility', 'date', 'vacancy', 'job', 'job name', 'age', 'education', 'salary', 'apply', 'exam date', 'result date', 'Name of Post', 'Post',
    'Ministry', 'department', 'Classification of Post', 'Age Limit', 'pay level'
  ]
  
  for (const word of textToCompare) {
    if (fullText.includes(word)) {
      
        const startIndex = fullText.indexOf(word);
        const endIndex = fullText.indexOf(word, startIndex + 1000);
        impText = fullText.slice(startIndex, endIndex);
      };
    }
  

  console.log('------------- IMP TEXT ----------', impText);
}

main().catch((err) => {
  console.error('[Error]', err);
  process.exit(1);
});
