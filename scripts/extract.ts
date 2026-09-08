import 'dotenv/config';
import OpenAI from 'openai';
import { SCHEMA, RECONCILE_SCHEMA } from '../src/schemas/notification.schema.js';
import { prisma } from '../src/db.js';

const openai = new OpenAI();
//TODO SPLIT PROMPT and the chunking to differerctn so the file be more clear ad all
const SYSTEM_PROMPT =
  'This is one section of a long Indian government job notification with a lot of ' +
  'boilerplate mixed in. Find and extract only the details that determine whether a ' +
  'candidate is eligible for each post mentioned IN THIS SECTION. If this section has ' +
  'no post details (e.g. it is a cover page or instructions-only section), return an ' +
  'empty posts array — do not invent posts. ' +
  'For minEducationLevel, classify the stated requirement into the closest bucket ' +
  '(e.g. "Bachelor\'s Degree" -> BACHELORS); use null if the requirement is too specific ' +
  'or unusual to classify confidently — do not guess. ' +
  "For postGroup, use the post's stated classification (e.g. \"Group 'B' Gazetted\" -> B). " +
  'A general age-relaxation table (years granted per category like SC/ST/OBC/EWS/PwBD) is ' +
  'included below for reference — apply those same values to every post in this section as ' +
  'the default, unless a post\'s own paragraph explicitly grants different or additional ' +
  'relaxation. ' +
  'Use null for anything else not explicitly stated in the text — never guess or infer a default.';

// Character size per chunk, with overlap so a post description split across
// a chunk boundary still appears whole in at least one chunk.
const CHUNK_SIZE = 50_000;
const CHUNK_OVERLAP = 3_000;

function splitIntoChunks(text: string): string[] {
  if (text.length <= CHUNK_SIZE) return [text];
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    chunks.push(text.slice(start, start + CHUNK_SIZE));
    start += CHUNK_SIZE - CHUNK_OVERLAP;
  }
  return chunks;
}

// The general relaxation table is usually stated once, early in the document.
// Chunks that don't include it would otherwise extract categoryRelaxationRules
// as null for every post, so we find it once and repeat it in every chunk's
// prompt.
function findRelaxationSection(text: string): string {
  const match = text.match(/relaxation[\s\S]{0,2500}/i);
  return match ? match[0] : '';
}

// Strips punctuation/casing so cosmetic differences (hyphens, extra spaces,
// case) don't count as a real difference — e.g. "Sub Inspector" vs
// "Sub-Inspector" normalize to the same string.
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Generic words that appear across many DIFFERENT Indian government post
// titles (e.g. "Assistant Audit Officer" and "Assistant Section Officer"
// both contain "Assistant" and "Officer") — counting these toward
// similarity causes false positives, since sharing a generic word says
// nothing about whether two posts are actually the same one.
const GENERIC_TITLE_WORDS = new Set([
  'assistant',
  'officer',
  'inspector',
  'sub',
  'senior',
  'junior',
  'section',
  'grade',
  'department',
  'ministry',
  'central',
  'state',
  'of',
  'the',
  'and',
  'for',
]);

// Cheap, deterministic pre-filter: only worth spending an LLM call on
// duplicate-checking if at least one pair of (already normalize-deduped)
// names shares most of their DISTINCTIVE words — e.g. "Auditor" and
// "Auditor Offices under C&AG" share the word "auditor". Generic filler
// words are excluded so "Assistant Audit Officer" vs "Assistant Section
// Officer" doesn't falsely count as similar just because both contain
// "Assistant" and "Officer".
function hasSimilarNamePair(posts: ExtractedPost[]): boolean {
  const wordSets = posts.map(
    (p) =>
      new Set(
        normalizeName(p.postName)
          .split(' ')
          .filter((word) => word && !GENERIC_TITLE_WORDS.has(word)),
      ),
  );

  for (let i = 0; i < wordSets.length; i++) {
    for (let j = i + 1; j < wordSets.length; j++) {
      const [a, b] = [wordSets[i], wordSets[j]];
      const shared = [...a].filter((word) => b.has(word)).length;
      const overlapRatio = shared / Math.min(a.size, b.size);
      if (overlapRatio >= 0.5) return true;
    }
  }
  return false;
}

interface ExtractedPost {
  postName: string;
  postGroup: 'A' | 'B' | 'C' | 'D' | null;
  payLevel: string | null;
  minAge: number | null;
  maxAge: number | null;
  educationRequired: string | null;
  minEducationLevel:
    'TENTH' | 'TWELFTH' | 'DIPLOMA' | 'BACHELORS' | 'MASTERS' | 'PHD' | null;
  minMarksPercent: number | null;
  categoryRelaxationApplies: boolean | null;
  categoryRelaxationRules: Record<string, number | null>;
}

