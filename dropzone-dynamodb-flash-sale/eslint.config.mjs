import tseslint from 'typescript-eslint';

// Key strings and index attribute names belong in exactly one file (spec section 6).
const KEY_ATTRIBUTE_NAMES = /^(PK|SK|LSI1SK|GSI[1-4]PK|GSI[1-4]SK)$/;

export default tseslint.config(
  {
    ignores: ['dist/**', 'coverage/**', 'node_modules/**', 'infra/**', 'docs/**'],
  },
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Stub signatures keep their documented parameter names behind an underscore until the
      // milestone that implements them.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
  // Build and config scripts are plain JavaScript and outside the TypeScript project, so the
  // type-aware rules cannot run on them.
  {
    files: ['**/*.mjs', '**/*.js'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  // The domain layer is pure TypeScript. No AWS, no Lambda, no persistence details.
  {
    files: ['src/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@aws-sdk/*', '@aws-lambda-powertools/*', 'aws-lambda', '@/persistence/*'],
              message: 'The domain layer must not import AWS or persistence code (spec section 3).',
            },
          ],
        },
      ],
    },
  },
  // keys.ts is the only place key strings are built.
  {
    files: ['src/**/*.ts', 'scripts/**/*.ts'],
    ignores: ['src/persistence/keys.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: `Literal[value=${KEY_ATTRIBUTE_NAMES}]`,
          message:
            'Key and index attribute names come from keys.ts or schema/tables.json, not literals.',
        },
        {
          // Only templates that interpolate something: those build a key out of values. A constant
          // string containing "#" is a DynamoDB expression placeholder like "#status", which is
          // normal in any repository.
          selector: 'TemplateLiteral[expressions.length>0] > TemplateElement[value.raw=/#/]',
          message: 'Key strings are built only in src/persistence/keys.ts (spec section 6).',
        },
      ],
    },
  },
  // Tests assert on raw items on purpose, so they only keep the type-aware rules.
  {
    files: ['test/**/*.ts', 'scripts/**/*.ts', '*.ts', '*.mjs'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
    },
  },
);
