import type { Metadata } from 'next';
import type { JobDetailData } from './job-detail-content';

export function jobShareUrl(id: string, origin: string): string {
  return new URL(`/jobs/${encodeURIComponent(id)}`, origin).href;
}

export function jobMetadata(job: JobDetailData, origin?: string): Metadata {
  const reviewed = job.reviewedDetails;
  const organization = reviewed?.recruiting_body ?? job.organization;
  const title = [job.postName, organization].filter(Boolean).join(' — ');
  const vacancies = reviewed?.vacancies ?? job.vacancies;
  const deadline = reviewed?.application_last_date ?? job.applicationLastDate;
  const description = [
    reviewed?.locations?.join(', '),
    vacancies != null
      ? `${vacancies} ${vacancies === 1 ? 'vacancy' : 'vacancies'}`
      : null,
    deadline ? `Application deadline: ${deadline.slice(0, 10)}` : null,
    'View job details and verify the official notification.',
  ]
    .filter(Boolean)
    .join(' · ');
  if (!origin) return { title, description };
  const base = new URL(origin);
  if (
    !['https:', 'http:'].includes(base.protocol) ||
    base.username ||
    base.password ||
    base.pathname !== '/' ||
    base.search ||
    base.hash
  ) {
    throw new Error('SITE_URL must be an HTTP(S) public origin.');
  }
  const url = jobShareUrl(job.id, base.origin);
  const image = {
    url: new URL('/share-image', base).href,
    width: 1200,
    height: 630,
    alt: 'Government job notification',
  };
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { type: 'website', title, description, url, images: [image] },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [image],
    },
  };
}
