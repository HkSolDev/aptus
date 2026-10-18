import fs from 'node:fs/promises';
import { getPublicJob } from './public-jobs.js';
import { displayDate, documentLink, escapeHtml, fact } from './job-html.js';
import { renderJobRules } from './render-job-rules.js';
import { renderReviewedDetails } from './render-reviewed-details.js';

export async function renderJob(
  id: string,
): Promise<{ status: number; html: string }> {
  const template = await fs.readFile(
    new URL('../../public/job.html', import.meta.url),
    'utf-8',
  );
  const page = (status: number, title: string, content: string) => ({
    status,
    html: template
      .replaceAll('<!-- title -->', () => escapeHtml(title))
      .replace('<!-- content -->', () => content),
  });
  try {
    const job = await getPublicJob(id);
    if (!job)
      return page(
        404,
        'Job not found',
        '<p>This post may have been replaced when its notification was updated. <a href="/#jobs">Browse current saved jobs</a>.</p>',
      );
    const source = job.source;
    const links = [
      documentLink('Source notification', source.url),
      documentLink('Notification PDF', source.notificationPdfUrl),
      documentLink('Official website', source.officialSiteUrl),
      documentLink('Application website', source.applyUrl),
    ].join('');
    return page(
      200,
      job.postName,
      `
      <p class="small muted">${escapeHtml(source.name)} · Collected ${escapeHtml(displayDate(source.fetchedAt))}</p>
      <p class="notice">Stored notification details, not an eligibility guarantee. Missing fields need manual verification. Check the source for updates and application status.</p>
      <div class="job-detail-grid"><section class="panel"><h2>At a glance</h2><dl class="job-facts">
        ${fact('Application deadline', displayDate(job.applicationLastDate))}${fact('Vacancies', job.vacancies)}
        ${fact('Pay level', job.payLevel)}${fact('Post group', job.postGroup)}
        ${fact('Minimum age', job.minAge)}${fact('Maximum age', job.maxAge)}
        ${fact('Age reference date', displayDate(job.ageAsOnDate))}
        ${fact('Category relaxation', job.categoryRelaxationApplies === null ? null : job.categoryRelaxationApplies ? 'Applies; verify conditions below' : 'Does not apply')}
      </dl></section><section class="panel"><h2>Qualification</h2>
        <p class="qualification-text">${escapeHtml(job.educationRequired)}</p><dl class="job-facts">
        ${fact('Minimum education level', job.minEducationLevel)}${fact('Minimum marks (%)', job.minMarksPercent)}
      </dl></section></div>
      <section class="panel job-detail-section"><h2>Detailed saved requirements</h2>${renderJobRules(job.eligibilityRules)}</section>
      ${renderReviewedDetails(job.reviewedDetails)}
      ${
        job.categoryRelaxationRules
          ? `<section class="panel job-detail-section"><h2>Saved category relaxation</h2><p class="small muted">Years recorded per category. Verify applicability and conditions in the source.</p><dl class="job-facts">${
              Object.entries(job.categoryRelaxationRules)
                .filter(([, value]) => typeof value === 'number')
                .map(([category, years]) => fact(category, `${years} years`))
                .join('') || fact('Relaxation', null)
            }</dl></section>`
          : ''
      }
      <section class="panel job-detail-section"><h2>Documents &amp; application</h2>
        <p class="muted">Links were collected from the notification page. Check the destination before entering personal information or paying a fee.</p>
        <div class="job-actions">${links || '<p>No usable source links saved.</p>'}</div>
      </section><p class="job-detail-section"><a class="button" href="/#profile">Check matches with my profile →</a></p>`,
    );
  } catch {
    return page(
      503,
      'Job temporarily unavailable',
      '<p>Please try again shortly. <a href="">Reload this job</a> or <a href="/#jobs">browse jobs</a>.</p>',
    );
  }
}
