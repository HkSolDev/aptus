import { escapeHtml, fact } from './job-html.js';

export function renderReviewedDetails(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  const details = value as Record<string, unknown>;
  const list = (heading: string, rows: unknown) => {
    if (!Array.isArray(rows)) return '';
    const items = rows.filter((row): row is string => typeof row === 'string');
    return items.length
      ? `<section class="panel job-detail-section"><h2>${escapeHtml(heading)}</h2><ul>${items.map((row) => `<li>${escapeHtml(row)}</li>`).join('')}</ul></section>`
      : '';
  };
  let salary = '';
  if (
    details.pay &&
    typeof details.pay === 'object' &&
    !Array.isArray(details.pay)
  ) {
    const pay = details.pay as Record<string, unknown>;
    const amount =
      typeof pay.minimum_amount === 'number' ? pay.minimum_amount : null;
    const maximum =
      typeof pay.maximum_amount === 'number' ? pay.maximum_amount : null;
    const range =
      amount === null
        ? null
        : `${amount}${maximum !== null && maximum !== amount ? `–${maximum}` : ''}`;
    salary = `<section class="panel job-detail-section"><h2>Salary</h2><dl class="job-facts">${fact('Amount', range)}${fact('Currency', pay.currency)}${fact('Period', pay.period)}${fact('Conditions', pay.conditions)}</dl></section>`;
  }
  const experience = Array.isArray(details.experience_rules)
    ? details.experience_rules.flatMap((row) => {
        if (!row || typeof row !== 'object' || Array.isArray(row)) return [];
        const rule = row as Record<string, unknown>;
        if (typeof rule.minimum_years !== 'number') return [];
        return [
          `${rule.minimum_years} years — ${typeof rule.conditions === 'string' ? rule.conditions : 'Verify applicability in the source'}`,
        ];
      })
    : [];
  return (
    salary +
    list('Experience requirements', experience) +
    list('How to apply', details.application_steps) +
    list('Required documents', details.documents_required) +
    list('Additional details', details.other_requirements)
  );
}
