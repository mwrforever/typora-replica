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
    // 内存安全（2026-08-15 事故根治）：jsdom 测试每个 worker 需加载
    // Crepe/CodeMirror/KaTeX 等重依赖（单 worker 峰值约 1GB），若按 CPU 核数
    // （本机 24 核）全并发拉起 worker，总内存可达 20GB+ 触发系统 OOM。
    // 注意：vitest 4 已移除 poolOptions.forks.maxForks（旧写法静默失效），
    // 并发限制必须用顶层 maxWorkers；实测修复后全量测试 vitest 峰值 <1GB
    // （4 worker 各约 0.2GB 起，随加载重依赖波动，上限约 4GB）
    maxWorkers: 4,
    // 单 worker V8 堆上限 2GB：泄漏兜底，防止某个 worker 异常膨胀拖垮整机
    // （实测单 worker 峰值约 1GB，2GB 有充足余量且不影响正常用例）
    execArgv: ["--max-old-space-size=2048"],
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
        // 02 核心服务 100%：文件 IO 桥（八命令注册/七封装 + 错误规范化）+ 偏好设置（store 持久化）
        "src/services/file-io.ts": {
          lines: 100,
          statements: 100,
          functions: 100,
          branches: 100,
        },
        "src/services/settings.ts": {
          lines: 100,
          statements: 100,
          functions: 100,
          branches: 100,
        },
        // 02 核心服务 100%：行尾转换器（落盘统一口径——FM 盲区收口/硬换行往返）
        "src/services/line-ending.ts": {
          lines: 100,
          statements: 100,
          functions: 100,
          branches: 100,
        },
        // 02 核心服务 100%：文档会话（打开/保存/另存/dirty 状态机 + 父目录加载 + lastFile 持久化）
        "src/services/document-session.ts": {
          lines: 100,
          statements: 100,
          functions: 100,
          branches: 100,
        },
        // 02 核心服务 100%：打开/另存对话框命令层（12 菜单装配消费，F1）
        "src/services/open-commands.ts": {
          lines: 100,
          statements: 100,
          functions: 100,
          branches: 100,
        },
        // 02 核心服务 100%：最近文件（置顶去重/上限 10/固定项保留/失败移除，F13）
        "src/services/recent-files.ts": {
          lines: 100,
          statements: 100,
          functions: 100,
          branches: 100,
        },
        // 02 核心服务 100%：启动行为决策（--new 优先/四模式/回退新建提示，F14）
        "src/services/launch-behavior.ts": {
          lines: 100,
          statements: 100,
          functions: 100,
          branches: 100,
        },
        // 02 核心服务 100%：自动保存（停笔防抖 1s∪定时 5min 双条件/开关联动/dirty 协作，F30）
        "src/services/auto-save.ts": {
          lines: 100,
          statements: 100,
          functions: 100,
          branches: 100,
        },
        // 02 核心服务 100%：草稿备份与恢复（5s 心跳防抖/退出备份/首标题命名/空内容防护，F31）
        "src/services/draft-recovery.ts": {
          lines: 100,
          statements: 100,
          functions: 100,
          branches: 100,
        },
        // 02 核心 100%：Open Quickly 模糊匹配与数据源组装（大小写不敏感包含/排序/去重，F11）
        "src/features/open-quickly/fuzzy.ts": {
          lines: 100,
          statements: 100,
          functions: 100,
          branches: 100,
        },
        "src/features/open-quickly/open-quickly.ts": {
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
