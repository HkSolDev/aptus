import type { BetterAuthOptions } from 'better-auth';

type Bucket = {
  count: number;
  expiresAt: number;
  nextAllowedAt: number;
  throttled: boolean;
};

const attemptWindow = 15 * 60;
const maximumAttempts = 20;
const maximumBuckets = 10_000;

export function createAuthRateLimit(): NonNullable<
  BetterAuthOptions['rateLimit']
> {
  // One server process only; shared atomic storage is needed for multiple instances.
  const buckets = new Map<string, Bucket>();
  let nextCleanup = 0;
  const result = (allowed: boolean, retryAfter: number | null = null) =>
    Promise.resolve({ allowed, retryAfter });

  return {
    enabled: true,
    window: 60,
    max: 120,
    customRules: {
      '/sign-in/social': { window: attemptWindow, max: 5 },
      '/callback/google': { window: attemptWindow, max: 10 },
      '/passkey/generate-register-options': { window: attemptWindow, max: 5 },
      '/passkey/verify-registration': { window: attemptWindow, max: 10 },
      '/passkey/generate-authenticate-options': {
        window: attemptWindow,
        max: 5,
      },
      '/passkey/verify-authentication': { window: attemptWindow, max: 10 },
      '/passkey/delete-passkey': { window: attemptWindow, max: 5 },
      '/passkey/update-passkey': { window: attemptWindow, max: 5 },
    },
    customStorage: {
      consume(key, rule) {
        // Better Auth supplies a normalized peer-IP + endpoint key. No account lockout.
        const now = Date.now();
        if (now >= nextCleanup) {
          for (const [storedKey, bucket] of buckets) {
            if (now >= bucket.expiresAt) buckets.delete(storedKey);
          }
          nextCleanup = now + 60_000;
        }

        let bucket = buckets.get(key);
        if (!bucket || now >= bucket.expiresAt) {
          // Reject new buckets at capacity instead of evicting active limits.
          if (!bucket && buckets.size >= maximumBuckets)
            return result(false, 60);
          bucket = {
            count: 0,
            expiresAt: now + rule.window * 1000,
            nextAllowedAt: 0,
            throttled: false,
          };
          buckets.set(key, bucket);
        }

        if (now < bucket.nextAllowedAt) {
          // Early retries neither extend the wait nor consume more attempts.
          return result(false, Math.ceil((bucket.nextAllowedAt - now) / 1000));
        }

        if (rule.window !== attemptWindow) {
          if (bucket.count >= rule.max) {
            return result(false, Math.ceil((bucket.expiresAt - now) / 1000));
          }
          bucket.count++;
          return result(true);
        }

        if (bucket.count === rule.max && !bucket.throttled) {
          bucket.throttled = true;
          bucket.nextAllowedAt = now + 2000;
          return result(false, 2);
        }

        bucket.count++;
        if (bucket.count >= maximumAttempts) {
          bucket.nextAllowedAt = now + attemptWindow * 1000;
          bucket.expiresAt = bucket.nextAllowedAt;
          return result(false, attemptWindow);
        }
        if (bucket.throttled) {
          const waitSeconds = Math.min(32, 2 ** (bucket.count - rule.max + 1));
          bucket.nextAllowedAt = now + waitSeconds * 1000;
        }
        // No await before updating the bucket: concurrent requests consume atomically.
        return result(true);
      },
    },
  };
}