// Second, cheap pass over just the post NAMES (tiny input compared to the
// raw document) to flag near-duplicates the exact-string dedup missed —
// e.g. "Sub Inspector" vs "Sub-Inspector" from overlapping chunks. This
// NEVER deletes a post: a wrongly-merged pair would silently hide a real
// job forever, which is worse than an occasional duplicate card showing up
// — so a wrong call here only costs a log line to check manually, never
// lost data. Uses the full gpt-4o model (not -mini) since the input is tiny
// and this judgment call benefits from a stronger model.
async function flagDuplicatePosts(posts: ExtractedPost[]): Promise<void> {
  if (posts.length < 2) return;

  const nameList = posts.map((p, i) => `${i}: ${p.postName}`).join('\n');

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    temperature: 0,
    messages: [
      {
        role: 'system',
        content:
          'You are given a numbered list of post/job names extracted from the same ' +
          'government job notification, possibly with wording differences from being ' +
          'read out of overlapping sections of the source document. Some entries may be ' +
          'the exact same real post written differently (spelling, spacing, punctuation, ' +
          'or a shortened vs full name for the same post). Entries naming a DIFFERENT ' +
          'department, office, or cadre (e.g. "Auditor (Offices under C&AG)" vs "Auditor ' +
          '(Offices under CGDA)") are genuinely different posts and must NOT be grouped ' +
          'together. If unsure whether two entries are the same post, do not group them. ' +
          'Group only indices that refer to the exact same real post. For each group of ' +
          '2 or more, pick the most complete/specific name as keepIndex. Do not include ' +
          'posts that have no duplicate in any group.',
      },
      { role: 'user', content: nameList },
    ],
    response_format: { type: 'json_schema', json_schema: RECONCILE_SCHEMA },
  });

  const { duplicateGroups } = JSON.parse(
    response.choices[0].message.content!,
  ) as { duplicateGroups: { keepIndex: number; duplicateIndices: number[] }[] };

  for (const group of duplicateGroups) {
    const names = [group.keepIndex, ...group.duplicateIndices]
      .filter((v, i, arr) => arr.indexOf(v) === i)
      .map((i) => posts[i].postName);
    if (names.length > 1) {
      console.log(
        `[Possible duplicate — verify manually, not auto-merged] ${names.join(' | ')}`,
      );
    }
  }
}

interface ExtractedNotification {
  jobName: string;
  applyStartDate: string | null;
  applyEndDate: string | null;
  postsSeenInThisSection: number | null;
  posts: ExtractedPost[];
}

export async function extractNotification(rawText: string, sourceId: string) {
  const chunks = splitIntoChunks(rawText);
  const relaxationSection = findRelaxationSection(rawText);

  let jobName = '';
  let applyStartDate: string | null = null;
  let applyEndDate: string | null = null;
  let totalPostsSeen = 0;
  const allPosts: ExtractedPost[] = [];

  // Sequential, not parallel: keeps memory/rate-limit usage low and matches
  // a single append-only pass over the document.
  for (const [i, chunk] of chunks.entries()) {
    const userContent = relaxationSection
      ? `General age relaxation table (for reference):\n${relaxationSection}\n\n---\n\n${chunk}`
      : chunk;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userContent },
      ],
      response_format: { type: 'json_schema', json_schema: SCHEMA },
    });

    const chunkData: ExtractedNotification = JSON.parse(
      response.choices[0].message.content!,
    );

    // jobName/dates are usually only stated once — keep the first non-empty
    // values seen across chunks.
    if (!jobName && chunkData.jobName) jobName = chunkData.jobName;
    if (!applyStartDate) applyStartDate = chunkData.applyStartDate;
    if (!applyEndDate) applyEndDate = chunkData.applyEndDate;
    allPosts.push(...chunkData.posts);
    totalPostsSeen += chunkData.postsSeenInThisSection || 0;
    console.log(
      `[Chunk ${i + 1}/${chunks.length}] LLM saw ${chunkData.postsSeenInThisSection} post(s), extracted ${chunkData.posts.length} — running total seen: ${totalPostsSeen}`,
    );
  }

  // Overlapping chunk boundaries can extract the same post twice, sometimes
  // with cosmetic differences (hyphens, extra spaces, casing) — e.g.
  // "Sub Inspector" vs "Sub-Inspector". Stripping punctuation/whitespace
  // catches these deterministically, for free, before the LLM even needs to
  // look at what's left.
  const seen = new Set<string>();
  const dedupedPosts = allPosts.filter((post) => {
    const key = normalizeName(post.postName);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Only spend an LLM call checking for duplicates if something actually
  // looks worth checking — most runs won't need it at all.
  if (hasSimilarNamePair(dedupedPosts)) {
    await flagDuplicatePosts(dedupedPosts);
  }

  // Completeness check: if fewer unique posts survived than the LLM reported
  // seeing across all chunks, something was silently lost (not just
  // deduped) — dedup only ever REMOVES posts, so a shortfall beyond what
  // dedup accounts for means an entire post never made it into any chunk's
  // output at all.
  if (dedupedPosts.length < totalPostsSeen) {
    console.warn(
      `[Warning] LLM reported seeing ${totalPostsSeen} post(s) total, but only ${dedupedPosts.length} unique post(s) survived extraction. Some posts may be missing — verify manually against the source.`,
    );
  }

  await prisma.post.createMany({
    data: dedupedPosts.map((post) => ({
      ...post,
      sourceId,
    })),
  });

  const jobData: ExtractedNotification = {
    jobName,
    applyStartDate,
    applyEndDate,
    posts: dedupedPosts,
    postsSeenInThisSection: totalPostsSeen,
  };

  console.log(`------------JOBS--------------`);
  console.log(
    jobData.jobName,
    jobData.applyStartDate,
    jobData.applyEndDate,
    `(${dedupedPosts.length} posts)`,
  );
  console.log('------------JOBS--------------');

  return jobData;
}
