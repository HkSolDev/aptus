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

export type ReviewedPay = {
  minimum_amount?: number | null;
  maximum_amount?: number | null;
  currency?: string | null;
  period?: string | null;
  conditions?: string | null;
};

export type ReviewedExperienceRule = {
  minimum_years?: number | null;
  conditions?: string | null;
};

export type ReviewedFeeRule = {
  categories?: string[] | null;
  amount?: number | null;
  currency?: string | null;
  conditions?: string | null;
};

export type ReviewedVacancyCount = {
  category?: string | null;
  region_or_organisation?: string | null;
  count?: number | null;
};

export interface ReviewedDetails {
  post_name?: string | null;
  recruiting_body?: string | null;
  advertisement_number?: string | null;
  vacancies?: number | null;
  vacancy_breakdown?: ReviewedVacancyCount[] | null;
  application_start_date?: string | null;
  application_last_date?: string | null;
  fee_payment_last_date?: string | null;
  exam_dates?: string[] | null;
  pay?: ReviewedPay | null;
  pay_level?: string | null;
  min_age?: number | null;
  max_age?: number | null;
  age_as_on_date?: string | null;
  education_required?: string | null;
  post_group?: string | null;
  min_education_level?: string | null;
  min_marks_percent?: number | null;
  category_relaxation_applies?: boolean | null;
  category_relaxation_rules?: Record<string, unknown> | null;
  nationality_requirement?: string | null;
  employment_type?: string | null;
  locations?: string[] | null;
  experience_rules?: ReviewedExperienceRule[] | null;
  fee_rules?: ReviewedFeeRule[] | null;
  selection_process?: string[] | null;
  application_steps?: string[] | null;
  documents_required?: string[] | null;
  language_requirements?: string[] | null;
  other_requirements?: string[] | null;
  official_site_url?: string | null;
  apply_url?: string | null;
}

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
  reviewedDetails?: ReviewedDetails | null;
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

function safeUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? value : null;
  } catch {
    return null;
  }
}

function formatDate(value: string | null | undefined): string | null {
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
): string | null {
  if (min != null && max != null) return `${min}–${max} years`;
  if (max != null) return `Maximum ${max} years`;
  if (min != null) return `Minimum ${min} years`;
  return null;
}

