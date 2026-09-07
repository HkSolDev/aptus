import tseslint from 'typescript-eslint';

export default tseslint.config(tseslint.configs.recommended, {
  ignores: ['generated/**', 'node_modules/**', 'downloads/**'],
});
