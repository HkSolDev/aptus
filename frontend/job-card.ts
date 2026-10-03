import { explainPost } from './api.js';
import { cloneTemplate, find } from './dom.js';
import type { ManualPost, MatchedPost } from './types.js';

function addFact(list: HTMLElement, label: string, value: string): void {
  const row = document.createElement('div');
  const term = document.createElement('dt');
  const description = document.createElement('dd');
  term.textContent = label;
  description.textContent = value;
  row.append(term, description);
  list.append(row);
}

export function createJobCard(
  post: MatchedPost | ManualPost,
  userId: string,
): HTMLElement {
  const card = cloneTemplate<HTMLElement>('job-template');
  const manual = 'reason' in post;
  // API text is always textContent: notification content cannot become executable HTML.
  find('.job-source', card).textContent = post.sourceName;
  find('.job-title', card).textContent = post.postName;
  const badge = find('.job-status', card);
  badge.textContent = manual ? 'Manual check needed' : 'Preliminary match';
  badge.classList.toggle('badge-warning', manual);
  const facts = find('.job-facts', card);
  addFact(facts, 'Pay level', post.payLevel ?? 'Not specified');
  if ('ageComparison' in post) {
    addFact(facts, 'Age check', post.ageComparison);
    if (post.categoryRelaxationApplied)
      addFact(facts, 'Relaxation', post.categoryRelaxationApplied);
  }
  if ('educationRequired' in post && post.educationRequired)
    addFact(facts, 'Education', post.educationRequired);
  if ('reason' in post) {
    const reason = find('.job-reason', card);
    reason.hidden = false;
    reason.textContent = post.reason;
  }

  const link = find<HTMLAnchorElement>('.source-link', card);
  try {
    const url = new URL(post.sourceUrl);
    if (
      !['https:', 'http:'].includes(url.protocol) ||
      url.username ||
      url.password
    )
      throw new Error('Unsafe source URL');
    link.href = url.href;
  } catch {
    link.removeAttribute('href');
    link.removeAttribute('target');
    link.textContent = 'Source link unavailable';
  }

  const button = find<HTMLButtonElement>('.explain-button', card);
  const explanation = find('.explanation', card);
  explanation.id = `explanation-${post.id}`;
  button.setAttribute('aria-controls', explanation.id);
  let loaded = false;
  button.addEventListener('click', async () => {
    if (loaded) {
      explanation.hidden = !explanation.hidden;
      button.setAttribute('aria-expanded', String(!explanation.hidden));
      button.textContent = explanation.hidden
        ? 'Explain requirements'
        : 'Hide explanation';
      return;
    }
    button.disabled = true;
    button.textContent = 'Checking requirements…';
    button.setAttribute('aria-expanded', 'true');
    explanation.hidden = false;
    explanation.textContent = 'Reading the saved requirements…';
    explanation.setAttribute('aria-busy', 'true');
    try {
      explanation.textContent = await explainPost(post.id, userId);
      explanation.classList.remove('notice-error');
      loaded = true;
      button.textContent = 'Hide explanation';
    } catch (error) {
      explanation.textContent =
        error instanceof Error
          ? error.message
          : 'Couldn’t load the explanation.';
      explanation.classList.add('notice-error');
      button.textContent = 'Retry explanation';
    } finally {
      button.disabled = false;
      explanation.setAttribute('aria-busy', 'false');
    }
  });
  return card;
}
