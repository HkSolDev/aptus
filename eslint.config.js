import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'generated/**',
      'public/js/**',
      'node_modules/**',
      'downloads/**',
      '.next/**',
      'outputs/**',
    ],
  },
  tseslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked.map((config) => ({
    ...config,
    files: ['src/**/*.ts', 'scripts/match.ts', 'scripts/validate-post.ts'],
  })),
  {
    files: ['src/**/*.ts', 'scripts/match.ts', 'scripts/validate-post.ts'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { ignoreRestSiblings: true },
      ],
    },
  },
);
