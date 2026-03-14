import eslintConfigPrettier from "eslint-config-prettier";
import pluginPerfectionist from "eslint-plugin-perfectionist";
import pluginUnicorn from "eslint-plugin-unicorn";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**", "*.d.ts", "eslint.config.ts"],
  },

  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      complexity: ["error", { max: 10 }],
      // base rule replaced by @typescript-eslint/no-unused-vars
      "no-unused-vars": "off",
      "@typescript-eslint/consistent-type-exports": "error",
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      "@typescript-eslint/explicit-function-return-type": [
        "error",
        {
          allowExpressions: false,
          allowHigherOrderFunctions: true,
          allowTypedFunctionExpressions: true,
        },
      ],
      "@typescript-eslint/explicit-module-boundary-types": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
          ignoreRestSiblings: true,
          varsIgnorePattern: "^_",
        },
      ],
    },
  },

  pluginUnicorn.configs["flat/recommended"],

  {
    rules: {
      "unicorn/no-process-exit": "error",
      "unicorn/prefer-module": "error",
    },
  },

  pluginPerfectionist.configs["recommended-natural"],

  {
    files: ["**/*.test.ts"],
    extends: [tseslint.configs.disableTypeChecked],
    rules: {
      "@typescript-eslint/explicit-function-return-type": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },

  // must be last: disables formatting rules that conflict with prettier
  eslintConfigPrettier,
);
