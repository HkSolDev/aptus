import { find } from './dom.js';
import { createJobCard } from './job-card.js';
import type { MatchResponse } from './types.js';

export function setResultsLoading(loading: boolean): void {
  find('#results').setAttribute('aria-busy', String(loading));
  find('#results-loading').hidden = !loading;
  find('#results-initial').hidden = loading || !find('#results-content').hidden;
  if (loading)
    find('#results-status').textContent =
      'Checking saved age, education, and marks requirements…';
}

export function markResultsStale(): void {
  if (!find('#results-content').hidden) find('#results-stale').hidden = false;
}

export function renderResults(data: MatchResponse): void {
  find('#results-content').hidden = false;
  find('#results-initial').hidden = true;
  find('#results-stale').hidden = true;
  const total = data.matches.length + data.needsManualCheck.length;
  find('#result-count').textContent =
    `${total} ${total === 1 ? 'post' : 'posts'} returned`;
  find('#results-status').textContent =
    `${data.matches.length} preliminary matches · ${data.needsManualCheck.length} need a manual check. Verify the source before applying.`;

  const sources = data.sourcesChecked.length
    ? data.sourcesChecked
    : ['No sources are currently stored.'];
  find('#sources-list').replaceChildren(
    ...sources.map((source) => {
      const item = document.createElement('li');
      item.textContent = source;
      return item;
    }),
  );
  for (const [prefix, posts] of [
    ['matched', data.matches],
    ['manual', data.needsManualCheck],
  ] as const) {
    find(`#${prefix}-section`).hidden = posts.length === 0;
    find(`#${prefix}-count`).textContent = String(posts.length);
    find(`#${prefix}-list`).replaceChildren(
      ...posts.map((post) => createJobCard(post, data.userId)),
    );
  }
  find('#empty-results').hidden = total !== 0;
  find('#results-title').focus();
}
