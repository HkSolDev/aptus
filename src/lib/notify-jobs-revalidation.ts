// Best-effort cache notification after a publication has committed.
// The publication has already succeeded when this runs: a failed or
// unconfigured notification is logged and swallowed, never reported as a
// publication failure. Retrying is safe because the receiver only
// re-marks the shared jobs tag stale and re-warms page-one entries.
export async function notifyJobsRevalidated(
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const url = env.FRONTEND_REVALIDATE_URL;
  const token = env.INGEST_TOKEN;
  if (!url || !token) return;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(3000),
      });
      if (response.ok) return;
      console.error(
        `jobs revalidation notification failed with ${response.status}`,
      );
    } catch {
      console.error('jobs revalidation notification failed');
    }
  }
}
