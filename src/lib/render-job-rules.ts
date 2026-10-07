import { isEligibilityRules } from '../schemas/eligibility-rules.js';
import { escapeHtml, fact } from './job-html.js';

export function renderJobRules(value: unknown): string {
  if (!isEligibilityRules(value))
    return '<p class="muted">Detailed conditions are not available. Verify the original notification.</p>';
  return `<dl class="job-facts">
    ${fact('Gender requirement', value.gender_requirement)}
    ${fact('Category requirement', value.category_requirement.length ? value.category_requirement.join(', ') : null)}
    ${fact('Relaxation combination', value.relaxation_combination_rule)}
  </dl>
  <h3>Education alternatives</h3>
  ${
    value.education_options.length
      ? value.education_options
          .map(
            (option, index) => `<section class="rule-block">
    <h4>Option ${index + 1}</h4><dl class="job-facts">
      ${fact('Qualification', option.qualification)}${fact('Minimum level', option.minimum_level)}
      ${fact('Minimum marks (%)', option.minimum_marks_percent)}${fact('Subject', option.subject_requirement)}
      ${fact('Conditions', option.conditions)}
    </dl></section>`,
          )
          .join('')
      : '<p class="muted">No detailed education alternatives saved.</p>'
  }
  <h3>Age conditions</h3>
  ${
    value.age_rules.length
      ? value.age_rules
          .map(
            (rule, index) => `<section class="rule-block">
    <h4>Rule ${index + 1}</h4><dl class="job-facts">
      ${fact('Gender', rule.gender)}${fact('Category', rule.category)}
      ${fact('Minimum age', rule.min_age)}${fact('Maximum age', rule.max_age)}
      ${fact('Relaxation (years)', rule.relaxation_years)}${fact('Conditions', rule.conditions)}
    </dl></section>`,
          )
          .join('')
      : '<p class="muted">No detailed age rules saved.</p>'
  }
  <p class="small muted">${escapeHtml('These are extracted conditions, not a verdict on your eligibility. Verify them at the source.')}</p>`;
}
