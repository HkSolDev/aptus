import type { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../db.js';
import { sendJson } from '../lib/http.js';
import {
  type EducationLevel,
  type PostGroup,
  Prisma,
} from '../../generated/prisma/index.js';
import { validatePost } from '../../scripts/validate-post.js';
import {
  isEligibilityRules,
  type EligibilityRules,
} from '../schemas/eligibility-rules.js';

interface IngestPost {
  post_name: string | null;
  vacancies: number | null;
  application_last_date: string | null;
  age_as_on_date: string | null;
  min_age: number | null;
  max_age: number | null;
  education_required: string | null;
  post_group: PostGroup | null;
  pay_level: string | null;
  min_education_level: EducationLevel | null;
  min_marks_percent: number | null;
  category_relaxation_applies: boolean | null;
  category_relaxation_rules: Record<string, number | null> | null;
  // Legacy producers can omit rules; current Python output always includes them.
  eligibility_rules?: EligibilityRules;
}

interface IngestRequestBody {
  source_url?: string;
  source_name?: string;
  raw_hash?: string | null;
  notification_pdf_url?: string | null;
  official_site_url?: string | null;
  apply_url?: string | null;
  source_text?: string;
  posts?: IngestPost[];
}

export async function handleIngest(
  req: FastifyRequest<{ Body: IngestRequestBody }>,
  res: FastifyReply,
): Promise<void> {
  try {
    const body = req.body ?? {};

    if (!body.source_url || !body.source_name) {
      sendJson(res, 400, {
        error: 'source_url and source_name are required',
      });
      return;
    }
    if (!Array.isArray(body.posts)) {
      sendJson(res, 400, { error: 'posts must be an array' });
      return;
    }

    for (const [index, post] of body.posts.entries()) {
      if (
        post === null ||
        typeof post !== 'object' ||
        Array.isArray(post) ||
        (post.eligibility_rules !== undefined &&
          !isEligibilityRules(post.eligibility_rules))
      ) {
        sendJson(res, 400, {
          error: `posts[${index}] must be an object with valid eligibility_rules when supplied`,
        });
        return;
      }
    }

    const existing = await prisma.source.findUnique({
      where: { url: body.source_url },
    });

    // A resend of content we already have nothing new to say about —
    // skip the write entirely rather than re-validating and re-deleting
    // posts for no reason. This is the durable backstop behind Python's
    // own local hash cache: even if that cache is empty or stale, this
    // check still stops duplicate work from reaching the database.
    if (
      existing &&
      body.raw_hash &&
      existing.rawHash === body.raw_hash &&
      body.posts.length === 0
    ) {
      sendJson(res, 200, {
        sourceId: existing.id,
        skippedAsUnchanged: true,
        created: 0,
        skipped: [],
      });
      return;
    }

    const source = await prisma.source.upsert({
      where: { url: body.source_url },
      update: {
        name: body.source_name,
        rawHash: body.raw_hash ?? null,
        notificationPdfUrl: body.notification_pdf_url ?? null,
        officialSiteUrl: body.official_site_url ?? null,
        applyUrl: body.apply_url ?? null,
      },
      create: {
        url: body.source_url,
        name: body.source_name,
        rawHash: body.raw_hash ?? null,
        notificationPdfUrl: body.notification_pdf_url ?? null,
        officialSiteUrl: body.official_site_url ?? null,
        applyUrl: body.apply_url ?? null,
      },
    });

    // An empty posts array almost always means the LLM call failed or
    // returned garbage upstream — never treat that as "this notification
    // now has zero posts" and wipe out previously good data.
    if (body.posts.length === 0) {
      sendJson(res, 200, { sourceId: source.id, created: 0, skipped: [] });
      return;
    }

    const sourceText = body.source_text ?? '';
    const skipped: string[] = [];
    const toCreate: Prisma.PostCreateManyInput[] = [];

    for (const raw of body.posts) {
      if (!raw.post_name || !raw.post_name.trim()) {
        skipped.push('post with no post_name');
        continue;
      }

      const validated = validatePost(
        {
          minAge: raw.min_age,
          maxAge: raw.max_age,
          minMarksPercent: raw.min_marks_percent,
          categoryRelaxationRules: raw.category_relaxation_rules ?? {},
        },
        sourceText,
      );

      toCreate.push({
        sourceId: source.id,
        postName: raw.post_name.trim(),
        postGroup: raw.post_group,
        payLevel: raw.pay_level,
        minAge: validated.minAge,
        maxAge: validated.maxAge,
        vacancies: raw.vacancies,
        applicationLastDate: raw.application_last_date
          ? new Date(raw.application_last_date)
          : null,
        ageAsOnDate: raw.age_as_on_date ? new Date(raw.age_as_on_date) : null,
        educationRequired: raw.education_required,
        minEducationLevel: raw.min_education_level,
        minMarksPercent: validated.minMarksPercent,
        categoryRelaxationApplies: raw.category_relaxation_applies,
        categoryRelaxationRules: validated.categoryRelaxationRules,
        eligibilityRules: raw.eligibility_rules ?? Prisma.DbNull,
      });
    }

    // Re-extraction of a changed page can add, drop, or reorder posts —
    // matching old rows to new ones isn't attempted here (that's the
    // separate dedup task). Replacing the set atomically keeps this
    // idempotent: a retry or duplicate send never leaves duplicate Posts.
    await prisma.$transaction([
      prisma.post.deleteMany({ where: { sourceId: source.id } }),
      prisma.post.createMany({ data: toCreate }),
    ]);

    sendJson(res, 200, {
      sourceId: source.id,
      created: toCreate.length,
      skipped,
    });
  } catch {
    sendJson(res, 500, { error: 'Internal Server Error' });
  }
}
