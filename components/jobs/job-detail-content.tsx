import Link from 'next/link';
import React, { type ReactNode } from 'react';
import { JobDetailSection, JobPreviewSaveButton } from './job-detail-section';
import styles from './job-detail-content.module.css';

type EducationOption = {
  minimum_level?: string | null;
  minimum_marks_percent?: number | null;
  qualification?: string | null;
  subject_requirement?: string | null;
  conditions?: string | null;
};

type AgeRule = {
  category?: string | null;
  gender?: string | null;
  min_age?: number | null;
  max_age?: number | null;
  relaxation_years?: number | null;
  conditions?: string | null;
};

type EligibilityRules = {
  gender_requirement?: string | null;
  category_requirement?: string[] | null;
  education_options?: EducationOption[] | null;
  age_rules?: AgeRule[] | null;
  relaxation_combination_rule?: string | null;
};

export interface JobDetailData {
  id: string;
  postName: string;
  organization?: string | null;
  postGroup?: string | null;
  payLevel?: string | null;
  vacancies?: number | null;
  applicationLastDate?: string | null;
  ageAsOnDate?: string | null;
  minAge?: number | null;
  maxAge?: number | null;
  educationRequired?: string | null;
  minEducationLevel?: string | null;
  minMarksPercent?: number | null;
  categoryRelaxationApplies?: boolean | null;
  categoryRelaxationRules?: Record<string, unknown> | null;
  eligibilityRules?: EligibilityRules | null;
  designReview?: boolean;
  source?: {
    name?: string | null;
    url?: string | null;
    notificationPdfUrl?: string | null;
    officialSiteUrl?: string | null;
    applyUrl?: string | null;
    fetchedAt?: string | null;
  } | null;
}

function safeUrl(value: string | null | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? value : null;
  } catch {
    return null;
  }
}

function formatDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

function ageRange(
  min: number | null | undefined,
  max: number | null | undefined,
) {
  if (min != null && max != null) return `${min}–${max} years`;
  if (max != null) return `Up to ${max} years`;
  if (min != null) return `${min} years or above`;
  return null;
}

function formatEducationLevel(value: string) {
  const labels: Record<string, string> = {
    TENTH: '10th pass',
    TWELFTH: '12th pass',
    DIPLOMA: 'Diploma',
    BACHELOR: 'Bachelor’s degree',
    BACHELORS: 'Bachelor’s degree',
    MASTER: 'Master’s degree',
    MASTERS: 'Master’s degree',
    PHD: 'Doctorate',
  };
  return labels[value] ?? value;
}

function recruitmentNotice(source: JobDetailData['source']) {
  return safeUrl(source?.notificationPdfUrl) ?? safeUrl(source?.url);
}

function RecruitmentNoticeLink({
  source,
  previewOnly = false,
  className,
}: {
  source: JobDetailData['source'];
  previewOnly?: boolean;
  className?: string;
}) {
  const href = recruitmentNotice(source);
  if (previewOnly) {
    return (
      <span className={`${styles.resourceLink} ${className ?? ''}`}>
        Recruitment notice{' '}
        <span className={styles.previewOnly}>Preview only</span>
      </span>
    );
  }
  return href ? (
    <a className={className} href={href} target="_blank" rel="noreferrer">
      Read the recruitment notice ↗
    </a>
  ) : null;
}

