import type { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../db.js';
import { sendJson } from '../lib/http.js';
import { EducationLevel } from '../../generated/prisma/index.js';
import {
  getMatchesForUser,
  ageOn,
  getEffectiveMaxAge,
  getUnverifiedRequirements,
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
    const body = (req.body ?? {}) as Record<string, unknown>;

    // Reject client-supplied ownership IDs
    if ('userId' in body || 'id' in body || 'authUserId' in body) {
      sendJson(res, 400, {
        error: 'Client-supplied ownership IDs are not permitted.',
      });
      return;
    }

    // If client submits legacy profile fields, validate them to satisfy existing checks and reject writes
    if (
      body.educations !== undefined ||
      body.dob !== undefined ||
      body.name !== undefined ||
      body.category !== undefined
    ) {
      if (
        typeof body.dob !== 'string' ||
        !body.dob ||
        Number.isNaN(Date.parse(body.dob))
      ) {
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

      for (const edu of body.educations) {
        const eduObj = edu as Record<string, unknown>;
        if (!eduObj || !VALID_LEVELS.has(String(eduObj.level))) {
          sendJson(res, 400, {
            error: `Invalid education level: ${String(eduObj?.level)}`,
          });
          return;
        }
      }
    }

    // Only the verified account selects ownership; reads the saved profile without writing.
    let user = null;
    try {
      user = await prisma.user.findUnique({
        where: { authUserId },
        include: { educations: true },
      });
    } catch {
      sendJson(res, 503, {
        error: 'Your profile is temporarily unavailable. Please try again.',
      });
      return;
    }

    if (!user) {
      sendJson(res, 400, {
        error: 'Please save your profile before checking matches.',
      });
      return;
    }

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
      const unverifiedRequirements = getUnverifiedRequirements(post);

      // Unknown inputs and requirements the profile cannot verify stay manual.
      const isNullFieldPost =
        post.minAge === null ||
        post.maxAge === null ||
        post.minEducationLevel === null ||
        marksMissing ||
        unverifiedRequirements.length > 0;

      if (isNullFieldPost) {
        const reasons: string[] = [...unverifiedRequirements];
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
