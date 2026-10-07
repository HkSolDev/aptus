// Source text is untrusted, even after database storage. Escape text and attributes.
export function escapeHtml(value: unknown): string {
  return String(value ?? 'Not specified').replace(
    /[&<>"']/g,
    (char) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[char]!,
  );
}

export function displayDate(date: Date | null): string {
  return date
    ? new Intl.DateTimeFormat('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(date)
    : 'Not specified';
}

export function fact(label: string, value: unknown): string {
  return `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`;
}

export function documentLink(label: string, rawUrl: string | null): string {
  try {
    const url = new URL(rawUrl ?? '');
    if (
      !['https:', 'http:'].includes(url.protocol) ||
      url.username ||
      url.password
    )
      return '';
    return `<a class="button button-secondary" href="${escapeHtml(url.href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)} <span aria-hidden="true">↗</span></a>`;
  } catch {
    return '';
  }
}
