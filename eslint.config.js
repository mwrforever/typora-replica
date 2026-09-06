// ESLint 扁平配置（ESLint 9+）
// 规则组合：Vue 官方推荐 + TypeScript 官方推荐 + Prettier 兼容（关闭格式冲突规则）
import { defineConfigWithVueTs, vueTsConfigs } from "@vue/eslint-config-typescript";
import pluginVue from "eslint-plugin-vue";
import skipFormatting from "@vue/eslint-config-prettier";

export default defineConfigWithVueTs(
  {
    name: "app/files-to-lint",
    files: ["**/*.{ts,mts,tsx,vue}"],
  },
  {
    name: "app/files-to-ignore",
    // 构建产物、覆盖率报告、Rust 侧代码与测试产物不参与前端 lint；
    // 过程文档工作区（SDD scratch 与 docs/）不入库也不参与门禁（2026-09-06 用户裁决白名单）
    ignores: [
      "**/dist/**",
      "**/dist-ssr/**",
      "**/coverage/**",
      "src-tauri/target/**",
      "src-tauri/gen/**",
      "e2e/.wdio*/**",
      ".superpowers/**",
      "docs/**",
    ],
  },
  pluginVue.configs["flat/essential"],
  vueTsConfigs.recommended,
  skipFormatting,
);
