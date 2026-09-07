
export const SCHEMA = {
  name: 'notification_extraction',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      jobName: { type: 'string' },
      applyStartDate: { type: ['string', 'null'] },
      applyEndDate: { type: ['string', 'null'] },
      categoryRelaxationApplies: { type: ['boolean', 'null'] },
      // Years of age relaxation per category, only the ones this
      // notification actually states. Omit categories not mentioned.
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
      posts: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            postName: { type: 'string' },
            payLevel: { type: ['string', 'null'] },
            minAge: { type: ['integer', 'null'] },
            maxAge: { type: ['integer', 'null'] },
            educationRequired: { type: ['string', 'null'] },
            // Classify into the closest bucket; null if the requirement
            // is too specific/unclear to classify confidently.
            minEducationLevel: {
              type: ['string', 'null'],
              enum: ['TENTH', 'TWELFTH', 'DIPLOMA', 'BACHELORS', 'MASTERS', 'PHD', null],
            },
            minMarksPercent: { type: ['number', 'null'] },
          },
          required: [
            'postName',
            'payLevel',
            'minAge',
            'maxAge',
            'educationRequired',
            'minEducationLevel',
            'minMarksPercent',
          ],
          additionalProperties: false,
        },
      },
    },
    required: [
      'jobName',
      'applyStartDate',
      'applyEndDate',
      'categoryRelaxationApplies',
      'categoryRelaxationRules',
      'posts',
    ],
    additionalProperties: false,
  },
};
