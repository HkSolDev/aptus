import 'dotenv/config';
import { prisma } from './db.js';
import { extractNotification } from '../scripts/extract.js';
import { pdfWordExtractor } from '../scripts/day1-fetch-ssc-pdf.js';

async function main() {
  try {
    const { fullText, sourceId, unchanged } = await pdfWordExtractor();

    // Source hasn't changed since last run — skip the paid LLM call entirely.
    if (unchanged) {
      console.log(`[Skip] Source ${sourceId} unchanged, nothing to extract.`);
      return;
    }

    const resultData = await extractNotification(fullText, sourceId);

    console.log('-------DATA------');
    console.log(resultData);
  } catch (error) {
    console.error(error);
  }
}

// Only run the pipeline when this file is executed directly, not when
// another script imports from it (e.g. for the prisma client).
if (import.meta.url === `file://${process.argv[1]}`) {
  main()
    .catch((error) => {
      console.error(error);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
