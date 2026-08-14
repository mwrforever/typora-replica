/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [vue()],

  // Vitest 单元测试配置：jsdom 环境模拟浏览器 DOM，覆盖 src 下全部 spec 用例
  test: {
    environment: "jsdom",
    include: ["src/**/*.spec.ts"],
    setupFiles: ["src/test/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["src/**/*.{ts,vue}"],
      exclude: ["src/main.ts", "src/vite-env.d.ts", "src/test/**"],
      thresholds: {
        // 全局 ≥80%（非核心功能下限）
        lines: 80,
        statements: 80,
        functions: 80,
        branches: 80,
        // 核心功能 100%：语法转换（keymap/输入规则）、E20 安全路径、事件桥、实例管理
        "src/features/editor/**/*.ts": {
          lines: 100,
          statements: 100,
          functions: 100,
          branches: 100,
        },
        "src/services/editor-manager.ts": {
          lines: 100,
          statements: 100,
          functions: 100,
          branches: 100,
        },
        "src/services/editor-events.ts": {
          lines: 100,
          statements: 100,
          functions: 100,
          branches: 100,
        },
      },
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
