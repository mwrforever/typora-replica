import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Capabilities, Options } from "@wdio/types";

/**
 * 02 E2E 前置：预置启动文件（wdio 配置加载时创建，供 --reopen-file 启动恢复）
 * 相对项目根解析绝对路径（tauri-driver 从项目根拉起应用二进制）
 */
const fixtureDir = path.join(process.cwd(), "e2e/.fixtures");
const fixturePath = path.join(fixtureDir, "opening.md");
mkdirSync(fixtureDir, { recursive: true });
writeFileSync(fixturePath, "# 启动测试\n\n自动保存验证占位。\n", "utf8");

/**
 * WebdriverIO 配置：连接 tauri-driver（WebDriver 服务）驱动 Tauri 应用窗口
 *
 * 前置条件（本地与 CI 相同）：
 *   1. `npm run dev` 启动 Vite dev server（端口 1420）
 *   2. `tauri-driver` 启动 WebDriver 服务（端口 4444）
 *   3. `npm run test:e2e` 执行本配置
 *
 * capability 说明：
 *   - application: 指向 dev 模式编译出的应用二进制（tauri-driver 负责拉起应用）
 *   - args: ["--use-localhost"] 指示应用从 devUrl 加载前端；
 *     --reopen-file=<fixture> 指示应用启动时打开预置 fixture（02 启动链路冒烟入口）
 *   - webviewUrl: 前端 dev server 地址（与 tauri.conf.json 的 devUrl 一致）
 */
export const config: Options.Testrunner = {
  // 本地 runner（进程内启动 WebdriverIO）
  runner: "local",

  // tauri-driver 的 WebDriver 服务地址（默认端口 4444，路径为根）
  hostname: "localhost",
  port: 4444,
  path: "/",

  // 测试用例：specs 目录下的全部 .e2e.ts 文件
  // 注：pattern 相对配置文件所在目录（e2e/）解析
  specs: ["./specs/**/*.e2e.ts"],
  exclude: [],

  // Tauri 窗口是单实例，串行执行避免冲突
  maxInstances: 1,
  capabilities: [
    {
      maxInstances: 1,
      "tauri:options": {
        // application 路径相对 tauri-driver 进程的工作目录（项目根）解析
        application: "src-tauri/target/debug/typora-replica.exe",
        // --reopen-file 直传（WebDriver args 无 shell 转义；Windows 反斜杠路径原样透传）
        args: ["--use-localhost", `--reopen-file=${fixturePath}`],
        webviewUrl: "http://localhost:1420",
      },
    } as unknown as Capabilities.Capability,
  ],

  // 日志与输出目录
  logLevel: "info",
  outputDir: "e2e/logs",
  waitforTimeout: 15000,
  connectionRetryTimeout: 120000,
  connectionRetryCount: 3,

  // 测试框架：Mocha
  framework: "mocha",
  mochaOpts: {
    timeout: 60000,
    ui: "bdd",
  },
  reporters: ["spec"],
};
