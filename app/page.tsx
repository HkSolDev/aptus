import { CatalogueGrid } from '@/components/jobs/catalogue-grid';

export default async function HomePage(props: {
  searchParams?: Promise<{ page?: string }>;
}) {
  const searchParams = await props.searchParams;
  const rawPage = searchParams?.page ?? '1';
  const page = /^[1-9]\d*$/.test(rawPage) ? Number(rawPage) : 1;

  return (
    <>
      <section className="intro" aria-labelledby="page-title">
        <div>
          <p className="eyebrow">GOVERNMENT JOBS · A CLEARER START</p>
          <h1 id="page-title">
            Find your next
            <br />
            <em>possibility.</em>
          </h1>
          <p className="intro-copy">
            Browse government job notifications without signing in. Add your
            profile when you want to check suitable matches, then verify the
            source.
          </p>
        </div>
        <div className="intro-note">
          <span className="note-index" aria-hidden="true">
            01 — 03
          </span>
          <p>
            Explore first.
            <br />
            Check your matches.
            <br />A more informed next step.
          </p>
          <span className="small muted">
            Built for reading, checking, and deciding.
          </span>
        </div>
      </section>

      <CatalogueGrid page={page} />
    </>
  );
}
