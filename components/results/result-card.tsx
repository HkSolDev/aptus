import { ExplanationBox } from './explanation-box';
import type { MatchedPost, ManualPost } from '@/frontend/types';

function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function ResultCard({
  post,
  userId,
  isManualCheck,
}: {
  post: MatchedPost | ManualPost;
  userId: string;
  isManualCheck: boolean;
}) {
  const matched = !isManualCheck ? (post as MatchedPost) : null;
  const manual = isManualCheck ? (post as ManualPost) : null;

  return (
    <article className="job-card">
      <div className="job-topline">
        <span className="small muted">{post.sourceName}</span>
        {matched?.categoryRelaxationApplied && (
          <span className="badge">{matched.categoryRelaxationApplied}</span>
        )}
      </div>

      <h3 className="job-title">{post.postName}</h3>

      {manual?.reason && (
        <p className="notice notice-error small job-reason" role="note">
          {manual.reason}
        </p>
      )}

      <dl className="job-facts">
        {matched && (
          <div>
            <dt>Age status</dt>
            <dd>{matched.ageComparison}</dd>
          </div>
        )}
        {manual?.educationRequired && (
          <div>
            <dt>Education</dt>
            <dd>{manual.educationRequired}</dd>
          </div>
        )}
        {post.payLevel && (
          <div>
            <dt>Pay level</dt>
            <dd>{post.payLevel}</dd>
          </div>
        )}
      </dl>

      <div className="job-actions">
        {isValidUrl(post.sourceUrl) ? (
          <a
            className="source-link"
            href={post.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            Verify at source ↗
          </a>
        ) : (
          <span className="small muted">Source URL unavailable</span>
        )}

        <ExplanationBox postId={post.id} userId={userId} />
      </div>
    </article>
  );
}
