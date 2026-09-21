// Character size per chunk, with overlap so a post description split across
// a chunk boundary still appears whole in at least one chunk.
export const CHUNK_SIZE = 50_000;
export const CHUNK_OVERLAP = 3_000;

export function splitIntoChunks(text: string): string[] {
  if (text.length <= CHUNK_SIZE) return [text];
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    chunks.push(text.slice(start, start + CHUNK_SIZE));
    start += CHUNK_SIZE - CHUNK_OVERLAP;
  }
  return chunks;
}

// Strips punctuation/casing so cosmetic differences (hyphens, extra spaces,
// case) don't count as a real difference — e.g. "Sub Inspector" vs
// "Sub-Inspector" normalize to the same string.
export function normalizeName(name: string): string {
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
export const GENERIC_TITLE_WORDS = new Set([
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
export function hasSimilarNamePair(
  posts: Array<{ postName: string }>,
): boolean {
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
