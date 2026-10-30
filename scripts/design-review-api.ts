import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { readJobFilters } from '../frontend/public-job-filters.js';

// Matches the four fictional jobs in the approved HTML reference. No database.
const completeReviewSource = {
  name: 'Fictional design example',
  fetchedAt: '14 Oct 2026, 2:00 PM',
};

const jobs = [
  {
    id: 'review-technical-assistant',
    publishedAt: '2026-10-14',
    postName: 'Technical Assistant — Physics and Electronics',
    organization: 'Example Public Research Institute',
    applicationLastDate: '2026-11-30',
    educationRequired:
      'BSc in Physics with 60% marks OR Diploma in Electronics with 50% marks and 3 years of relevant experience.',
    levels: ['BACHELORS', 'DIPLOMA'],
    vacancies: 120,
    payLevel: 'Level 4',
    postGroup: 'Group C',
    ageAsOnDate: '2026-11-01',
    minAge: 18,
    maxAge: 30,
    minEducationLevel: 'DIPLOMA',
    minMarksPercent: null,
    categoryRelaxationApplies: true,
    categoryRelaxationRules: { SC: 5, ST: 5, OBC: 3, EWS: 0, PwBD: 10 },
    eligibilityRules: {
      gender_requirement: 'Applicants of all genders can apply.',
      category_requirement: ['General / UR', 'SC', 'ST', 'OBC', 'EWS'],
      education_options: [
        {
          minimum_level: 'BACHELOR',
          minimum_marks_percent: 60,
          qualification: 'BSc in Physics',
          subject_requirement: 'Physics as a main subject',
          conditions:
            'Degree from a recognized university. Final results must be declared by the application deadline.',
        },
        {
          minimum_level: 'DIPLOMA',
          minimum_marks_percent: 50,
          qualification: 'Diploma in Electronics',
          subject_requirement: 'Electronics or Electronics and Communication',
          conditions:
            'Diploma from a recognized institution, plus 3 years of relevant laboratory experience after completing the diploma.',
        },
      ],
      age_rules: [
        {
          category: 'General / UR or EWS',
          gender: null,
          min_age: 18,
          max_age: 30,
          relaxation_years: 0,
          conditions: 'Base age limit.',
        },
        {
          category: 'SC or ST',
          gender: null,
          min_age: 18,
          max_age: 35,
          relaxation_years: 5,
          conditions: 'Valid category certificate required.',
        },
        {
          category: 'OBC',
          gender: null,
          min_age: 18,
          max_age: 33,
          relaxation_years: 3,
          conditions:
            'Non-creamy-layer certificate required under the notice conditions.',
        },
        {
          category: 'PwBD',
          gender: null,
          min_age: null,
          max_age: 40,
          relaxation_years: 10,
          conditions:
            'Maximum-only rule. Disability documentation must satisfy the notice.',
        },
        {
          category: null,
          gender: 'Women',
          min_age: null,
          max_age: 32,
          relaxation_years: 2,
          conditions:
            'Maximum-only rule for women applicants, as stated in this fictional notice.',
        },
      ],
      relaxation_combination_rule:
        'Use the single applicable relaxation. Do not add category, disability and gender relaxations together.',
    },
  },
  {
    id: 'review-laboratory-assistant',
    publishedAt: '2026-10-11',
    postName: 'Laboratory Assistant',
    organization: 'Example Public Institute',
    applicationLastDate: null,
    educationRequired: 'Diploma in a relevant subject',
    levels: ['DIPLOMA'],
    vacancies: 12,
    payLevel: null,
  },
  {
    id: 'review-assistant-engineer',
    publishedAt: '2026-10-12',
    postName:
      'Assistant Engineer — Mechanical Maintenance and Workshop Operations',
    organization: 'Example Infrastructure Corporation',
    applicationLastDate: '2026-12-18',
    educationRequired: 'BTech in Mechanical Engineering',
    levels: ['BACHELORS'],
    vacancies: 36,
    payLevel: 'Level 8',
  },
  {
    id: 'review-office-assistant',
    publishedAt: '2026-10-13',
    postName: 'Office Support Assistant',
    organization: 'Example Education Board',
    applicationLastDate: '2026-12-12',
    educationRequired: '12th pass',
    levels: ['TWELFTH'],
    vacancies: 48,
    payLevel: null,
  },
];

