import { readFileSync } from 'node:fs';
import ts from 'typescript';
import {
  ageOn,
  getPostChecks,
  getEffectiveMaxAge,
  getUnverifiedRequirements,
} from '../match.js';
import { fetchProfile } from '../../frontend/profile-api.js';
import {
  fetchSavedJobs,
  saveJobApi,
  unsaveJobApi,
} from '../../frontend/saved-jobs-api.js';

// Keep known violations visible without rewriting application behavior or
// treating them as successful compatibility tests. This command exits nonzero.
const findings: { id: string; path: string; detail: string }[] = [];
for (const path of ['frontend/types.ts', 'components/jobs/job-card.tsx']) {
  const file = ts.createSourceFile(
    path,
    readFileSync(path, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  let fieldFound = false;
  for (const node of file.statements) {
    if (!ts.isInterfaceDeclaration(node) || node.name.text !== 'PublicJobItem')
      continue;
    const field = node.members.find(
      (member) =>
        ts.isPropertySignature(member) &&
        member.name.getText(file) === 'educationRequired',
    );
    if (field && ts.isPropertySignature(field) && field.type) {
      fieldFound = true;
      if (field.questionToken)
        findings.push({
          id: 'FB-OPTIONAL-EDUCATION',
          path,
          detail:
            'The wire contract requires educationRequired to be present, including when null.',
        });
    }
    if (
      field &&
      ts.isPropertySignature(field) &&
      field.type &&
      !field.type
        .getText(file)
        .split('|')
        .map((part) => part.trim())
        .includes('null')
    ) {
      findings.push({
        id: 'FB-NULL-EDUCATION',
        path,
        detail:
          'Provider permits educationRequired:null; consumer type excludes null.',
      });
    }
  }
  if (!fieldFound)
    findings.push({
      id: 'FB-CONTRACT-INSPECTION',
      path,
      detail:
        'Canonical PublicJobItem.educationRequired declaration moved or disappeared; coordinator review required.',
    });
}
const originalFetch = globalThis.fetch;
try {
  globalThis.fetch = async () =>
    new Response('{}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  for (const [path, name, run] of [
    ['frontend/profile-api.ts', 'fetchProfile', () => fetchProfile()],
    ['frontend/saved-jobs-api.ts', 'fetchSavedJobs', () => fetchSavedJobs()],
    ['frontend/saved-jobs-api.ts', 'saveJobApi', () => saveJobApi('fixture')],
    [
      'frontend/saved-jobs-api.ts',
      'unsaveJobApi',
      () => unsaveJobApi('fixture'),
    ],
  ] as const) {
    let rejected = false;
    try {
      await run();
    } catch {
      rejected = true;
    }
    if (!rejected)
      findings.push({
        id: 'FB-MALFORMED-SUCCESS',
        path,
        detail: `${name} accepts HTTP 200 {} rather than rejecting the broken envelope.`,
      });
  }
} finally {
  globalThis.fetch = originalFetch;
}

const candidate = {
  dob: new Date('2000-01-01T00:00:00Z'),
  category: 'General',
  educations: [{ level: 'TENTH' as const, marksPercent: null }],
};
const datedPost = {
  minAge: 18,
  maxAge: 20,
  minEducationLevel: null,
  minMarksPercent: null,
  categoryRelaxationRules: null,
  ageAsOnDate: new Date('2018-01-01T00:00:00Z'),
};
if (
  getPostChecks(datedPost, candidate).userAge !==
  ageOn(candidate.dob, datedPost.ageAsOnDate)
) {
  findings.push({
    id: 'WF-AGE-REFERENCE',
    path: 'scripts/match.ts',
    detail:
      'Matcher calculates current age rather than the stored notification ageAsOnDate.',
  });
}
const noRelaxation = {
  maxAge: 30,
  categoryRelaxationApplies: false,
  categoryRelaxationRules: { OBC: 3 },
};
if (getEffectiveMaxAge(noRelaxation, 'OBC').effectiveMaxAge !== 30) {
  findings.push({
    id: 'WF-RELAXATION-FLAG',
    path: 'scripts/match.ts',
    detail:
      'A stored OBC rule adds three years even when categoryRelaxationApplies is false.',
  });
}
if (
  getUnverifiedRequirements({
    eligibilityRules: {
      gender_requirement: 'Male',
      category_requirement: [],
      education_options: [],
      age_rules: [],
      relaxation_combination_rule: null,
    },
    reviewedDetails: { nationality_requirement: 'Indian citizens' },
  }).length === 0
) {
  findings.push({
    id: 'WF-CONDITIONAL-GATES',
    path: 'scripts/match.ts',
    detail:
      'Gender/nationality requirements produce no manual-verification reason in the current matcher.',
  });
}
console.log(
  JSON.stringify(
    { status: findings.length ? 'nonconformant' : 'passed', findings },
    null,
    2,
  ),
);
process.exitCode = findings.length ? 1 : 0;
