import { $, browser, expect } from "@wdio/globals";

/**
 * 12 窗口外壳 E2E（独立 capability 收尾执行）：置顶切换 IPC 实证（AC-M-15）+
 * New Window 多窗口句柄观测（AC-M-16）。
 *
 * 为何独立 capability（必须最后执行）：
 * - New Window（Ctrl+Shift+N）触发后 tauri-driver 的会话「当前窗口」上下文被新窗口
 *   顶掉，主窗 DOM 查询失联（探针实证：触发后 .milkdown 查询 8s 不可达，且
 *   switchWindow 到新句柄只能看到 about:blank 空上下文）——本 spec 之后不能再有
 *   依赖主窗交互的用例，故单独成文件、单独 capability，置于全部 capability 末尾；
 * - 置顶用例在前：toggle 后窗口 OS 层最前显示，不影响 WebDriver 交互，用例内
 *   toggle 两次还原。
 *
 * E2E 局限（如实披露，禁止伪造断言）：
 * - AC-M-15「窗口置顶后保持最前」的 OS 窗口层级无法经 WebDriver 断言（无窗口
 *   Z 序查询协议）；本 spec 实证 toggle_always_on_top IPC 的真实生效（返回值与
 *   isAlwaysOnTop 查询一致翻转），菜单入口（View → Always on Top）为 OS 原生
 *   菜单不可自动化——点击链路由 menu-router.spec.ts（Vitest）覆盖；
 * - AC-M-15 keyBinding 自定义组合（如 Ctrl+Shift+P）无按键执行通路：菜单装配
 *   红线不设原生 accelerator（防 OS 层抢键，menu-io.ts）、窗口域命令不进编辑器
 *   命令目录（bindMenuShortcut 拒绝）——keyBinding 覆盖对窗口域命令的端到端
 *   语义是菜单 label 展示流，由 keybinding-restart.e2e.ts（独立 capability，
 *   conf.user.json 前置）补验；
 * - AC-M-16「新窗口初始空文档、独立标签状态」：新窗口内容层在 WebDriver 下
 *   不可达（about:blank），初始空文档由 use-window-controls.spec.ts（Vitest，
 *   newWindow 编排）与 window_controls.rs 命令测试（create_main_window）覆盖；
 *   本 spec 断言可达面 = 新窗口句柄出现。
 */

/** 查询当前窗口置顶态（core:window:allow-is-always-on-top 在 default 授权集内） */
async function isAlwaysOnTop(): Promise<boolean> {
  return browser.execute(async () => {
    const mod = (await import("/node_modules/.vite/deps/@tauri-apps_api_window.js")) as unknown as {
      getCurrentWindow: () => { isAlwaysOnTop: () => Promise<boolean> };
    };
    return mod.getCurrentWindow().isAlwaysOnTop();
  });
}

/** 经应用 services/window-io 的 IPC 封装切换置顶（与菜单 action 同一命令链路） */
async function toggleAlwaysOnTop(): Promise<boolean> {
  return browser.execute(async () => {
    const io = (await import("/src/services/window-io.ts")) as {
      toggleAlwaysOnTop: () => Promise<boolean>;
    };
    return io.toggleAlwaysOnTop();
  });
}

describe("12 窗口外壳：置顶与新窗口", () => {
  before(async () => {
    await $("[data-status-bar]").waitForExist({ timeout: 15000 });
  });

  it("置顶切换 IPC 真实生效：toggle 后置顶态翻转，再 toggle 还原（AC-M-15）", async () => {
    // 初始非置顶（新实例默认态）
    expect(await isAlwaysOnTop()).toBe(false);
    // 经应用 IPC 封装切换（menuRouter view.always-on-top 同一命令链路的 services 面）
    expect(await toggleAlwaysOnTop()).toBe(true);
    // Rust 侧窗口状态真实翻转（isAlwaysOnTop 查询与 toggle 返回值一致）
    await expect(await isAlwaysOnTop()).toBe(true);
    // 还原（保持后续用例与系统环境无残留置顶态）
    expect(await toggleAlwaysOnTop()).toBe(false);
    await expect(await isAlwaysOnTop()).toBe(false);
  });

  it("Ctrl+Shift+N 触发后新窗口句柄出现（AC-M-16 可达面）", async () => {
    const before = await browser.getWindowHandles();
    await browser.keys(["Control", "Shift", "n"]);
    // 新窗口由 Rust create_main_window 异步创建（WebviewWindowBuilder build + 前端装载）
    await browser.waitUntil(async () => (await browser.getWindowHandles()).length > before.length, {
      timeout: 8000,
      timeoutMsg: "New Window 后新窗口句柄未出现",
    });
    // 本断言之后不得再交互主窗（driver 上下文已被新窗口顶掉，见文件头说明）
    expect((await browser.getWindowHandles()).length).toBe(before.length + 1);
  });
});
