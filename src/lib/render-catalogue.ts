import { listPublicJobs, type PublicJob } from './public-jobs.js';
import { displayDate, escapeHtml, fact } from './job-html.js';

function card(job: PublicJob): string {
  return `<article class="job-card catalogue-card">
    <p class="small muted">${escapeHtml(job.source.name)}</p>
    <h3 class="job-title"><a href="/jobs/${encodeURIComponent(job.id)}">${escapeHtml(job.postName)}</a></h3>
    <dl class="job-facts">${fact('Apply by', displayDate(job.applicationLastDate))}${fact('Vacancies', job.vacancies)}</dl>
    <p class="small catalogue-qualification">${escapeHtml(job.educationRequired)}</p>
    <a class="catalogue-open" href="/jobs/${encodeURIComponent(job.id)}">View job details <span aria-hidden="true">→</span></a>
  </article>`;
}

export async function renderCatalogue(
  params: URLSearchParams,
): Promise<string> {
  const raw = params.get('page') ?? '1';
  if (
    !/^[1-9]\d*$/.test(raw) ||
    Number(raw) > 10000 ||
    params.getAll('page').length > 1
  ) {
    return '<p class="notice notice-error">Invalid page. <a href="/#jobs">Return to the first page</a>.</p>';
  }
  try {
    const { data, pagination: p } = await listPublicJobs(Number(raw), 6);
    if (!data.length)
      return `<div class="panel"><h3>${p.totalItems ? 'No jobs on this page' : 'No jobs saved yet'}</h3><p class="muted">${p.totalItems ? '<a href="/#jobs">Return to the first page</a>.' : 'New notifications will appear here after the next successful collection.'}</p></div>`;
    return `<p class="small muted catalogue-count">${p.totalItems} saved posts · Page ${p.page} of ${p.totalPages} · A–Z</p>
      <div class="catalogue-grid">${data.map(card).join('')}</div>
      <nav class="catalogue-pagination" aria-label="Job pages">
        ${p.page > 1 ? `<a class="button button-secondary" rel="prev" href="/?page=${p.page - 1}#jobs">← Previous page</a>` : ''}
        <span class="small">Page ${p.page} of ${p.totalPages}</span>
        ${p.page < p.totalPages ? `<a class="button button-secondary" rel="next" href="/?page=${p.page + 1}#jobs">Next page →</a>` : ''}
      </nav>`;
  } catch {
    return '<div class="notice notice-error"><p>Jobs are temporarily unavailable. Your profile form is still available below.</p><a class="catalogue-open" href="/#jobs">Retry loading jobs →</a></div>';
  }
}
