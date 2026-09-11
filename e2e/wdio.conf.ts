import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
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
 * 06 全局搜索专用 fixture 目录：置于系统临时目录（仓库外）。
 * 原因：全局扫描按 spec F26 尊重工作区 gitignore 与隐藏项（Rust 侧
 * WalkBuilder hidden(true)），而 e2e/.fixtures 被 .gitignore 覆盖——
 * 以它为 currentDir 的全局搜索恒零命中。搜索 E2E 必须以仓库外的
 * 可见目录为扫描根，其余用例不受影响。
 */
const searchableDir = path.join(os.tmpdir(), "markwell-e2e-search");
mkdirSync(searchableDir, { recursive: true });
const searchableFixturePath = path.join(searchableDir, "opening.md");
writeFileSync(searchableFixturePath, "# 启动测试\n\n自动保存验证占位。\n", "utf8");

/** 1x1 透明 PNG 字节（07 图片显示链路 fixture 的最小合法图片） */
const PNG_1X1_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

/**
 * 07 图片显示链路专用 fixture 目录：doc.md 引用同目录 pic.png。
 * 必须在配置加载期落盘——--reopen-file 是应用启动参数，应用读取 doc.md
 * 早于 mocha beforeAll 可执行的时点（与上方两目录同一时序约束）
 */
const imageFixtureDir = path.join(os.tmpdir(), "markwell-e2e-image");
mkdirSync(imageFixtureDir, { recursive: true });
writeFileSync(path.join(imageFixtureDir, "doc.md"), "# 图片显示\n\n![](pic.png)\n", "utf8");
writeFileSync(path.join(imageFixtureDir, "pic.png"), Buffer.from(PNG_1X1_BASE64, "base64"));

/**
 * 08 主题 E2E 前置（D8-②）：重置 settings store 的 theme 组为默认——
 * 防止开发机遗留的自定义主题选择污染用例 1 的「默认亮色主题」断言。
 * 必须在应用启动前落盘（themeStore.init 仅启动读一次设置，spec 内 before 钩子
 * 晚于装载无法生效）；经 store 文件直写（tauri-plugin-store 默认落点 = AppData
 * 基准，与上方 fixture 同一时点同一手法）。原字节存内存，onComplete 还原。
 */
const settingsPath = path.join(
  process.env.APPDATA ?? "",
  "com.markwell.app",
  "markwell-settings.json",
);
// 原文件字节（不存在则 undefined，还原时删除本预置创建的文件）
const originalSettings = existsSync(settingsPath) ? readFileSync(settingsPath) : undefined;
try {
  const parsed = originalSettings
    ? (JSON.parse(originalSettings.toString("utf8")) as Record<string, unknown>)
    : {};
  parsed.theme = { lightTheme: "markwell-light", darkTheme: "markwell-dark" };
  mkdirSync(path.dirname(settingsPath), { recursive: true });
  writeFileSync(settingsPath, JSON.stringify(parsed, null, 2), "utf8");
} catch {
  // 存量文件非法 JSON：按空设置处理（theme 组由应用逐键回落默认），还原时写回原字节
}

/**
 * 10#1 重启补验前置（keybinding-restart.e2e.ts）：预置 conf.user.json 的 keyBinding
 * 覆盖——`"Always on Top": "Ctrl+Shift+P"`。conf.user.json 为 10 高级设置存储
 * （app_data_dir 下，Rust io::advanced_settings 管理；支持 // 注释），应用启动时
 * read_advanced_settings 读取并注入菜单快捷键合并数据——读取早于 mocha 钩子可执行
 * 时点，必须与上方 settings store 同一时点（配置加载期）落盘。缺键由 Rust DTO
 * default 兜底，故只写 keyBinding 单键。原字节存内存，onComplete 还原。
 */
const confUserPath = path.join(process.env.APPDATA ?? "", "com.markwell.app", "conf.user.json");
// 原文件字节（不存在则 undefined，还原时删除本预置创建的文件）
const originalConfUser = existsSync(confUserPath) ? readFileSync(confUserPath) : undefined;
try {
  const parsedConf = originalConfUser
    ? (JSON.parse(originalConfUser.toString("utf8")) as Record<string, unknown>)
    : {};
  parsedConf.keyBinding = { "Always on Top": "Ctrl+Shift+P" };
  mkdirSync(path.dirname(confUserPath), { recursive: true });
  writeFileSync(confUserPath, JSON.stringify(parsedConf, null, 2), "utf8");
} catch {
  // 存量文件含 // 注释无法直接 parse（Rust 模板自带用户指引注释）：按空 conf 重写
  // 仅含 keyBinding 单键（Rust 剥注释解析器对无注释 JSON 同样兼容），还原时写回原字节
  mkdirSync(path.dirname(confUserPath), { recursive: true });
  writeFileSync(
    confUserPath,
    JSON.stringify({ keyBinding: { "Always on Top": "Ctrl+Shift+P" } }, null, 2),
    "utf8",
  );
}

