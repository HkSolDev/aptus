// Used for a second, cheap pass over just the extracted post NAMES (not the
// raw document) to merge near-duplicate wording of the same post while
// keeping genuinely distinct department/office variants separate — the
// exact-string dedup after chunking can't tell "Sub Inspector" apart from
// "Sub-Inspector" (same post) vs "Auditor (Offices under C&AG)" apart from
// "Auditor (Offices under CGDA)" (different posts).
export const RECONCILE_SCHEMA = {
  name: 'post_deduplication',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      duplicateGroups: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            keepIndex: { type: 'integer' },
            duplicateIndices: { type: 'array', items: { type: 'integer' } },
          },
          required: ['keepIndex', 'duplicateIndices'],
          additionalProperties: false,
        },
      },
    },
    required: ['duplicateGroups'],
    additionalProperties: false,
  },
};

export const SCHEMA = {
  name: 'notification_extraction',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      jobName: { type: 'string' },
      applyStartDate: { type: ['string', 'null'] },
      applyEndDate: { type: ['string', 'null'] },
      posts: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            postName: { type: 'string' },
            // From the post's "Classification of Post" (e.g. "Group 'B'
            // Gazetted") — extract just the letter.
            postGroup: {
              type: ['string', 'null'],
              enum: ['A', 'B', 'C', 'D', null],
            },
            payLevel: { type: ['string', 'null'] },
            minAge: { type: ['integer', 'null'] },
            maxAge: { type: ['integer', 'null'] },
            educationRequired: { type: ['string', 'null'] },
            // Classify into the closest bucket; null if the requirement
            // is too specific/unclear to classify confidently.
            minEducationLevel: {
              type: ['string', 'null'],
              enum: [
                'TENTH',
                'TWELFTH',
                'DIPLOMA',
                'BACHELORS',
                'MASTERS',
                'PHD',
                null,
              ],
            },
            minMarksPercent: { type: ['number', 'null'] },
            categoryRelaxationApplies: { type: ['boolean', 'null'] },
            // Age relaxation in years per category for THIS post specifically
            // — some notifications grant extra relaxation to certain post
            // groups, so this must not be assumed uniform across all posts.
            categoryRelaxationRules: {
              type: 'object',
              properties: {
                SC: { type: ['integer', 'null'] },
                ST: { type: ['integer', 'null'] },
                OBC: { type: ['integer', 'null'] },
                EWS: { type: ['integer', 'null'] },
                PwBD: { type: ['integer', 'null'] },
              },
              required: ['SC', 'ST', 'OBC', 'EWS', 'PwBD'],
              additionalProperties: false,
            },
          },
          required: [
            'postName',
            'postGroup',
            'payLevel',
            'minAge',
            'maxAge',
            'educationRequired',
            'minEducationLevel',
            'minMarksPercent',
            'categoryRelaxationApplies',
            'categoryRelaxationRules',
          ],
          additionalProperties: false,
        },
      },
      postsSeenInThisSection: { type: ['integer', 'null'] },
    },
    required: ['jobName', 'applyStartDate', 'applyEndDate', 'posts', 'postsSeenInThisSection'],
    additionalProperties: false,
  },
};
