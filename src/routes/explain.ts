import type { FastifyRequest, FastifyReply } from 'fastify';
import type { Post } from '../../generated/prisma/index.js';
import { prisma } from '../db.js';
import { sendJson } from '../lib/http.js';
import { getPostChecks, type MatchCandidate } from '../../scripts/match.js';

type ExplainedPost = Pick<
  Post,
  | 'postName'
  | 'minAge'
  | 'maxAge'
  | 'minEducationLevel'
  | 'minMarksPercent'
  | 'educationRequired'
  | 'payLevel'
  | 'categoryRelaxationRules'
  | 'eligibilityRules'
>;

export function explainStoredPost(
  post: ExplainedPost,
  user: MatchCandidate | null,
): string {
  const lines = [
    `${post.postName}. Education: ${post.educationRequired ?? post.minEducationLevel ?? 'not specified'}.`,
    `Saved age limits: minimum ${post.minAge ?? 'not specified'}, maximum ${post.maxAge ?? 'not specified'}.`,
    `Minimum marks: ${post.minMarksPercent === null ? 'not specified' : `${post.minMarksPercent}%`}.`,
    `Pay level: ${post.payLevel ?? 'not specified'}.`,
  ];
  if (user) {
    const checks = getPostChecks(post, user);
    const status = (passes: boolean, missing: boolean) =>
      !passes
        ? 'fails saved requirements'
        : missing
          ? 'needs manual verification'
          : 'passes saved requirements';
    lines.push(
      `Candidate age: ${checks.userAge}.`,
      `Age check: ${status(checks.ageOk, post.minAge === null || checks.effectiveMaxAge === null)}.`,
      `Education check: ${status(checks.educationOk, post.minEducationLevel === null)}.`,
      `Marks check: ${status(checks.marksOk, post.minMarksPercent === null || checks.marksAtRequiredLevel == null)}.`,
    );
    if (checks.relaxation > 0) {
      lines.push(
        `Saved category relaxation: ${checks.relaxation} years; effective maximum age: ${checks.effectiveMaxAge ?? 'not specified'}.`,
      );
    }
  }
  if (post.eligibilityRules !== null) {
    // The current matcher checks flat summaries, not every nested condition.
    lines.push(
      'Additional saved conditions require manual verification against the notification.',
    );
  }
  lines.push(
    'These checks use saved fields; verify missing or conditional requirements in the source notification.',
  );
  return lines.join(' ');
}

export async function handleExplain(
  req: FastifyRequest<{ Body: { postId?: unknown; userId?: unknown } }>,
  res: FastifyReply,
): Promise<void> {
  try {
    const authUserId = req.authUserId;
    if (!authUserId) {
      sendJson(res, 401, { error: 'Please sign in again.' });
      return;
    }
    const body = req.body ?? {};
    if (!body.postId || typeof body.postId !== 'string') {
      sendJson(res, 400, { error: 'postId is required' });
      return;
    }
    const post = await prisma.post.findUnique({ where: { id: body.postId } });
    if (!post) {
      sendJson(res, 404, { error: 'Post not found' });
      return;
    }
    // The session selects the profile even when a caller supplies another profile ID.
    const user = await prisma.user.findUnique({
      where: { authUserId },
      include: { educations: true },
    });
    if (!user) {
      sendJson(res, 404, {
        error: 'Add your profile details before checking why a job matches.',
      });
      return;
    }
    sendJson(res, 200, { explanation: explainStoredPost(post, user) });
  } catch {
    sendJson(res, 500, {
      error: 'We could not explain this job. Please try again.',
    });
  }
}
