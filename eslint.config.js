import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'generated/**',
      'public/js/**',
      'node_modules/**',
      'downloads/**',
      '.next/**',
      '.next-design-review/**',
    ],
  },
  tseslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked.map((config) => ({
    ...config,
    files: ['src/**/*.ts', 'scripts/**/*.ts'],
  })),
  {
    files: ['src/**/*.ts', 'scripts/**/*.ts'],
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
