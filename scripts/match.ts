import 'dotenv/config';
import { prisma } from '../src/db.js';

const EDUCATION_ORDER = ['TENTH', 'TWELFTH', 'DIPLOMA', 'BACHELORS', 'MASTERS', 'PHD'];

// Dummy user for now — this will become the web form input later.
const user = {
  dob: new Date('2000-05-15'),
  educationLevel: 'BACHELORS',
  category: 'OBC', // one of: SC, ST, OBC, EWS, PwBD, or null for General
};

function ageOn(dob: Date, asOf = new Date()): number {
  let age = asOf.getFullYear() - dob.getFullYear();
  const hadBirthdayThisYear =
    asOf.getMonth() > dob.getMonth() ||
    (asOf.getMonth() === dob.getMonth() && asOf.getDate() >= dob.getDate());
  if (!hadBirthdayThisYear) age -= 1;
  return age;
}

async function main() {
  const userAge = ageOn(user.dob);
  const userEducationRank = EDUCATION_ORDER.indexOf(user.educationLevel);

  const posts = await prisma.post.findMany({ include: { source: true } });

  const matches = posts.filter((post) => {
    const relaxation =
      (post.categoryRelaxationRules as Record<string, number | null> | null)?.[user.category] ?? 0;
    const effectiveMaxAge = post.maxAge !== null ? post.maxAge + relaxation : null;

    const ageOk =
      (post.minAge === null || userAge >= post.minAge) &&
      (effectiveMaxAge === null || userAge <= effectiveMaxAge);

    const educationOk =
      post.minEducationLevel === null ||
      userEducationRank >= EDUCATION_ORDER.indexOf(post.minEducationLevel);

    return ageOk && educationOk;
  });

  console.log(`User: age ${userAge}, ${user.educationLevel}, category ${user.category}`);
  console.log(`Eligible for ${matches.length} of ${posts.length} posts:\n`);

  for (const post of matches) {
    console.log(`- ${post.postName} (${post.source.name}) -> ${post.source.url}`);
  }
}

main()
  .catch((err) => {
    console.error('[Error]', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
