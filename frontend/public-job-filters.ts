export const JOB_QUALIFICATIONS = [
  { value: 'TENTH', label: '10th' },
  { value: 'TWELFTH', label: '12th' },
  { value: 'DIPLOMA', label: 'Diploma' },
  { value: 'BACHELORS', label: 'Graduation' },
  { value: 'MASTERS', label: 'Postgraduation' },
  { value: 'PHD', label: 'PhD' },
] as const;

export interface JobFilters {
  q: string;
  qualification: (typeof JOB_QUALIFICATIONS)[number]['value'] | '';
  sort: 'newest' | 'soonest' | 'furthest';
}

export function readJobFilters(params: URLSearchParams): JobFilters | null {
  if (
    ['q', 'qualification', 'sort'].some((key) => params.getAll(key).length > 1)
  )
    return null;
  const rawQuery = params.get('q') ?? '';
  if (rawQuery.length > 100 || /[\u0000-\u001f\u007f]/u.test(rawQuery))
    return null;
  const q = rawQuery.trim().normalize('NFC');
  const rawQualification = params.get('qualification') ?? '';
  const qualification =
    JOB_QUALIFICATIONS.find((option) => option.value === rawQualification)
      ?.value ?? '';
  if (rawQualification && !qualification) return null;
  const sort = params.get('sort') ?? 'newest';
  if (sort !== 'newest' && sort !== 'soonest' && sort !== 'furthest')
    return null;
  return { q, qualification, sort };
}

export function jobSearchParams(filters: JobFilters, page = 1) {
  const params = new URLSearchParams({ sort: filters.sort });
  if (filters.q) params.set('q', filters.q);
  if (filters.qualification) params.set('qualification', filters.qualification);
  if (page > 1) params.set('page', String(page));
  return params;
}
