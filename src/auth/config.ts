export type AuthConfig = {
  origin: string;
  secret: string;
  googleClientId: string;
  googleClientSecret: string;
};

export function readAuthConfig(
  env: NodeJS.ProcessEnv = process.env,
): AuthConfig | null {
  if (env.AUTH_ENABLED === undefined || env.AUTH_ENABLED === 'false')
    return null;
  if (env.AUTH_ENABLED !== 'true')
    throw new Error('AUTH_ENABLED must be true or false.');

  const required = (name: string) => {
    const value = env[name]?.trim();
    if (!value || value.length > 4096)
      throw new Error(`Configure ${name} on the backend.`);
    return value;
  };
  const url = new URL(required('BETTER_AUTH_URL'));
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    (url.protocol !== 'https:' &&
      !(local && env.NODE_ENV !== 'production' && url.protocol === 'http:'))
  ) {
    throw new Error(
      'BETTER_AUTH_URL must be an exact HTTPS origin (HTTP is local-development only).',
    );
  }
  const secret = required('BETTER_AUTH_SECRET');
  if (secret.length < 32)
    throw new Error(
      'BETTER_AUTH_SECRET must contain at least 32 random characters.',
    );
  return {
    origin: url.origin,
    secret,
    googleClientId: required('GOOGLE_CLIENT_ID'),
    googleClientSecret: required('GOOGLE_CLIENT_SECRET'),
  };
}