function Unavailable({
  children,
  source,
}: {
  children: ReactNode;
  source: JobDetailData['source'];
}) {
  return (
    <p className={styles.unavailable}>
      {children} <RecruitmentNoticeLink source={source} />
    </p>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.fact}>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function ExternalLink({
  href,
  children,
  previewOnly = false,
  className,
}: {
  href: string | null | undefined;
  children: ReactNode;
  previewOnly?: boolean;
  className?: string;
}) {
  const safeHref = safeUrl(href);
  if (previewOnly) {
    return (
      <span className={`${styles.resourceLink} ${className ?? ''}`}>
        {children} <span className={styles.previewOnly}>Preview only</span>
      </span>
    );
  }
  return safeHref ? (
    <a
      className={`${styles.resourceLink} ${className ?? ''}`}
      href={safeHref}
      target="_blank"
      rel="noreferrer"
    >
      {children} ↗
    </a>
  ) : null;
}

export function JobDetailContent({ job }: { job: JobDetailData }) {
  const source = job.source;
  const rules = job.eligibilityRules;
  const educationOptions =
    rules?.education_options?.filter(
      (option) =>
        option.qualification || option.minimum_level || option.conditions,
    ) ?? [];
  const ageRules =
    rules?.age_rules?.filter(
      (rule) =>
        rule.category ||
        rule.gender ||
        rule.min_age != null ||
        rule.max_age != null,
    ) ?? [];
  const relaxations = Object.entries(job.categoryRelaxationRules ?? {}).filter(
    (entry): entry is [string, number] => typeof entry[1] === 'number',
  );
  const hasApplicantRequirements =
    Boolean(rules?.gender_requirement) ||
    Boolean(rules?.category_requirement?.length);
  const hasLinks = Boolean(
    job.designReview ||
    safeUrl(source?.notificationPdfUrl) ||
    safeUrl(source?.applyUrl) ||
    safeUrl(source?.officialSiteUrl) ||
    safeUrl(source?.url),
  );
  const deadline = formatDate(job.applicationLastDate);
  const baseAge = ageRange(job.minAge, job.maxAge);
  const previewOnly = Boolean(job.designReview);

  return (
    <article className={`${styles.page} job-detail`}>
      <nav className={styles.topActions} aria-label="Job actions">
        <Link href="/#jobs" className="button button-secondary">
          ← Back to all jobs
        </Link>
        {job.designReview ? <JobPreviewSaveButton /> : null}
      </nav>

      <header className={styles.header}>
        {job.designReview ? (
          <p className={styles.fixtureLabel}>
            Complete example · fictional recruitment
          </p>
        ) : null}
        <h1>{job.postName}</h1>
        {job.organization ? (
          <p className={styles.organization}>{job.organization}</p>
        ) : (
          <Unavailable source={source}>
            Recruiting organization unavailable.
          </Unavailable>
        )}
        {deadline ? (
          <p className={styles.deadline}>Application deadline: {deadline}</p>
        ) : null}
      </header>

      <div className={styles.grid}>
        <aside className={styles.applyPanel} aria-label="Application links">
          {deadline ? (
            <p className={styles.applyDeadline}>Apply by {deadline}</p>
          ) : (
            <Unavailable source={source}>
              Application deadline unavailable.
            </Unavailable>
          )}
          <ExternalLink
            href={source?.applyUrl}
            previewOnly={previewOnly}
            className={styles.primaryAction}
          >
            {previewOnly ? 'Preview application details' : 'Apply now'}
          </ExternalLink>
          <RecruitmentNoticeLink source={source} previewOnly={previewOnly} />
          <p className="small muted">
            Read the full notice before applying. Eligibility is verified by the
            recruiting organization.
          </p>
          {job.designReview ? (
            <p className="small muted">
              This is a fictional design-review notice. No application is
              submitted from this preview.
            </p>
          ) : null}
        </aside>

        <div className={styles.sections}>
          <JobDetailSection title="Qualification routes">
            {job.educationRequired ? (
              <p className={styles.intro}>{job.educationRequired}</p>
            ) : null}
            {educationOptions.length ? (
              <div className={styles.routes}>
                {educationOptions.map((option, index) => (
                  <div
                    className={styles.route}
                    key={`${option.qualification ?? option.minimum_level}-${index}`}
                  >
                    {index > 0 ? <p className={styles.or}>OR</p> : null}
                    <h3>{option.qualification ?? option.minimum_level}</h3>
                    <dl>
                      {option.minimum_level ? (
                        <Fact label="Minimum level">
                          {formatEducationLevel(option.minimum_level)}
                        </Fact>
                      ) : null}
                      {option.minimum_marks_percent != null ? (
                        <Fact label="Minimum marks">
                          {option.minimum_marks_percent}%
                        </Fact>
                      ) : null}
                      {option.subject_requirement ? (
                        <Fact label="Subject">
                          {option.subject_requirement}
                        </Fact>
                      ) : null}
                    </dl>
                    {option.conditions ? (
                      <p className={styles.conditions}>{option.conditions}</p>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : job.educationRequired ? (
              <dl className={styles.factList}>
                {job.minEducationLevel ? (
                  <Fact label="Minimum level">
                    {formatEducationLevel(job.minEducationLevel)}
                  </Fact>
                ) : null}
                {job.minMarksPercent != null ? (
                  <Fact label="Minimum marks">{job.minMarksPercent}%</Fact>
                ) : null}
              </dl>
            ) : (
              <Unavailable source={source}>
                Qualification details unavailable.
              </Unavailable>
            )}
            <p className="small muted">
              <RecruitmentNoticeLink
                source={source}
                previewOnly={previewOnly}
              />
            </p>
          </JobDetailSection>

          <JobDetailSection title="Age requirements and relaxations">
            {baseAge ? (
              <p className={styles.intro}>
                Base age: <strong>{baseAge}</strong>
              </p>
            ) : null}
            {job.ageAsOnDate ? (
              <p className="small muted">
                Age calculated as on {formatDate(job.ageAsOnDate)}.
              </p>
            ) : null}
            {ageRules.length ? (
              <div className={styles.ageGroups}>
                <h3>Age groups</h3>
                <dl className={styles.factList}>
                  {ageRules.map((rule, index) => (
                    <Fact
                      key={`${rule.category ?? rule.gender}-${index}`}
                      label={rule.category ?? rule.gender ?? 'Applicant group'}
                    >
                      <strong>
                        {ageRange(rule.min_age, rule.max_age) ?? 'See notice'}
                      </strong>
                      {rule.relaxation_years != null
                        ? ` · ${rule.relaxation_years} year relaxation`
                        : ''}
                      {rule.conditions ? (
                        <span className={styles.conditionDetail}>
                          {rule.conditions}
                        </span>
                      ) : null}
                    </Fact>
                  ))}
                </dl>
              </div>
            ) : !baseAge ? (
              <Unavailable source={source}>
                Age requirements unavailable.
              </Unavailable>
            ) : null}
            {job.categoryRelaxationApplies && relaxations.length ? (
              <div className={styles.relaxations}>
                <h3>Category relaxations</h3>
                <dl className={styles.factList}>
                  {relaxations.map(([category, years]) => (
                    <Fact key={category} label={category}>
                      {years} years
                    </Fact>
                  ))}
                </dl>
              </div>
            ) : null}
            {rules?.relaxation_combination_rule ? (
              <p className="notice">{rules.relaxation_combination_rule}</p>
            ) : null}
            <p className="small muted">
              <RecruitmentNoticeLink
                source={source}
                previewOnly={previewOnly}
              />
            </p>
          </JobDetailSection>

          <section className={styles.card}>
            <h2>Applicant requirements</h2>
            {hasApplicantRequirements ? (
              <dl className={styles.factList}>
                {rules?.gender_requirement ? (
                  <Fact label="Gender">{rules.gender_requirement}</Fact>
                ) : null}
                {rules?.category_requirement?.length ? (
                  <Fact label="Categories">
                    {rules.category_requirement.join(', ')}
                  </Fact>
                ) : null}
              </dl>
            ) : (
              <Unavailable source={source}>
                Applicant requirement details unavailable.
              </Unavailable>
            )}
          </section>

          {job.vacancies != null || job.payLevel || job.postGroup ? (
            <section className={styles.card}>
              <h2>Vacancies and pay</h2>
              <dl className={styles.factList}>
                {job.vacancies != null ? (
                  <Fact label="Vacancies">{job.vacancies}</Fact>
                ) : null}
                {job.payLevel ? (
                  <Fact label="Pay level">{job.payLevel}</Fact>
                ) : null}
                {job.postGroup ? (
                  <Fact label="Post group">{job.postGroup}</Fact>
                ) : null}
              </dl>
            </section>
          ) : null}

          <section className={styles.card}>
            <h2>Recruitment links</h2>
            {hasLinks ? (
              <div className={styles.links}>
                <ExternalLink
                  href={source?.notificationPdfUrl}
                  previewOnly={previewOnly}
                >
                  Recruitment notice (PDF)
                </ExternalLink>
                <ExternalLink href={source?.applyUrl} previewOnly={previewOnly}>
                  Application portal
                </ExternalLink>
                <ExternalLink
                  href={source?.officialSiteUrl}
                  previewOnly={previewOnly}
                >
                  Official recruitment site
                </ExternalLink>
                <ExternalLink href={source?.url} previewOnly={previewOnly}>
                  Source listing
                </ExternalLink>
              </div>
            ) : (
              <Unavailable source={source}>
                Recruitment links unavailable.
              </Unavailable>
            )}
            {source?.fetchedAt ? (
              <p className="small muted">
                Collected {source.fetchedAt}. Collection date is not a
                verification date.
              </p>
            ) : null}
          </section>
        </div>
      </div>
    </article>
  );
}
