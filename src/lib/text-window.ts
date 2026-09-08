export interface TextWindowOptions {
  charsBefore?: number;
  charsAfter?: number;
  fallbacks?: Array<string | RegExp>;
  fallbackToStart?: boolean;
}

export function extractTextWindow(
  text: string,
  target: string | RegExp,
  options: TextWindowOptions = {},
): string {
  const {
    charsBefore = 0,
    charsAfter = 3000,
    fallbacks = [],
    fallbackToStart = false,
  } = options;

  const candidates = [target, ...fallbacks];

  for (const candidate of candidates) {
    let index = -1;
    if (typeof candidate === 'string') {
      index = text.toLowerCase().indexOf(candidate.toLowerCase());
    } else {
      const match = text.match(candidate);
      if (match && match.index !== undefined) {
        index = match.index;
      }
    }

    if (index !== -1) {
      const start = Math.max(0, index - charsBefore);
      const end = Math.min(text.length, index + charsAfter);
      return text.slice(start, end);
    }
  }

  return fallbackToStart ? text.slice(0, charsBefore + charsAfter) : '';
}
