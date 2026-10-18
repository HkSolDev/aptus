import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  JobDetailContent,
  type JobDetailData,
} from '../components/jobs/job-detail-content.tsx';

const completeJob: JobDetailData = {
  id: 'review-technical-assistant',
  postName: 'Technical Assistant — Physics and Electronics',
  organization: 'Example Public Research Institute',
  applicationLastDate: '2026-11-30',
  educationRequired:
    'BSc in Physics with 60% marks OR Diploma in Electronics with 50% marks and 3 years of relevant experience.',
  vacancies: 120,
  payLevel: 'Level 4',
  postGroup: 'Group C',
  minAge: 18,
  maxAge: 30,
  ageAsOnDate: '2026-11-01',
  categoryRelaxationApplies: true,
  designReview: true,
  categoryRelaxationRules: { SC: 5, OBC: 3 },
  eligibilityRules: {
    gender_requirement: 'Applicants of all genders can apply.',
    category_requirement: ['General / UR', 'SC'],
    education_options: [
      {
        minimum_level: 'BACHELOR',
        minimum_marks_percent: 60,
        qualification: 'BSc in Physics',
        conditions: 'Degree from a recognized university.',
      },
      {
        minimum_level: 'DIPLOMA',
        minimum_marks_percent: 50,
        qualification: 'Diploma in Electronics',
        conditions: 'Three years of relevant experience required.',
      },
    ],
    age_rules: [
      {
        category: 'SC',
        min_age: 18,
        max_age: 35,
        relaxation_years: 5,
      },
    ],
  },
  source: {
    fetchedAt: '14 Oct 2026, 2:00 PM',
  },
};

test('renders complete job details with linked requirements and application actions', () => {
  const markup = renderToStaticMarkup(
    createElement(JobDetailContent, { job: completeJob }),
  );

  assert.match(markup, /Technical Assistant — Physics and Electronics/);
  assert.match(markup, /Example Public Research Institute/);
  assert.match(markup, /Qualification routes/);
  assert.match(markup, /Diploma in Electronics/);
  assert.match(markup, /Age requirements and relaxations/);
  assert.match(markup, /Applicant requirements/);
  assert.match(markup, /Vacancies and pay/);
  assert.match(markup, /Application portal/);
  assert.match(markup, /Save job/);
  assert.match(markup, /Bachelor’s degree/);
  assert.match(markup, /Preview only/);
  assert.match(markup, /Collection date is not a verification date/);
  assert.doesNotMatch(markup, /example\.invalid/);
});

test('does not render unsafe recruitment links or empty-field placeholders', () => {
  const markup = renderToStaticMarkup(
    createElement(JobDetailContent, {
      job: {
        id: 'incomplete',
        postName: 'Incomplete notice',
        source: { notificationPdfUrl: 'javascript:alert(1)' },
      },
    }),
  );

  assert.match(markup, /Qualification details unavailable/);
  assert.match(markup, /Age requirements unavailable/);
  assert.doesNotMatch(markup, /javascript:/);
  assert.doesNotMatch(markup, /Not specified/);
});
