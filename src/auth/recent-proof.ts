import { APIError, getSessionFromCtx } from 'better-auth/api';
import { prisma } from '../db.js';
type AuthContext = Parameters<typeof getSessionFromCtx>[0];

export const proofLifetime = 5 * 60;

export async function requireRecentProof(ctx: AuthContext) {
  const session = await getSessionFromCtx(ctx);
  if (!session)
    throw new APIError('UNAUTHORIZED', { message: 'Please sign in.' });
  // Renewal changes expiry, not the original authentication time.
  if (Date.now() - session.session.createdAt.getTime() >= proofLifetime * 1000)
    throw new APIError('FORBIDDEN', {
      message: 'Please verify your account again.',
    });
  return session;
}

export async function guardPasskeyOperation(
  ctx: AuthContext,
  database = prisma,
) {
  const changes = [
    '/passkey/generate-register-options',
    '/passkey/verify-registration',
    '/passkey/delete-passkey',
    '/passkey/update-passkey',
  ];
  if (!changes.includes(ctx.path)) return;
  const session = await requireRecentProof(ctx);
  if (ctx.path !== '/passkey/delete-passkey') return;
  // Every Aptus account starts with Google; preserve that recovery boundary.
  const google = await database.authAccount.findFirst({
    where: { userId: session.user.id, providerId: 'google' },
    select: { id: true },
  });
  if (!google)
    throw new APIError('FORBIDDEN', {
      message: 'Keep a verified recovery method.',
    });
}
