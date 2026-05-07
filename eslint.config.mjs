import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // 旧 LP の minified bundle (4944 件の偽エラーを生成していた)
    "public/lp/**",
    "public/**/*.min.js",
    // worker の build 成果物
    "worker/dist/**",
    "worker/.next/**",
    // coverage / supabase generated
    "coverage/**",
    "supabase/.temp/**",
    "supabase/_apply/**",
  ]),
]);

export default eslintConfig;
