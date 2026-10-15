'use client';

import Form from 'next/form';
import { useRouter } from 'next/navigation';
import { homeSearchParams, type HomeView } from '@/frontend/home-view';
import type { JobFilters } from '@/frontend/public-job-filters';

export function HomeViewFields({
  view,
  omit,
}: {
  view: HomeView;
  omit?: string;
}) {
  return Object.entries(view)
    .filter(([key, value]) => key !== omit && value !== undefined)
    .map(([key, value]) => (
      <input key={key} type="hidden" name={key} value={value} />
    ));
}

export function HomeLayoutControls({
  filters,
  view,
  scope = 'all',
  page = 1,
}: {
  filters: JobFilters;
  view: HomeView;
  scope?: 'all' | 'rec';
  page?: number;
}) {
  const router = useRouter();
  const key = scope === 'all' ? 'layout' : 'recLayout';
  const params = homeSearchParams(filters, page, view);
  params.delete(key);
  return (
    <form
      action="/"
      method="get"
      onSubmit={(event) => {
        const submitter =
          event.nativeEvent instanceof SubmitEvent
            ? event.nativeEvent.submitter
            : null;
        if (!(submitter instanceof HTMLButtonElement)) return;
        event.preventDefault();
        const nextParams = new URLSearchParams(params);
        nextParams.set(key, submitter.value);
        router.push(`/?${nextParams}`, { scroll: false });
      }}
      className="home-layout-switch"
      aria-label={scope === 'all' ? 'All jobs layout' : 'Recommendation layout'}
    >
      {Array.from(params, ([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {(['rows', 'cards'] as const).map((mode) => (
        <button
          type="submit"
          key={mode}
          name={key}
          value={mode}
          aria-pressed={view[key] === mode}
        >
          {mode === 'rows' ? 'Rows' : 'Cards'}
        </button>
      ))}
    </form>
  );
}

export function HomeReviewControls({ view }: { view: HomeView }) {
  return (
    <Form action="/" className="home-review-tools">
      <p>
        Local design review · fictional jobs and profile · no real sign-in or
        matching
      </p>
      <HomeViewFields view={view} omit="reviewProfile" />
      <label>
        Review profile
        <select
          name="reviewProfile"
          defaultValue={view.reviewProfile}
          onChange={(event) => event.currentTarget.form?.requestSubmit()}
        >
          <option value="guest">Guest</option>
          <option value="setup">Needs profile</option>
          <option value="ready">Example profile ready</option>
        </select>
      </label>
      <noscript>
        <button type="submit">Show review state</button>
      </noscript>
    </Form>
  );
}
