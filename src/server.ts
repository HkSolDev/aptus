import { pathToFileURL } from 'node:url';
import 'dotenv/config';
import { buildApp } from './app.js';

export const server = buildApp();

export function readPort(value: string | undefined): number {
  if (value === undefined) return 8080;
  const port = Number(value);
  if (
    !/^[1-9]\d*$/.test(value) ||
    !Number.isSafeInteger(port) ||
    port > 65_535
  ) {
    throw new Error('PORT must be a whole number between 1 and 65535.');
  }
  return port;
}

export async function startServer(port: number, host = '127.0.0.1') {
  const app = buildApp();
  try {
    // Keep local until profile ownership and ingestion authorization exist.
    await app.listen({ port, host });
    return app;
  } catch (error) {
    await app.close();
    throw error;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const app = await startServer(
      readPort(process.env.PORT),
      process.env.HOST ?? '127.0.0.1',
    );
    console.log(`Aptus: ${app.listeningOrigin}/health`);

    const stop = async () => {
      const deadline = setTimeout(() => process.exit(1), 10_000);
      deadline.unref();
      try {
        await app.close();
      } catch {
        console.error('Could not shut down Aptus cleanly.');
        process.exitCode = 1;
      } finally {
        clearTimeout(deadline);
      }
    };
    process.once('SIGINT', () => void stop());
    process.once('SIGTERM', () => void stop());
  } catch {
    console.error(
      'Could not start Fastify. Check PORT and whether it is in use.',
    );
    process.exitCode = 1;
  }
}