const matchExamples = [
  {
    matchReason: 'Matches your Diploma in Electronics',
    remainingChecks: 'Marks and experience need checking',
    matchDetails:
      'Example education-route match: Diploma in Electronics. Minimum 50% marks and 3 years of relevant experience still need checking. This is a fictional design fixture, not a live eligibility result.',
  },
  {
    matchReason: 'Your diploma may be relevant',
    remainingChecks: 'Required subject needs checking',
    matchDetails:
      'The example notice says a diploma in a relevant subject. The exact subject requirement is unavailable, so this is a possible match requiring manual checking.',
  },
  {
    matchReason: 'Matches your BTech in Mechanical Engineering',
    remainingChecks: 'Other notice conditions need checking',
    matchDetails:
      'Example qualification match: BTech in Mechanical Engineering. A qualification match alone does not confirm every eligibility requirement.',
  },
];

export function createDesignReviewApi() {
  return createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json');
    response.setHeader('Cache-Control', 'no-store');
    const send = (status: number, body: unknown) => {
      response.writeHead(status);
      response.end(JSON.stringify(body));
    };
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (request.method !== 'GET') {
      send(405, {
        error:
          'Local design review is read-only. Sign-in and saving are disabled.',
      });
      return;
    }
    if (url.pathname === '/api/auth/get-session') {
      send(200, { user: null, enabled: false });
      return;
    }
    if (url.pathname.startsWith('/api/jobs/')) {
      const job = jobs.find((item) => `/api/jobs/${item.id}` === url.pathname);
      send(
        job ? 200 : 404,
        job
          ? {
              ...job,
              designReview: true,
              source:
                job.id === 'review-technical-assistant'
                  ? completeReviewSource
                  : { name: 'Fictional design example' },
            }
          : { error: 'Example not found' },
      );
      return;
    }
    if (url.pathname !== '/api/jobs') {
      send(404, {
        error:
          'Only fictional public jobs are available in local design review.',
      });
      return;
    }
    const filters = readJobFilters(url.searchParams);
    const rawPage = url.searchParams.get('page') ?? '1';
    const rawSize = url.searchParams.get('pageSize') ?? '6';
    const page = Number(rawPage);
    const pageSize = Number(rawSize);
    if (
      !filters ||
      !/^[1-9]\d*$/.test(rawPage) ||
      !/^[1-9]\d*$/.test(rawSize) ||
      page > 10000 ||
      pageSize > 100
    ) {
      send(400, { error: 'Invalid review search or pagination' });
      return;
    }
    const matching = jobs
      .filter(
        (job) =>
          `${job.postName} ${job.educationRequired}`
            .toLowerCase()
            .includes(filters.q.toLowerCase()) &&
          (!filters.qualification ||
            job.levels.includes(filters.qualification)),
      )
      .sort((a, b) => {
        if (filters.sort === 'newest') {
          // Fixture jobs carry no first-publication time; unknown sorts
          // last and equal/unknown values keep the fixture order.
          const aPublished = (a as { publishedAt?: string }).publishedAt;
          const bPublished = (b as { publishedAt?: string }).publishedAt;
          if (!aPublished) return bPublished ? 1 : 0;
          if (!bPublished) return -1;
          return bPublished.localeCompare(aPublished);
        }
        if (!a.applicationLastDate) return b.applicationLastDate ? 1 : 0;
        if (!b.applicationLastDate) return -1;
        return (
          a.applicationLastDate.localeCompare(b.applicationLastDate) *
          (filters.sort === 'soonest' ? 1 : -1)
        );
      });
    send(200, {
      designReview: true,
      reviewRecommendations: jobs.slice(0, 3).map((job, index) => ({
        ...job,
        ...matchExamples[index],
        source: { name: 'Fictional design example' },
      })),
      data: matching
        .slice((page - 1) * pageSize, page * pageSize)
        .map((job) => ({
          ...job,
          source: { name: 'Fictional design example' },
        })),
      pagination: {
        page,
        pageSize,
        totalItems: matching.length,
        totalPages: Math.ceil(matching.length / pageSize),
      },
    });
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  createDesignReviewApi().listen(8891, '127.0.0.1', () => {
    console.log(
      'Fictional review API: http://127.0.0.1:8891 — no database, sign-in or writes',
    );
  });
}
