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
        // 核心功能 100%：语法转换（keymap/输入规则）、E20 安全路径、事件桥、
        // 实例管理（editor-manager/editor-events 随 P1-8 重构收拢入 features/editor）
        "src/features/editor/**/*.ts": {
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
        // 02 核心服务 100%：文档会话（打开/保存/另存/dirty 状态机 + 父目录加载 + lastFile 持久化）、
        // 自动保存（停笔防抖∪定时兜底/开关联动/dirty 协作）、草稿备份与恢复
        // （P1-8 重构：02 三服务收拢入 features/document 域——依赖 01 门面 editorManager，
        // 留在 services 层会构成 services→features 反向依赖）
        "src/features/document/**/*.ts": {
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
        // 03 核心 100%：文件树状态（目录加载/防抖刷新/面板切换/排序状态，F2-F12 共享）
        "src/features/file-tree/file-tree-store.ts": {
          lines: 100,
          statements: 100,
          functions: 100,
          branches: 100,
        },
        // 03 核心 100%：树构建/白名单常量/Duplicate 命名/非法字符校验/相对路径（F3-F7 纯函数基座）
        "src/features/file-tree/tree-utils.ts": {
          lines: 100,
          statements: 100,
          functions: 100,
          branches: 100,
        },
        // 03 核心 100%：最近位置（去重置顶/上限 10/固定项保留/移除，F9）
        "src/features/file-tree/recent-locations.ts": {
          lines: 100,
          statements: 100,
          functions: 100,
          branches: 100,
        },
        // 04 核心功能 100%：标签状态机/实例注册表/快捷键（TabBar/ConfirmCloseDialog
        // 为 vue 组件走全局 ≥80%）
        "src/features/tabs/**/*.ts": {
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
