'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  useDesignReview,
  type ReviewQualification,
} from '@/components/jobs/design-review-state';
import styles from './profile-review.module.css';

// Illustrative choices for the local design only; not a production qualification taxonomy.
const courses: Record<string, Record<string, string[]>> = {
  Graduation: {
    BTech: [
      'Mechanical Engineering',
      'Civil Engineering',
      'Computer Science and Engineering',
      'Electrical Engineering',
    ],
    BSc: ['Physics', 'Chemistry', 'Mathematics'],
    BA: ['History', 'Economics', 'Political Science'],
    BCom: ['Commerce'],
  },
  Postgraduation: {
    MTech: ['Mechanical Engineering', 'Civil Engineering'],
    MSc: ['Physics', 'Chemistry'],
    MA: ['History', 'Economics'],
    MCom: ['Commerce'],
  },
  Diploma: {
    Diploma: [
      'Mechanical Engineering',
      'Civil Engineering',
      'Electrical Engineering',
      'Electronics',
    ],
  },
  ITI: { ITI: ['Electrician', 'Fitter', 'Welder'] },
  PhD: { PhD: ['Physics', 'Mechanical Engineering', 'Economics'] },
  '12th': { '12th': ['Science', 'Commerce', 'Arts'] },
};
const empty = { level: '', degree: '', subject: '' };

