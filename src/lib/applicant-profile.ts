import { prisma } from '../db.js';
import {
  EducationLevel,
  type Education,
  type User,
} from '../../generated/prisma/index.js';

export const ALLOWED_CATEGORIES = [
  'General',
  'OBC',
  'SC',
  'ST',
  'EWS',
  'PwBD',
] as const;

export type ProfileCategory = (typeof ALLOWED_CATEGORIES)[number];
const ALLOWED_CATEGORY_SET = new Set<string>(ALLOWED_CATEGORIES);

export const ALLOWED_EDUCATION_LEVELS = [
  'TENTH',
  'TWELFTH',
  'DIPLOMA',
  'BACHELORS',
  'MASTERS',
  'PHD',
] as const;

const ALLOWED_EDUCATION_LEVEL_SET = new Set<string>(
  Object.values(EducationLevel),
);

const EDUCATION_ORDER_MAP: Record<string, number> = {
  TENTH: 1,
  TWELFTH: 2,
  DIPLOMA: 3,
  BACHELORS: 4,
  MASTERS: 5,
  PHD: 6,
};

export interface FormEducationEntry {
  level: EducationLevel;
  marksPercent: number | null;
}

export interface FormProfile {
  dob: string;
  category: string | null;
  educations: FormEducationEntry[];
}

export interface ValidatedEducationEntry {
  level: EducationLevel;
  marksPercent: number | null;
}

export interface ValidatedProfileInput {
  dobString: string;
  dobDate: Date;
  category: ProfileCategory | null;
  educations: ValidatedEducationEntry[];
}

export type ValidationResult =
  | { ok: true; data: ValidatedProfileInput }
  | { ok: false; error: string };

export function formatProfileDob(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function parseProfileDob(
  dob: unknown,
): { date: Date; dobString: string } | null {
  if (typeof dob !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dob);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1900 || month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }
  const utcDate = new Date(Date.UTC(year, month - 1, day));
  if (
    utcDate.getUTCFullYear() !== year ||
    utcDate.getUTCMonth() !== month - 1 ||
    utcDate.getUTCDate() !== day
  ) {
    return null;
  }
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  if (dob > today) {
    return null;
  }
  return { date: utcDate, dobString: dob };
}

export function validateProfilePayload(body: unknown): ValidationResult {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, error: 'Please check your request and try again.' };
  }

  const bodyObj = body as Record<string, unknown>;
  const allowedKeys = new Set(['dob', 'category', 'educations']);
  for (const key of Object.keys(bodyObj)) {
    if (!allowedKeys.has(key)) {
      return { ok: false, error: `Disallowed field: ${key}` };
    }
  }

  if (typeof bodyObj.dob !== 'string') {
    return { ok: false, error: 'A valid Date of Birth (dob) is required' };
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(bodyObj.dob);
  if (!match) {
    return { ok: false, error: 'A valid Date of Birth (dob) is required' };
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1900 || month < 1 || month > 12 || day < 1 || day > 31) {
    return { ok: false, error: 'A valid Date of Birth (dob) is required' };
  }
  const utcDate = new Date(Date.UTC(year, month - 1, day));
  if (
    utcDate.getUTCFullYear() !== year ||
    utcDate.getUTCMonth() !== month - 1 ||
    utcDate.getUTCDate() !== day
  ) {
    return { ok: false, error: 'A valid Date of Birth (dob) is required' };
  }
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  if (bodyObj.dob > today) {
    return { ok: false, error: 'Date of birth cannot be in the future' };
  }

  let category: ProfileCategory | null = null;
  if (bodyObj.category !== null && bodyObj.category !== undefined) {
    if (
      typeof bodyObj.category !== 'string' ||
      !ALLOWED_CATEGORY_SET.has(bodyObj.category)
    ) {
      return { ok: false, error: 'Invalid category' };
    }
    category = bodyObj.category as ProfileCategory;
  }

  if (!Array.isArray(bodyObj.educations) || bodyObj.educations.length === 0) {
    return { ok: false, error: 'At least one education entry is required' };
  }

  const seenLevels = new Set<string>();
  const educations: ValidatedEducationEntry[] = [];
  for (const entry of bodyObj.educations) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      return { ok: false, error: 'Invalid education entry' };
    }
    const entryObj = entry as Record<string, unknown>;
    const allowedEntryKeys = new Set(['level', 'marksPercent']);
    for (const k of Object.keys(entryObj)) {
      if (!allowedEntryKeys.has(k)) {
        return { ok: false, error: `Disallowed education field: ${k}` };
      }
    }
    if (
      typeof entryObj.level !== 'string' ||
      !ALLOWED_EDUCATION_LEVEL_SET.has(entryObj.level)
    ) {
      return {
        ok: false,
        error: `Invalid education level: ${String(entryObj.level)}`,
      };
    }
    if (seenLevels.has(entryObj.level)) {
      return {
        ok: false,
        error: `Duplicate education level: ${entryObj.level}`,
      };
    }
    seenLevels.add(entryObj.level);

    let marksPercent: number | null = null;
    if (entryObj.marksPercent !== null && entryObj.marksPercent !== undefined) {
      if (
        typeof entryObj.marksPercent !== 'number' ||
        !Number.isFinite(entryObj.marksPercent)
      ) {
        return { ok: false, error: 'Marks must be null or a finite number' };
      }
      if (entryObj.marksPercent < 0 || entryObj.marksPercent > 100) {
        return { ok: false, error: 'Marks must be between 0 and 100' };
      }
      marksPercent = entryObj.marksPercent;
    }

    educations.push({
      level: entryObj.level as EducationLevel,
      marksPercent,
    });
  }

  return {
    ok: true,
    data: {
      dobString: bodyObj.dob,
      dobDate: utcDate,
      category,
      educations,
    },
  };
}

export function serializeProfile(
  user: Pick<User, 'dob' | 'category'> & {
    educations: Pick<Education, 'level' | 'marksPercent'>[];
  },
): FormProfile {
  return {
    dob: formatProfileDob(user.dob),
    category: user.category === 'UNSPECIFIED' ? null : user.category,
    educations: [...user.educations]
      .sort(
        (a, b) =>
          (EDUCATION_ORDER_MAP[a.level] ?? 99) -
          (EDUCATION_ORDER_MAP[b.level] ?? 99),
      )
      .map((e) => ({
        level: e.level,
        marksPercent: e.marksPercent,
      })),
  };
}

export async function getApplicantProfile(
  authUserId: string,
): Promise<FormProfile | null> {
  const user = await prisma.user.findUnique({
    where: { authUserId },
    include: { educations: true },
  });
  if (!user) return null;
  return serializeProfile(user);
}

export async function saveApplicantProfile(
  authUserId: string,
  input: ValidatedProfileInput,
): Promise<FormProfile> {
  const user = await prisma.user.upsert({
    where: { authUserId },
    create: {
      authUserId,
      dob: input.dobDate,
      category: input.category ?? 'UNSPECIFIED',
      educations: {
        create: input.educations.map((edu) => ({
          level: edu.level,
          marksPercent: edu.marksPercent,
        })),
      },
    },
    update: {
      dob: input.dobDate,
      category: input.category ?? 'UNSPECIFIED',
      educations: {
        deleteMany: {},
        create: input.educations.map((edu) => ({
          level: edu.level,
          marksPercent: edu.marksPercent,
        })),
      },
    },
    include: { educations: true },
  });

  return serializeProfile(user);
}
