import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReviewQueueView } from '../components/admin/review-queue-view.tsx';

test('F: queue outage renders unavailable state, not an empty queue', () => {
  const markup = renderToStaticMarkup(
    createElement(ReviewQueueView, {
      initialItems: [],
      totalItems: 0,
      countsAsOf: new Date().toISOString(),
      initialNextCursor: null,
      initialError: 'Queue temporarily unavailable',
    }),
  );
  assert.match(markup, /temporarily unavailable/i);
  assert.match(markup, /retry/i);
  assert.doesNotMatch(markup, /No candidates are currently held/);
});

test('F: successful empty response renders the empty queue', () => {
  const markup = renderToStaticMarkup(
    createElement(ReviewQueueView, {
      initialItems: [],
      totalItems: 0,
      countsAsOf: new Date().toISOString(),
      initialNextCursor: null,
      initialError: null,
    }),
  );
  assert.match(markup, /No candidates are currently held/);
});

test('C: queue offers next-page navigation and labels page role count', () => {
  const markup = renderToStaticMarkup(
    createElement(ReviewQueueView, {
      initialItems: [
        {
          id: 'item-1',
          bundle_id: 'b1',
          title: 'Engineer — Example',
          source_name: 'Example',
          source_url: 'https://example.gov.in',
          role_count: 2,
          status: 'held',
          hold_reason: null,
          current_revision: null,
          updated_at: new Date().toISOString(),
        },
      ],
      totalItems: 25,
      countsAsOf: new Date().toISOString(),
      initialNextCursor: 'item-1',
      initialError: null,
    }),
  );
  assert.match(markup, /Load more|Next page/);
  assert.match(markup, /roles on this page/);
});
