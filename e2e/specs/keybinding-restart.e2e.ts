import { $, browser, expect } from "@wdio/globals";
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * 10#1 重启补验 E2E（独立 capability，conf.user.json 前置直写由 wdio.conf 配置
 * 加载期完成——应用启动读取早于 mocha 钩子，前置必须先于应用启动落盘）：
 * conf.user.json 配置 `"Always on Top": "Ctrl+Shift+P"` → 应用重启装载 →
 * ①快捷键合并数据生效（菜单 label 数据源）；②按键执行通路生效（按 Ctrl+Shift+P
 * 触发置顶——窗口域 keyBinding 动态快捷键，10#1 完整端到端）。
 *
 * 末用例以无脏直通关窗收尾（AC-M-21：不弹窗 + 窗口真关闭——本 spec 不产生脏
 * 标签，destroy 关窗后应用进程退出、会话终止即关窗证据；本 capability 之后
 * 仍有 New Window capability，各 capability 独立拉起实例互不影响）。
 *
 * 验证语义分层：
 * - 合并数据（menuShortcutEntries source=custom）= 菜单 label 渲染的直接数据源；
 *   label 合成文本由 menu-tree.spec.ts / use-native-menu.spec.ts（Vitest）覆盖，
 *   原生菜单 UI 为 OS 层，WebDriver 不可观测；
 * - 按键执行 = 窗口域 keyBinding 动态快捷键（window-keybinding-shortcuts 消费
 *   custom 条目注册 keydown → WINDOW_KEYBINDING_COMMANDS 派发）；
 * - 置顶态经 getCurrentWindow().isAlwaysOnTop() 查询（core:window:default 只读
 *   授权面，core:window:allow-is-always-on-top 在 default 集内）。
 *
 * 前置：含 Rust 变更分支先 cargo build（e2e/README.md §0）；npm run dev +
 * tauri-driver 后台运行；wdio.conf 已预置 conf.user.json 的 keyBinding 并在
 * onComplete 还原原字节。
 */

/** 查询当前窗口置顶态（只读授权面，default 集内） */
async function isAlwaysOnTop(): Promise<boolean> {
  return browser.execute(async () => {
    const mod = (await import("/node_modules/.vite/deps/@tauri-apps_api_window.js")) as unknown as {
      getCurrentWindow: () => { isAlwaysOnTop: () => Promise<boolean> };
    };
    return mod.getCurrentWindow().isAlwaysOnTop();
  });
}

/**
 * 向主窗投递 WM_CLOSE（等价用户点标题栏 X 的真实路径；window-shell.e2e.ts 同款
 * 通道——句柄经 Get-Process MainWindowHandle 获取，ps1 落临时目录避免引号转义）
 */
function sendWmClose(): void {
  const ps1 = path.join(os.tmpdir(), "markwell-e2e-wmclose.ps1");
  writeFileSync(
    ps1,
    [
      "$p = Get-Process typora-replica -ErrorAction Stop",
      "Add-Type -Namespace W -Name N -MemberDefinition @'",
      '[DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);',
      "'@",
      "[void][W.N]::PostMessage($p.MainWindowHandle, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)",
      "",
    ].join("\r\n"),
    "utf8",
  );
  execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${ps1}"`, {
    encoding: "utf8",
    timeout: 20000,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

describe("10#1 重启补验：keyBinding 自定义快捷键端到端（conf.user.json → 重启装载）", () => {
  it("conf.user.json 的 Always on Top 覆盖经重启装载进菜单快捷键合并数据（source=custom）", async () => {
    await $("[data-status-bar]").waitForExist({ timeout: 15000 });
    // settingsStore.load() 在 App onMounted 启动链路 await 完成（先于菜单装配），
    // 应用可用时合并数据已就绪；waitUntil 容忍首帧调度抖动
    await browser.waitUntil(
      async () => {
        const entry = await readAlwaysOnTopEntry();
        return entry !== undefined && entry.source === "custom";
      },
      { timeout: 8000, timeoutMsg: "keyBinding 覆盖未在时限内进入快捷键合并数据" },
    );
    const entry = (await readAlwaysOnTopEntry())!;
    // 自定义组合串覆盖生效（AC-C1-3 自定义优先）：目录默认无快捷键（defaultCombo
    // undefined → combo 空串），custom 值即 conf.user.json 注入
    expect(entry.combo).toBe("Ctrl+Shift+P");
    expect(entry.label).toBe("窗口置顶");
    expect(entry.source).toBe("custom");
  });

  it("按 Ctrl+Shift+P 触发窗口置顶，再按还原（10#1 按键执行通路完整端到端）", async () => {
    // 初始非置顶（新实例默认态）
    await expect(await isAlwaysOnTop()).toBe(false);
    // 按键 → 动态快捷键注册表命中（defaultPrevented 守卫通过）→ 命令映射派发
    // → toggleAlwaysOnTop IPC → Rust 窗口态真实翻转（IPC 异步，轮询查询面）
    await browser.keys(["Control", "Shift", "p"]);
    await browser.waitUntil(async () => (await isAlwaysOnTop()) === true, {
      timeout: 5000,
      timeoutMsg: "Ctrl+Shift+P 未触发窗口置顶",
    });
    // 再按还原（toggle 双向语义；保持后续用例与系统环境无残留置顶态）
    await browser.keys(["Control", "Shift", "p"]);
    await browser.waitUntil(async () => (await isAlwaysOnTop()) === false, {
      timeout: 5000,
      timeoutMsg: "再次 Ctrl+Shift+P 未还原置顶态",
    });
  });

  it("无脏标签关窗直通：不弹确认且窗口真关闭（AC-M-21 完整闭环）", async () => {
    // 前序用例未触碰文档（无脏）：关窗请求应直通关窗而非弹确认。
    // 轮询中先钉「不弹窗」决策面（弹窗出现即违背直通语义），会话终止
    // （窗口已关、应用进程退出）为关窗成功的终态证据
    sendWmClose();
    await browser.waitUntil(
      async () => {
        try {
          const dialog = await $('[role="dialog"][aria-label="未保存的更改"]');
          if (await dialog.isExisting()) throw new Error("无脏关窗不应弹确认");
          return false;
        } catch (e) {
          // 「不应弹确认」为真实断言失败必须上抛；其余（会话终止的 driver 错误）= 关窗证据
          if (String(e).includes("不应弹确认")) throw e;
          return true;
        }
      },
      { timeout: 8000, interval: 200, timeoutMsg: "无脏直通关窗未生效" },
    );
  });
});

/** 读菜单快捷键合并数据中的 Always on Top 条目（菜单 label 构建直接数据源） */
async function readAlwaysOnTopEntry(): Promise<
  { combo: string; label: string; source: string } | undefined
> {
  return browser.execute(async () => {
    // Vite dev 下同 URL 模块即页面运行中的同一 store 单例（B.2.4 setup store）
    const mod = (await import("/src/features/settings/settings-store.ts")) as unknown as {
      useSettingsStore: () => {
        menuShortcutEntries: Array<{
          commandId: string;
          label: string;
          combo: string;
          source: string;
        }>;
      };
    };
    return mod.useSettingsStore().menuShortcutEntries.find((e) => e.commandId === "Always on Top");
  });
}