export function ProfileReview() {
  const review = useDesignReview();
  const router = useRouter();
  const [entry, setEntry] = useState<ReviewQualification>(empty);
  const [editing, setEditing] = useState<number | null>(null);
  const [unspecified, setUnspecified] = useState(false);
  const [error, setError] = useState('');
  if (!review) return null;
  const { profile, setProfile } = review;
  const degrees = Object.keys(courses[entry.level] ?? {});
  const subjects = courses[entry.level]?.[entry.degree] ?? [];
  const showDegree = ['Graduation', 'Postgraduation'].includes(entry.level);

  function addQualification() {
    if (
      !entry.level ||
      (!unspecified &&
        entry.level !== '10th' &&
        !subjects.includes(entry.subject))
    ) {
      setError(
        'Choose your qualification, degree and subject from the options, or use “Can’t find my course”.',
      );
      return;
    }
    const qualification = unspecified
      ? { ...entry, degree: '', subject: '' }
      : entry;
    setProfile((current) => ({
      ...current,
      qualifications:
        editing === null
          ? [...current.qualifications, qualification]
          : current.qualifications.map((item, index) =>
              index === editing ? qualification : item,
            ),
    }));
    setEntry(empty);
    setEditing(null);
    setUnspecified(false);
    setError('');
  }

  return (
    <section className={styles.page} aria-labelledby="profile-title">
      <header className={styles.heading}>
        <h1 id="profile-title">Your profile</h1>
        <p className="muted">
          Add your details to find relevant opportunities. You can update them
          later.
        </p>
      </header>
      <form
        className={`panel ${styles.form}`}
        onSubmit={(event) => {
          event.preventDefault();
          if (!profile.qualifications.length) {
            setError('Add at least one completed qualification.');
            return;
          }
          router.push('/results');
        }}
      >
        <h2>About you</h2>
        <div className={`field-pair ${styles.fields}`}>
          <label className="field">
            Date of birth
            <input
              type="date"
              aria-label="Date of birth"
              aria-describedby="review-age-hint"
              autoComplete="bday"
              required
              max={new Date().toLocaleDateString('en-CA')}
              value={profile.dob}
              onChange={(event) =>
                setProfile({ ...profile, dob: event.target.value })
              }
            />
            <span id="review-age-hint" className={styles.hint}>
              Used to check each job’s age requirements.
            </span>
          </label>
          <label className="field">
            Category
            <select
              aria-label="Category"
              aria-describedby="review-category-hint"
              required
              value={profile.category}
              onChange={(event) =>
                setProfile({ ...profile, category: event.target.value })
              }
            >
              <option value="">Select category</option>
              {[
                'General / UR',
                'SC',
                'ST',
                'OBC',
                'EWS',
                'Prefer not to say',
              ].map((category) => (
                <option key={category}>{category}</option>
              ))}
            </select>
            <span id="review-category-hint" className={styles.hint}>
              Relaxation depends on the recruitment notice.
            </span>
          </label>
        </div>
        <section
          className={styles.section}
          aria-labelledby="qualifications-title"
        >
          <h2 id="qualifications-title">Your qualifications</h2>
          <p className="muted">Add qualifications you have completed.</p>
          {profile.qualifications.map((qualification, index) => (
            <div className={styles.qualification} key={index}>
              <div>
                <span className={styles.hint}>{qualification.level}</span>
                <strong>
                  {[qualification.degree, qualification.subject]
                    .filter(Boolean)
                    .join(' · ') || qualification.level}
                </strong>
              </div>
              <div className={styles.optionActions}>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => {
                    setEntry(qualification);
                    setEditing(index);
                    setUnspecified(false);
                    setError('');
                    document.getElementById('review-level')?.focus();
                  }}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => {
                    setProfile({
                      ...profile,
                      qualifications: profile.qualifications.filter(
                        (_, current) => current !== index,
                      ),
                    });
                    setEditing(null);
                    setEntry(empty);
                  }}
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
          <div className={styles.qform}>
            <label className="field" htmlFor="review-level">
              Qualification
            </label>
            <select
              id="review-level"
              value={entry.level}
              onChange={(event) => {
                const level = event.target.value;
                const options = Object.keys(courses[level] ?? {});
                setEntry({
                  level,
                  degree: options.length === 1 ? options[0] : '',
                  subject: '',
                });
                setUnspecified(false);
              }}
            >
              <option value="">Select qualification</option>
              {[
                '10th',
                '12th',
                'ITI',
                'Diploma',
                'Graduation',
                'Postgraduation',
                'PhD',
              ].map((level) => (
                <option key={level}>{level}</option>
              ))}
            </select>
            {entry.level && entry.level !== '10th' && !unspecified && (
              <div className={styles.qgrid}>
                {showDegree && (
                  <label className="field">
                    Degree
                    <input
                      list="review-degrees"
                      placeholder="Search degrees"
                      value={entry.degree}
                      onChange={(event) =>
                        setEntry({
                          ...entry,
                          degree: event.target.value,
                          subject: '',
                        })
                      }
                      onBlur={() => {
                        const aliases: Record<string, string> = {
                          'b.tech': 'BTech',
                          btech: 'BTech',
                          'bachelor of technology': 'BTech',
                          'b.sc': 'BSc',
                          bsc: 'BSc',
                          'bachelor of science': 'BSc',
                        };
                        const canonical =
                          degrees.find(
                            (degree) =>
                              degree.toLowerCase() ===
                              entry.degree.toLowerCase(),
                          ) ?? aliases[entry.degree.toLowerCase()];
                        if (canonical && degrees.includes(canonical))
                          setEntry({ ...entry, degree: canonical });
                      }}
                    />
                    <datalist id="review-degrees">
                      {degrees.map((degree) => (
                        <option key={degree} value={degree} />
                      ))}
                    </datalist>
                  </label>
                )}
                <label className="field">
                  {entry.level === 'ITI'
                    ? 'Trade'
                    : entry.level === '12th'
                      ? 'Stream'
                      : 'Branch or subject'}
                  <input
                    list="review-subjects"
                    placeholder="Search options"
                    value={entry.subject}
                    onChange={(event) =>
                      setEntry({ ...entry, subject: event.target.value })
                    }
                  />
                  <datalist id="review-subjects">
                    {subjects.map((subject) => (
                      <option key={subject} value={subject} />
                    ))}
                  </datalist>
                </label>
              </div>
            )}
            <button
              type="button"
              className="text-button"
              onClick={() => setUnspecified(true)}
            >
              Can’t find my course
            </button>
            {unspecified && (
              <p className={styles.hint}>
                We’ll keep the course unspecified. Check subject requirements in
                each notice.
              </p>
            )}
            <p className={styles.hint}>
              Check required marks in the job details.
            </p>
            <button
              className="button button-secondary"
              type="button"
              onClick={addQualification}
            >
              {editing === null ? 'Add qualification' : 'Save qualification'}
            </button>
          </div>
          {!!profile.qualifications.length && (
            <div className={styles.another}>
              <button
                className="text-button"
                type="button"
                onClick={() => {
                  setEntry(empty);
                  setEditing(null);
                  document.getElementById('review-level')?.focus();
                }}
              >
                + Add another qualification
              </button>
              <p className={styles.hint}>
                Adding your other qualifications helps us find more relevant
                jobs.
              </p>
            </div>
          )}
        </section>
        {error && (
          <p className="notice notice-error" role="alert">
            {error}
          </p>
        )}
        <div className={styles.actions}>
          <Link href="/?reviewProfile=ready">Keep browsing</Link>
          <button className="button button-primary" type="submit">
            Show suggested jobs
          </button>
        </div>
        <p className={styles.hint}>
          Fictional profile preview. No eligibility is calculated and no account
          is updated.
        </p>
      </form>
    </section>
  );
}