function formatEducationLevel(value: string): string {
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

function formatCurrency(amount: number, currency?: string | null): string {
  const formatted = amount.toLocaleString('en-IN');
  if (currency?.toUpperCase() === 'INR') {
    return `₹${formatted}`;
  }
  if (currency?.toUpperCase() === 'USD') {
    return `$${formatted}`;
  }
  return currency
    ? `${currency} ${formatted}`
    : `${formatted} (currency unspecified)`;
}

function formatPay(pay: ReviewedPay | null | undefined): string | null {
  if (!pay) return null;
  const { minimum_amount, maximum_amount, currency, period } = pay;
  const hasMin = typeof minimum_amount === 'number';
  const hasMax = typeof maximum_amount === 'number';

  if (!hasMin && !hasMax) return null;

  let amountStr = '';
  if (hasMin && hasMax) {
    if (minimum_amount === maximum_amount) {
      amountStr = formatCurrency(minimum_amount, currency);
    } else {
      amountStr = `${formatCurrency(minimum_amount, currency)} – ${formatCurrency(maximum_amount, currency)}`;
    }
  } else if (hasMin) {
    amountStr = `From ${formatCurrency(minimum_amount, currency)}`;
  } else if (hasMax) {
    amountStr = `Up to ${formatCurrency(maximum_amount, currency)}`;
  }

  if (period && period.trim()) {
    return `${amountStr} (${period.trim()})`;
  }
  return amountStr;
}

function formatFee(rule: ReviewedFeeRule): string {
  if (rule.amount === 0) {
    return `Free / Nil (${formatCurrency(0, rule.currency)})`;
  }
  if (typeof rule.amount === 'number') {
    return formatCurrency(rule.amount, rule.currency);
  }
  return rule.conditions?.trim() ? 'See conditions' : 'See recruitment notice';
}

function formatExperience(rule: ReviewedExperienceRule): string {
  if (rule.minimum_years === 0) {
    return 'No minimum experience required (0 years)';
  }
  if (typeof rule.minimum_years === 'number') {
    return `${rule.minimum_years} ${rule.minimum_years === 1 ? 'year' : 'years'}`;
  }
  return rule.conditions?.trim()
    ? 'Experience required'
    : 'See recruitment notice';
}

function recruitmentNotice(
  source: JobDetailData['source'],
  reviewedDetails?: ReviewedDetails | null,
): string | null {
  return (
    safeUrl(source?.notificationPdfUrl) ??
    safeUrl(source?.url) ??
    safeUrl(reviewedDetails?.official_site_url)
  );
}

function RecruitmentNoticeLink({
  source,
  reviewedDetails,
  previewOnly = false,
  className,
}: {
  source: JobDetailData['source'];
  reviewedDetails?: ReviewedDetails | null;
  previewOnly?: boolean;
  className?: string;
}) {
  const href = recruitmentNotice(source, reviewedDetails);
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
  reviewedDetails,
  previewOnly = false,
}: {
  children: ReactNode;
  source: JobDetailData['source'];
  reviewedDetails?: ReviewedDetails | null;
  previewOnly?: boolean;
}) {
  const noticeUrl = recruitmentNotice(source, reviewedDetails);
  return (
    <p className={styles.unavailable}>
      {children}{' '}
      {noticeUrl || previewOnly ? (
        <RecruitmentNoticeLink
          source={source}
          reviewedDetails={reviewedDetails}
          previewOnly={previewOnly}
        />
      ) : null}
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
  const reviewed = job.reviewedDetails;
  const rules = job.eligibilityRules;
  const previewOnly = Boolean(job.designReview);

  const organization = job.organization || reviewed?.recruiting_body;
  const deadlineRaw =
    job.applicationLastDate ?? reviewed?.application_last_date;
  const deadline = formatDate(deadlineRaw);

  const applyUrl = safeUrl(reviewed?.apply_url) ?? safeUrl(source?.applyUrl);
  const noticeUrl = recruitmentNotice(source, reviewed);

  // Education / Qualifications
  const educationRequired =
    job.educationRequired ?? reviewed?.education_required;
  const minEducationLevel =
    job.minEducationLevel ?? reviewed?.min_education_level;
  const minMarksPercent = job.minMarksPercent ?? reviewed?.min_marks_percent;
  const educationOptions =
    rules?.education_options?.filter(
      (option) =>
        option.qualification || option.minimum_level || option.conditions,
    ) ?? [];

  // Age requirements
  const minAge = job.minAge ?? reviewed?.min_age;
  const maxAge = job.maxAge ?? reviewed?.max_age;
  const baseAge = ageRange(minAge, maxAge);
  const ageAsOnRaw = job.ageAsOnDate ?? reviewed?.age_as_on_date;
  const ageAsOn = formatDate(ageAsOnRaw);
  const ageRules =
    rules?.age_rules?.filter(
      (rule) =>
        rule.category ||
        rule.gender ||
        rule.min_age != null ||
        rule.max_age != null,
    ) ?? [];
  const relaxations = Object.entries(
    job.categoryRelaxationRules ?? reviewed?.category_relaxation_rules ?? {},
  ).filter((entry): entry is [string, number] => typeof entry[1] === 'number');

  // Applicant requirements
  const nationality = reviewed?.nationality_requirement;
  const hasApplicantRequirements =
    Boolean(rules?.gender_requirement) ||
    Boolean(rules?.category_requirement?.length) ||
    Boolean(nationality);

  // Vacancies, Pay and Employment
  const vacancies = job.vacancies ?? reviewed?.vacancies;
  const payLevel = job.payLevel ?? reviewed?.pay_level;
  const postGroup = job.postGroup ?? reviewed?.post_group;
  const employmentType = reviewed?.employment_type;
  const formattedPay = formatPay(reviewed?.pay);
  const payConditions = reviewed?.pay?.conditions;
  const locations =
    reviewed?.locations?.filter(
      (l): l is string => typeof l === 'string' && Boolean(l.trim()),
    ) ?? [];
  const breakdown =
    reviewed?.vacancy_breakdown?.filter((b): b is ReviewedVacancyCount =>
      Boolean(b && typeof b.count === 'number'),
    ) ?? [];
  const hasVacanciesPay =
    vacancies != null ||
    Boolean(payLevel) ||
    Boolean(postGroup) ||
    Boolean(employmentType) ||
    Boolean(formattedPay) ||
    Boolean(payConditions) ||
    locations.length > 0 ||
    breakdown.length > 0;

  // Experience rules
  const experienceRules =
    reviewed?.experience_rules?.filter(
      (rule) =>
        rule &&
        (typeof rule.minimum_years === 'number' ||
          (typeof rule.conditions === 'string' && rule.conditions.trim())),
    ) ?? [];

  // Fee rules
  const feeRules =
    reviewed?.fee_rules?.filter(
      (rule) =>
        rule &&
        (typeof rule.amount === 'number' ||
          (Array.isArray(rule.categories) && rule.categories.length > 0) ||
          (typeof rule.conditions === 'string' && rule.conditions.trim())),
    ) ?? [];
  const feeLastDate = formatDate(reviewed?.fee_payment_last_date);
  const hasFees = feeRules.length > 0 || Boolean(feeLastDate);

  // Selection process
  const selectionProcess =
    reviewed?.selection_process?.filter(
      (step): step is string =>
        typeof step === 'string' && Boolean(step.trim()),
    ) ?? [];

  // Application steps
  const applicationSteps =
    reviewed?.application_steps?.filter(
      (step): step is string =>
        typeof step === 'string' && Boolean(step.trim()),
    ) ?? [];

  // Documents required
  const documentsRequired =
    reviewed?.documents_required?.filter(
      (doc): doc is string => typeof doc === 'string' && Boolean(doc.trim()),
    ) ?? [];

  // Additional requirements & dates
  const appStartDate = formatDate(reviewed?.application_start_date);
  const examDates =
    reviewed?.exam_dates?.filter(
      (d): d is string => typeof d === 'string' && Boolean(d.trim()),
    ) ?? [];
  const languageRequirements =
    reviewed?.language_requirements?.filter(
      (l): l is string => typeof l === 'string' && Boolean(l.trim()),
    ) ?? [];
  const otherRequirements =
    reviewed?.other_requirements?.filter(
      (r): r is string => typeof r === 'string' && Boolean(r.trim()),
    ) ?? [];
  const hasAdditional =
    Boolean(appStartDate) ||
    examDates.length > 0 ||
    languageRequirements.length > 0 ||
    otherRequirements.length > 0;

  // Recruitment links
  const notificationPdf = safeUrl(source?.notificationPdfUrl);
  const portalUrl = applyUrl;
  const officialSite =
    safeUrl(reviewed?.official_site_url) ?? safeUrl(source?.officialSiteUrl);
  const listingUrl = safeUrl(source?.url);
  const hasLinks = Boolean(
    previewOnly || notificationPdf || portalUrl || officialSite || listingUrl,
  );

  return (
    <article className={`${styles.page} job-detail`}>
      <nav className={styles.topActions} aria-label="Job actions">
        <Link href="/#jobs" className="button button-secondary">
          ← Back to all jobs
        </Link>
        {job.designReview ? <JobPreviewSaveButton id={job.id} /> : null}
      </nav>

      <header className={styles.header}>
        {job.designReview ? (
          <p className={styles.fixtureLabel}>
            Complete example · fictional recruitment
          </p>
        ) : null}
        <h1>{job.postName}</h1>
        {organization ? (
          <p className={styles.organization}>{organization}</p>
        ) : (
          <Unavailable
            source={source}
            reviewedDetails={reviewed}
            previewOnly={previewOnly}
          >
            Recruiting organization unavailable here. Verify in the recruitment
            notice.
          </Unavailable>
        )}
        {reviewed?.advertisement_number ? (
          <p className={styles.advertisementNumber}>
            Advt. No. {reviewed.advertisement_number}
          </p>
        ) : null}
        {deadline ? (
          <p className={styles.deadline}>Application deadline: {deadline}</p>
        ) : (
          <p className={styles.unavailable}>
            Deadline unavailable. Check the recruitment notice before applying.{' '}
            <RecruitmentNoticeLink
              source={source}
              reviewedDetails={reviewed}
              previewOnly={previewOnly}
            />
          </p>
        )}
      </header>

      <div className={styles.grid}>
        <aside className={styles.applyPanel} aria-label="Application links">
          {deadline ? (
            <p className={styles.applyDeadline}>Apply by {deadline}</p>
          ) : (
            <p className={styles.unavailable}>
              Deadline unavailable. Check the recruitment notice before
              applying.{' '}
              <RecruitmentNoticeLink
                source={source}
                reviewedDetails={reviewed}
                previewOnly={previewOnly}
              />
            </p>
          )}

          {applyUrl ? (
            <>
              <ExternalLink
                href={applyUrl}
                previewOnly={previewOnly}
                className={styles.primaryAction}
              >
                {previewOnly ? 'Preview application details' : 'Apply now'}
              </ExternalLink>
              <RecruitmentNoticeLink
                source={source}
                reviewedDetails={reviewed}
                previewOnly={previewOnly}
              />
            </>
          ) : noticeUrl || previewOnly ? (
            <ExternalLink
              href={noticeUrl}
              previewOnly={previewOnly}
              className={styles.primaryAction}
            >
              {previewOnly
                ? 'Preview recruitment notice'
                : 'View recruitment notice'}
            </ExternalLink>
          ) : (
            <p className={styles.unavailable}>
              Application and notice links are unavailable for this post.
            </p>
          )}

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
            {educationRequired ? (
              <p className={styles.intro}>{educationRequired}</p>
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
            ) : educationRequired ||
              minEducationLevel ||
              minMarksPercent != null ? (
              <dl className={styles.factList}>
                {minEducationLevel ? (
                  <Fact label="Minimum level">
                    {formatEducationLevel(minEducationLevel)}
                  </Fact>
                ) : null}
                {minMarksPercent != null ? (
                  <Fact label="Minimum marks">{minMarksPercent}%</Fact>
                ) : null}
              </dl>
            ) : (
              <Unavailable
                source={source}
                reviewedDetails={reviewed}
                previewOnly={previewOnly}
              >
                Qualification details unavailable here. Verify in the
                recruitment notice.
              </Unavailable>
            )}
            <p className="small muted">
              <RecruitmentNoticeLink
                source={source}
                reviewedDetails={reviewed}
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
            {(minAge == null) !== (maxAge == null) ? (
              <p className={styles.unavailable}>
                {minAge == null ? 'Minimum' : 'Maximum'} age unavailable here.
                Verify in the recruitment notice.
              </p>
            ) : null}
            {ageAsOn ? (
              <p className="small muted">Age calculated as on {ageAsOn}.</p>
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
              <Unavailable
                source={source}
                reviewedDetails={reviewed}
                previewOnly={previewOnly}
              >
                Age requirements unavailable here. Verify in the recruitment
                notice.
              </Unavailable>
            ) : null}
            {(job.categoryRelaxationApplies ??
              reviewed?.category_relaxation_applies) &&
            relaxations.length ? (
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
                reviewedDetails={reviewed}
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
                {nationality ? (
                  <Fact label="Nationality">{nationality}</Fact>
                ) : null}
              </dl>
            ) : (
              <Unavailable
                source={source}
                reviewedDetails={reviewed}
                previewOnly={previewOnly}
              >
                Applicant requirement details unavailable here. Verify in the
                recruitment notice.
              </Unavailable>
            )}
          </section>

          {hasVacanciesPay ? (
            <section className={styles.card}>
              <h2>Vacancies and pay</h2>
              <dl className={styles.factList}>
                {vacancies != null ? (
                  <Fact label="Total vacancies">{vacancies}</Fact>
                ) : null}
                {employmentType ? (
                  <Fact label="Employment type">{employmentType}</Fact>
                ) : null}
                {postGroup ? <Fact label="Post group">{postGroup}</Fact> : null}
                {payLevel ? <Fact label="Pay level">{payLevel}</Fact> : null}
                {formattedPay ? (
                  <Fact label="Salary">
                    <strong>{formattedPay}</strong>
                    {payConditions ? (
                      <span className={styles.conditionDetail}>
                        {payConditions}
                      </span>
                    ) : null}
                  </Fact>
                ) : payConditions ? (
                  <Fact label="Salary conditions">{payConditions}</Fact>
                ) : null}
                {locations.length ? (
                  <Fact label="Locations">{locations.join(', ')}</Fact>
                ) : null}
              </dl>
              {breakdown.length ? (
                <div className={styles.vacancyBreakdown}>
                  <h3>Vacancy breakdown</h3>
                  <div className={styles.breakdownGrid}>
                    {breakdown.map((item, idx) => {
                      const label =
                        [item.category, item.region_or_organisation]
                          .filter(Boolean)
                          .join(' · ') || 'Unspecified';
                      return (
                        <span key={idx} className={styles.breakdownItem}>
                          {label}: <strong>{item.count}</strong>
                        </span>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </section>
          ) : null}

          {experienceRules.length ? (
            <section className={styles.card}>
              <h2>Experience requirements</h2>
              <dl className={styles.factList}>
                {experienceRules.map((rule, idx) => (
                  <Fact
                    key={idx}
                    label={
                      experienceRules.length > 1
                        ? `Requirement ${idx + 1}`
                        : 'Experience'
                    }
                  >
                    <strong>{formatExperience(rule)}</strong>
                    {rule.conditions ? (
                      <span className={styles.conditionDetail}>
                        {rule.conditions}
                      </span>
                    ) : null}
                  </Fact>
                ))}
              </dl>
            </section>
          ) : null}

          {hasFees ? (
            <section className={styles.card}>
              <h2>Application fees</h2>
              {feeRules.length ? (
                <dl className={styles.factList}>
                  {feeRules.map((rule, idx) => {
                    const catLabel =
                      rule.categories && rule.categories.length > 0
                        ? rule.categories.join(', ')
                        : 'Category unspecified — verify in notice';
                    return (
                      <Fact key={idx} label={catLabel}>
                        <strong>{formatFee(rule)}</strong>
                        {rule.conditions ? (
                          <span className={styles.conditionDetail}>
                            {rule.conditions}
                          </span>
                        ) : null}
                      </Fact>
                    );
                  })}
                </dl>
              ) : null}
              {feeLastDate ? (
                <p className="small muted">
                  Fee payment deadline: {feeLastDate}. Verify payment methods in
                  the recruitment notice.
                </p>
              ) : null}
            </section>
          ) : null}

          {selectionProcess.length ? (
            <section className={styles.card}>
              <h2>Selection process</h2>
              <ol className={styles.stepList}>
                {selectionProcess.map((step, idx) => (
                  <li key={idx}>{step}</li>
                ))}
              </ol>
            </section>
          ) : null}

          {applicationSteps.length ? (
            <section className={styles.card}>
              <h2>How to apply</h2>
              <ol className={styles.stepList}>
                {applicationSteps.map((step, idx) => (
                  <li key={idx}>{step}</li>
                ))}
              </ol>
            </section>
          ) : null}

          {documentsRequired.length ? (
            <section className={styles.card}>
              <h2>Required documents</h2>
              <ul className={styles.bulletList}>
                {documentsRequired.map((doc, idx) => (
                  <li key={idx}>{doc}</li>
                ))}
              </ul>
            </section>
          ) : null}

          {hasAdditional ? (
            <section className={styles.card}>
              <h2>Important dates and additional details</h2>
              <dl className={styles.factList}>
                {appStartDate ? (
                  <Fact label="Applications open">{appStartDate}</Fact>
                ) : null}
                {examDates.length ? (
                  <Fact label="Exam dates">{examDates.join('; ')}</Fact>
                ) : null}
                {languageRequirements.length ? (
                  <Fact label="Languages">
                    {languageRequirements.join(', ')}
                  </Fact>
                ) : null}
              </dl>
              {otherRequirements.length ? (
                <div className={styles.otherRequirements}>
                  <h3>Other requirements</h3>
                  <ul className={styles.bulletList}>
                    {otherRequirements.map((item, idx) => (
                      <li key={idx}>{item}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </section>
          ) : null}

          <section className={styles.card}>
            <h2>Recruitment links</h2>
            {hasLinks ? (
              <div className={styles.links}>
                <ExternalLink href={notificationPdf} previewOnly={previewOnly}>
                  Recruitment notice (PDF)
                </ExternalLink>
                <ExternalLink href={portalUrl} previewOnly={previewOnly}>
                  Application portal
                </ExternalLink>
                <ExternalLink href={officialSite} previewOnly={previewOnly}>
                  Official recruitment site
                </ExternalLink>
                <ExternalLink href={listingUrl} previewOnly={previewOnly}>
                  Source listing
                </ExternalLink>
              </div>
            ) : (
              <Unavailable
                source={source}
                reviewedDetails={reviewed}
                previewOnly={previewOnly}
              >
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
