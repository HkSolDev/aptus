import { betterAuth, type BetterAuthOptions } from 'better-auth';
import {
  APIError,
  createAuthMiddleware,
  getSessionFromCtx,
} from 'better-auth/api';
import { genericOAuth } from 'better-auth/plugins';
import { google } from 'better-auth/social-providers';
import { prismaAdapter } from '@better-auth/prisma-adapter';
import { prisma } from '../db.js';
import type { AuthConfig } from './config.js';
import { createAuthRateLimit } from './rate-limit.js';
import { passkeyPlugin, supportsPasskeys } from './passkeys.js';
import { guardPasskeyOperation, proofLifetime } from './recent-proof.js';

// Aptus never calls Google APIs after identity verification: do not retain bearer credentials.
const discardedTokens = {
  accessToken: null,
  refreshToken: null,
  idToken: null,
  accessTokenExpiresAt: null,
  refreshTokenExpiresAt: null,
};

export function authOptions(
  config: AuthConfig,
  database = prisma,
): BetterAuthOptions {
  const googleProfile = google({
    clientId: config.googleClientId,
    clientSecret: config.googleClientSecret,
  });
  return {
    appName: 'Aptus',
    baseURL: config.origin,
    basePath: '/api/auth',
    secret: config.secret,
    trustedOrigins: [config.origin],
    database: prismaAdapter(database, {
      provider: 'postgresql',
      transaction: true,
    }),
    logger: { disabled: true },
    telemetry: { enabled: false },
    rateLimit: createAuthRateLimit(),
    user: {
      modelName: 'AuthUser',
      validateUserInfo: ({ user }) =>
        user.emailVerified ? undefined : { error: 'email_not_verified' },
    },
    session: {
      modelName: 'AuthSession',
      expiresIn: 7 * 24 * 60 * 60,
      updateAge: 24 * 60 * 60,
      deferSessionRefresh: true,
      cookieCache: { enabled: false },
      freshAge: proofLifetime,
    },
    account: {
      modelName: 'AuthAccount',
      storeStateStrategy: 'database',
      accountLinking: { enabled: false, disableImplicitLinking: true },
      encryptOAuthTokens: true,
    },
    verification: { modelName: 'AuthVerification' },
    advanced: {
      useSecureCookies: config.origin.startsWith('https:'),
      cookiePrefix: 'aptus',
      defaultCookieAttributes: { httpOnly: true, sameSite: 'lax', path: '/' },
      ipAddress: { ipAddressHeaders: ['x-aptus-peer-ip'] },
    },
    plugins: [
      ...(supportsPasskeys(config.origin)
        ? [passkeyPlugin(config.origin)]
        : []),
      genericOAuth({
        config: [
          {
            providerId: 'google',
            name: 'Google',
            clientId: config.googleClientId,
            clientSecret: config.googleClientSecret,
            discoveryUrl:
              'https://accounts.google.com/.well-known/openid-configuration',
            requireIdTokenVerification: true,
            // Require an ID token; generic OIDC verifies it before this mapping runs.
            getUserInfo: async (tokens) => {
              if (!tokens.idToken) return null;
              const profile = (await googleProfile.getUserInfo(tokens))?.data;
              return profile
                ? {
                    ...profile,
                    emailVerified: profile.email_verified,
                    image: profile.picture,
                  }
                : null;
            },
            pkce: true,
            scopes: ['openid', 'email', 'profile'],
            accessType: 'online',
            prompt: 'select_account',
            allowIdpInitiated: false,
            disableProviderLogout: true,
          },
        ],
      }),
    ],
    databaseHooks: {
      account: {
        create: {
          before: (account) =>
            Promise.resolve({
              data: { ...account, ...discardedTokens },
            }),
        },
        update: {
          before: (account) =>
            Promise.resolve({
              data: { ...account, ...discardedTokens },
            }),
        },
      },
      session: {
        create: {
          before: async (session, ctx) => {
            // Reauthentication may refresh this account, never silently switch it.
            const previous = ctx ? await getSessionFromCtx(ctx) : null;
            if (previous && previous.user.id !== session.userId)
              throw new APIError('FORBIDDEN', {
                message: 'Use the same account to verify.',
              });
            return { data: { ...session, ipAddress: null, userAgent: null } };
          },
        },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        await guardPasskeyOperation(ctx, database);
        if (
          ctx.path === '/callback/:id' &&
          ctx.params?.id === 'google' &&
          typeof ctx.query?.state === 'string'
        ) {
          const attempt =
            await ctx.context.internalAdapter.findVerificationValue(
              `auth-state:${ctx.query.state}`,
            );
          // The pinned OAuth parser checks payload expiry, but not the row's expiry.
          if (attempt && attempt.expiresAt.getTime() <= Date.now())
            throw ctx.redirect(`${config.origin}/auth/error`);
        }
        if (ctx.path !== '/sign-out') return;
        const token = await ctx.getSignedCookie(
          ctx.context.authCookies.sessionToken.name,
          ctx.context.secret,
        );
        if (!token) return;
        // The pinned library swallows read/deletion errors. Revoke in PostgreSQL or fail honestly.
        try {
          await database.authSession.deleteMany({ where: { token } });
        } catch {
          throw new APIError('SERVICE_UNAVAILABLE', {
            message: 'Could not sign out. Please try again.',
          });
        }
      }),
    },
    // Propagate unexpected failures to our sanitized boundary instead of the router's raw console logger.
    onAPIError: { throw: true, errorURL: `${config.origin}/auth/error` },
  };
}

export function createAuth(config: AuthConfig, database = prisma) {
  return betterAuth(authOptions(config, database));
}

export type AppAuth = ReturnType<typeof createAuth>;
