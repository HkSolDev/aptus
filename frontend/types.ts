// This mirrors the existing JSON API, without importing server/Prisma code into the browser.
export const EDUCATION_LEVELS = [
  'TENTH',
  'TWELFTH',
  'DIPLOMA',
  'BACHELORS',
  'MASTERS',
  'PHD',
] as const;
export type EducationLevel = (typeof EDUCATION_LEVELS)[number];

export interface EducationEntry {
  level: EducationLevel | '';
  marksPercent: number | null;
}

export interface Profile {
  userId?: string;
  name?: string;
  dob: string;
  category: string | null;
  educations: EducationEntry[];
}

interface PostSummary {
  id: string;
  postName: string;
  sourceName: string;
  sourceUrl: string;
  payLevel: string | null;
}

export interface MatchedPost extends PostSummary {
  ageComparison: string;
  categoryRelaxationApplied: string | null;
}

export interface ManualPost extends PostSummary {
  reason: string;
  educationRequired: string | null;
}

export interface MatchResponse {
  userId: string;
  matches: MatchedPost[];
  needsManualCheck: ManualPost[];
  sourcesChecked: string[];
}
