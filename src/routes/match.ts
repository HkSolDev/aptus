import type { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../db.js';
import { sendJson } from '../lib/http.js';
import { EducationLevel } from '../../generated/prisma/index.js';
import {
  getMatchesForUser,
  ageOn,
  getEffectiveMaxAge,
} from '../../scripts/match.js';

const VALID_LEVELS = new Set<string>(Object.values(EducationLevel));

interface MatchRequestBody {
  userId?: string;
  name?: string;
  dob?: string;
  category?: string | null;
  educations?: Array<{
    level: EducationLevel;
    marksPercent?: number | string | null;
  }>;
}

export async function handleMatch(
  req: FastifyRequest<{ Body: MatchRequestBody }>,
  res: FastifyReply,
): Promise<void> {
  try {
    const authUserId = req.authUserId;
    if (!authUserId) {
      sendJson(res, 401, { error: 'Please sign in again.' });
      return;
    }
    const body = req.body ?? {};

    if (!body.dob || Number.isNaN(Date.parse(body.dob))) {
      sendJson(res, 400, {
        error: 'A valid Date of Birth (dob) is required',
      });
      return;
    }

    if (!Array.isArray(body.educations) || body.educations.length === 0) {
      sendJson(res, 400, {
        error: 'At least one education entry is required',
      });
      return;
    }

    // Deduplicate by education level to satisfy @@unique([userId, level])
    const eduMap = new Map<EducationLevel, number | null>();
    for (const edu of body.educations) {
      if (!VALID_LEVELS.has(edu.level)) {
        sendJson(res, 400, {
          error: `Invalid education level: ${edu.level}`,
        });
        return;
      }
      const marks =
        edu.marksPercent != null && edu.marksPercent !== ''
          ? Number(edu.marksPercent)
          : null;
      eduMap.set(edu.level, Number.isFinite(marks) ? marks : null);
    }

    const profileDetails = {
      name: body.name?.trim() || null,
      dob: new Date(body.dob),
      category: body.category || 'UNSPECIFIED',
    };
    const educations = Array.from(eduMap, ([level, marksPercent]) => ({
      level,
      marksPercent,
    }));
    // Only the verified account selects ownership; old unclaimed profiles stay untouched.
    const user = await prisma.user.upsert({
      where: { authUserId },
      create: {
        ...profileDetails,
        authUserId,
        educations: { create: educations },
      },
      update: {
        ...profileDetails,
        educations: { deleteMany: {}, create: educations },
      },
      include: { educations: true },
    });

    const matchedPosts = await getMatchesForUser(user.id);

    const sources = await prisma.source.findMany({
      select: { name: true },
    });
    const sourcesChecked = sources.map((s) => s.name);

    const userAge = ageOn(user.dob);
    const marksByLevel = new Map(
      user.educations.map((e) => [e.level, e.marksPercent]),
    );

    const matches = [];
    const needsManualCheck = [];

    for (const post of matchedPosts) {
      const { effectiveMaxAge, relaxation } = getEffectiveMaxAge(
        post,
        user.category,
      );

      const userMarksAtLevel = post.minEducationLevel
        ? marksByLevel.get(post.minEducationLevel)
        : undefined;
      const marksMissing =
        post.minMarksPercent !== null && userMarksAtLevel == null;

      // A post requires manual verification if any matching parameter was null
      const isNullFieldPost =
        post.minAge === null ||
        post.maxAge === null ||
        post.minEducationLevel === null ||
        marksMissing;

      if (isNullFieldPost) {
        const reasons: string[] = [];
        if (post.minEducationLevel === null) {
          reasons.push('Education qualification requires manual verification');
        }
        if (post.minAge === null) {
          reasons.push('Minimum age limit not specified in notification');
        }
        if (post.maxAge === null) {
          reasons.push('Maximum age limit not specified in notification');
        }
        if (marksMissing) {
          reasons.push(
            `Notification requires min ${post.minMarksPercent}% marks (not provided)`,
          );
        }

        needsManualCheck.push({
          id: post.id,
          postName: post.postName,
          sourceName: post.source.name,
          sourceUrl: post.source.url,
          payLevel: post.payLevel,
          educationRequired: post.educationRequired,
          reason: reasons.join('; '),
        });
      } else {
        matches.push({
          id: post.id,
          postName: post.postName,
          sourceName: post.source.name,
          sourceUrl: post.source.url,
          payLevel: post.payLevel,
          userAge,
          minAge: post.minAge,
          maxAge: post.maxAge,
          effectiveMaxAge,
          ageComparison: `Age ${userAge} (Allowed: ${post.minAge}–${effectiveMaxAge})`,
          categoryRelaxationApplied:
            relaxation > 0 ? `+${relaxation} yrs (${user.category})` : null,
        });
      }
    }

    sendJson(res, 200, {
      userId: user.id,
      matches,
      needsManualCheck,
      sourcesChecked,
    });
  } catch {
    sendJson(res, 500, { error: 'Internal Server Error' });
  }
}
