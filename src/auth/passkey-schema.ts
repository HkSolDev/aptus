export const empty = {
  type: 'object',
  additionalProperties: false,
  properties: {},
};

const text = { type: 'string', minLength: 1, maxLength: 128 };
const encoded = {
  type: 'string',
  minLength: 1,
  maxLength: 16384,
  pattern: '^[A-Za-z0-9_-]+$',
};
const verification = {
  ...empty,
  required: ['response'],
  properties: {
    response: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'rawId', 'type', 'response', 'clientExtensionResults'],
      properties: {
        id: { type: 'string', minLength: 1, maxLength: 2048 },
        rawId: { type: 'string', minLength: 1, maxLength: 2048 },
        type: { type: 'string', const: 'public-key' },
        response: {
          type: 'object',
          additionalProperties: false,
          required: ['clientDataJSON'],
          properties: {
            clientDataJSON: encoded,
            attestationObject: encoded,
            authenticatorData: encoded,
            signature: encoded,
            publicKey: encoded,
            publicKeyAlgorithm: { type: 'integer' },
            userHandle: {
              anyOf: [{ ...encoded, minLength: 0 }, { type: 'null' }],
            },
            transports: {
              type: 'array',
              maxItems: 8,
              items: {
                type: 'string',
                enum: [
                  'ble',
                  'cable',
                  'hybrid',
                  'internal',
                  'nfc',
                  'smart-card',
                  'usb',
                ],
              },
            },
          },
        },
        clientExtensionResults: {
          type: 'object',
          additionalProperties: false,
          properties: {
            credProps: {
              type: 'object',
              additionalProperties: false,
              properties: { rk: { type: 'boolean' } },
            },
          },
        },
        authenticatorAttachment: {
          type: 'string',
          enum: ['platform', 'cross-platform'],
        },
      },
    },
    name: text,
  },
};
export const operations = [
  ['generate-register-options', 'GET', empty],
  ['generate-authenticate-options', 'GET', empty],
  ['verify-registration', 'POST', verification],
  [
    'verify-authentication',
    'POST',
    {
      ...verification,
      properties: { response: verification.properties.response },
    },
  ],
  [
    'delete-passkey',
    'POST',
    { ...empty, required: ['id'], properties: { id: text } },
  ],
  [
    'update-passkey',
    'POST',
    {
      ...empty,
      required: ['id', 'name'],
      properties: { id: text, name: text },
    },
  ],
  ['list-user-passkeys', 'GET', empty],
] as const;