/** 共享 tauri:options（两 capability 仅 --reopen-file 启动参数不同） */
function tauriOptions(reopenFile: string): Record<string, unknown> {
  return {
    // application 路径相对 tauri-driver 进程的工作目录（项目根）解析
    application: "src-tauri/target/debug/typora-replica.exe",
    // --reopen-file 直传（WebDriver args 无 shell 转义；Windows 反斜杠路径原样透传）
    args: ["--use-localhost", `--reopen-file=${reopenFile}`],
    webviewUrl: "http://localhost:1420",
  };
}

/**
 * WebdriverIO 配置：连接 tauri-driver（WebDriver 服务）驱动 Tauri 应用窗口
 *
 * 跑前必读：含 Rust 变更的分支须先 `cargo build` 重编 debug 二进制（capability 的
 * application 指向 src-tauri/target/debug 旧产物时缺新命令会假红，详见 e2e/README.md §0）。
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
  // 注：pattern 相对配置文件所在目录（e2e/）解析；capability 内可用
  // specs/exclude 覆盖（见下），未声明者沿用此处
  specs: ["./specs/**/*.e2e.ts"],
  exclude: [],

  // Tauri 窗口是单实例，串行执行避免冲突
  maxInstances: 1,
  capabilities: [
    {
      maxInstances: 1,
      // 其余模块用例维持原启动链路（.fixtures 为侧栏数据源）；
      // 12 窗口外壳两个附属 spec 独立 capability（见数组尾两项的顺序性说明）
      exclude: [
        "./specs/search.e2e.ts",
        "./specs/image-display.e2e.ts",
        "./specs/keybinding-restart.e2e.ts",
        "./specs/window-shell-new-window.e2e.ts",
      ],
      "tauri:options": tauriOptions(fixturePath),
    } as unknown as Capabilities.Capability,
    {
      maxInstances: 1,
      // 06 搜索替换专用：以临时目录 fixture 启动——currentDir 即可扫描目录，
      // 全局搜索三场景在该目录上闭环（含点击定位回 opening.md 标签）
      specs: ["./specs/search.e2e.ts"],
      "tauri:options": tauriOptions(searchableFixturePath),
    } as unknown as Capabilities.Capability,
    {
      maxInstances: 1,
      // 07 图片显示链路专用：以临时目录 doc.md（引用同目录 pic.png）启动，
      // 验证 asset 协议动态授权 + CSP + 显示观察器的端到端全链路
      specs: ["./specs/image-display.e2e.ts"],
      "tauri:options": tauriOptions(path.join(imageFixtureDir, "doc.md")),
    } as unknown as Capabilities.Capability,
    {
      maxInstances: 1,
      // 10#1 重启补验专用（keybinding-restart.e2e.ts）：conf.user.json 的 keyBinding
      // 预置已在本文件配置加载期落盘（见上方 confUserPath 段），本 capability 启动的
      // 应用实例装载覆盖并验证菜单快捷键合并数据（order：随 capability 数组在
      // 常规 spec 之后执行，保证 fixture 写盘断言不受并行干扰）
      specs: ["./specs/keybinding-restart.e2e.ts"],
      "tauri:options": tauriOptions(fixturePath),
    } as unknown as Capabilities.Capability,
    {
      maxInstances: 1,
      // 12 New Window / 置顶专用（window-shell-new-window.e2e.ts）：必须为最后一个
      // capability——New Window 触发后 driver 会话上下文被新窗口顶掉，主窗查询失联
      //（spec 文件头说明），其所在 capability 之后不能再有依赖窗口交互的用例
      specs: ["./specs/window-shell-new-window.e2e.ts"],
      "tauri:options": tauriOptions(fixturePath),
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

  // 08 主题 E2E 后置（D8-②）与 10#1 重启补验后置：还原 settings store 与
  // conf.user.json 原字节；本预置创建的文件（原不存在）则删除
  onComplete: () => {
    if (originalSettings) {
      writeFileSync(settingsPath, originalSettings);
    } else if (existsSync(settingsPath)) {
      rmSync(settingsPath);
    }
    if (originalConfUser) {
      writeFileSync(confUserPath, originalConfUser);
    } else if (existsSync(confUserPath)) {
      rmSync(confUserPath);
    }
  },
};
