import { PrismaClient } from '../generated/prisma/index.js';
import { PrismaPg } from '@prisma/adapter-pg'

import { extractNotification } from '../scripts/extract.js';
import { pdfWordExtractor } from '../scripts/day1-fetch-ssc-pdf.js';


 const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
export const prisma = new PrismaClient({adapter});
async function main() {
try {

const {fullText, sourceId, unchanged} = await pdfWordExtractor()

// Source hasn't changed since last run — skip the paid LLM call entirely.
if (unchanged) {
  console.log(`[Skip] Source ${sourceId} unchanged, nothing to extract.`);
  return;
}

const resultData = await extractNotification(fullText, sourceId)

console.log('-------DATA------')
console.log(resultData)









} catch (error) {
  console.error(error);
}
}


main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });