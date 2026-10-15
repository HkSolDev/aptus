import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { readJobFilters } from '../frontend/public-job-filters.js';

// Matches the four fictional jobs in the approved HTML reference. No database.
const jobs = [
  {
    id: 'review-technical-assistant',
    postName: 'Technical Assistant — Physics and Electronics',
    organization: 'Example Public Research Institute',
    applicationLastDate: '2026-11-30',
    educationRequired: 'BSc Physics or Diploma in Electronics',
    levels: ['BACHELORS', 'DIPLOMA'],
    vacancies: 120,
    payLevel: 'Level 4',
  },
  {
    id: 'review-laboratory-assistant',
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
          ? { ...job, source: { name: 'Fictional design example' } }
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
