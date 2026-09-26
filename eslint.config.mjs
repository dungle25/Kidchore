import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/**
 * Lint configuration.
 *
 * The rules below are not decoration: CONVENTIONS.md section 3 states them as
 * requirements, and for a while this file was still the untouched Create Next App
 * default, so the document described enforcement that did not exist. `npx eslint .
 * --print-config lib/dal.ts` was the thing that showed it. If a rule is named in the
 * conventions, it has to be enabled here or the conventions are wrong.
 *
 * The type-aware rules need a TypeScript program, which is why they are scoped to
 * .ts/.tsx and configured with `projectService`. Plugins already registered by
 * eslint-config-next are reused rather than imported again, so the versions cannot
 * drift apart.
 */

/** Relative and aliased paths that only lib/ may import. */
const SUPABASE_MODULES = [
  "@supabase/supabase-js",
  "@supabase/ssr",
];

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  // Default ignores of eslint-config-next:
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),

  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parserOptions: {
        // Resolves each file through the tsconfig that owns it, so a rule can ask
        // "what type is this?" instead of guessing from syntax.
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // A promise that is never awaited returns to the caller before the work is
      // done. In a Server Action that means the page revalidates with stale data and
      // the failure is swallowed, which is the single easiest way to ship a bug here.
      "@typescript-eslint/no-floating-promises": "error",
      // An async function passed where a void-returning one is expected, e.g. an
      // onClick handler: React ignores the promise and rejections become unhandled.
      "@typescript-eslint/no-misused-promises": "error",

      // `any` switches off every check below it, including the narrowing that makes
      // lib/domain.ts worth having.
      "@typescript-eslint/no-explicit-any": "error",
      // `!` asserts away exactly the null case a check exists to catch.
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],

      eqeqeq: ["error", "always", { null: "ignore" }],
      // parseInt without a radix reads a leading "0" as octal.
      radix: "error",
      "no-throw-literal": "error",
    },
  },

  {
    // The data-access boundary. Everything in app/ and components/ goes through
    // lib/dal.ts, which resolves identity from the signed cookie; a component that
    // builds its own Supabase client silently steps around every authorization rule
    // in the database. Importing the wrappers in lib/ is the sanctioned path - it is
    // the raw SDK that must not appear here.
    files: ["app/**/*.{ts,tsx}", "components/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: SUPABASE_MODULES.map((name) => ({
            name,
            message:
              "Build the client in lib/ instead. Components read and write through lib/dal.ts so identity always comes from the session.",
          })),
        },
      ],
    },
  },

  {
    // Plain Node scripts run outside the Next.js build.
    files: ["scripts/**/*.mjs"],
    rules: {
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", caughtErrors: "none" }],
      eqeqeq: ["error", "always", { null: "ignore" }],
    },
  },
]);
