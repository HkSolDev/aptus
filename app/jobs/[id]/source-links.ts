export interface JobSource {
  url?: string | null;
  notificationPdfUrl?: string | null;
  officialSiteUrl?: string | null;
  applyUrl?: string | null;
}

export interface SourceLink {
  label: string;
  url: string;
}

function safeHttpUrl(value: string | null | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:'
      ? url.href
      : null;
  } catch {
    return null;
  }
}

export function getSourceLinks(source: JobSource): SourceLink[] {
  const candidates = [
    ['View source page', source.url],
    ['Official notification', source.notificationPdfUrl],
    ['Official website', source.officialSiteUrl],
    ['Apply online', source.applyUrl],
  ] as const;
  const seen = new Set<string>();

  return candidates.flatMap(([label, value]) => {
    const url = safeHttpUrl(value);
    if (!url || seen.has(url)) return [];
    seen.add(url);
    return [{ label, url }];
  });
}
