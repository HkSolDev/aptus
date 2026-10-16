import type { JobFilters } from './public-job-filters.js';

export interface HomeView {
  layout: 'rows' | 'cards';
  recLayout: 'rows' | 'cards';
  recSort: 'soonest' | 'furthest';
  reviewProfile?: 'guest' | 'setup' | 'ready';
}

export function readHomeView(
  params: URLSearchParams,
  allowReview = false,
): HomeView | null {
  const layout = params.get('layout') ?? 'rows';
  const recLayout = params.get('recLayout') ?? 'cards';
  const recSort = params.get('recSort') ?? 'soonest';
  const reviewProfile = allowReview
    ? (params.get('reviewProfile') ?? 'ready')
    : undefined;
  if (
    ['layout', 'recLayout', 'recSort', 'reviewProfile'].some(
      (key) => params.getAll(key).length > 1,
    ) ||
    !['rows', 'cards'].includes(layout) ||
    !['rows', 'cards'].includes(recLayout) ||
    !['soonest', 'furthest'].includes(recSort) ||
    (reviewProfile !== undefined &&
      !['guest', 'setup', 'ready'].includes(reviewProfile))
  )
    return null;
  return {
    layout: layout as HomeView['layout'],
    recLayout: recLayout as HomeView['recLayout'],
    recSort: recSort as HomeView['recSort'],
    ...(reviewProfile
      ? { reviewProfile: reviewProfile as HomeView['reviewProfile'] }
      : {}),
  };
}

export function homeSearchParams(
  filters: JobFilters,
  page: number,
  view: HomeView,
) {
  const params = new URLSearchParams({ sort: filters.sort });
  if (filters.q) params.set('q', filters.q);
  if (filters.qualification) params.set('qualification', filters.qualification);
  if (page > 1) params.set('page', String(page));
  params.set('layout', view.layout);
  params.set('recLayout', view.recLayout);
  params.set('recSort', view.recSort);
  if (view.reviewProfile) params.set('reviewProfile', view.reviewProfile);
  return params;
}
