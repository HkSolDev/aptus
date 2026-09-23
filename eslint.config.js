import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['generated/**', 'node_modules/**', 'downloads/**'] },
  tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { ignoreRestSiblings: true },
      ],
    },
  },
);
