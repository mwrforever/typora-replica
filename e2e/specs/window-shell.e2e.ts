import { $, $$, browser, expect } from "@wdio/globals";
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * 12 窗口外壳 E2E（P4 阶段）：源码模式往返（AC-M-6/7/8）、F11 全屏（AC-M-13）、
 * 缩放档位（AC-M-14）、退出聚合确认（AC-M-18~21 用户可见行为路径，含源码态
 * 关窗回写修补用例——CM 层未回写编辑不得随 destroy 静默丢失）。
 *
 * 前置：①含 Rust 变更分支先 cargo build（capability application 指 debug 产物，
 *          e2e/README.md §0）；②npm run dev（1420）+ tauri-driver（4444）后台运行；
 *        ③wdio.conf 以 --reopen-file=e2e/.fixtures/opening.md 启动（启动即 1 个
 *          opening.md 标签，本 spec 制脏与写盘断言的基准文件）。
 *
 * 断言通道说明（实证依据见 spec 内各 helper 注释）：
 * - 窗口态（全屏）经 browser.execute 动态 import 应用 services/window-io.ts 查询——
 *   Vite dev 下同 URL 模块即页面运行中的同一实例，查询走应用自身 IPC 封装；
 * - 缩放生效面为 window.devicePixelRatio（WebView2 整窗 zoom 改变页面缩放因子，
 *   实测 100%→110% 时 1.5→1.65），前端 zoomPercent 镜像为控制器局部状态无 DOM 落点；
 * - 关窗请求经 OS 级 WM_CLOSE 投递（Get-Process 取主窗句柄 PostMessage）——等价用户
 *   点标题栏 X，走 Tauri close-requested JS 管线进退出聚合；WebView 内 JS 直调
 *   window.close 被 ACL 拦截（core:window:allow-close 未授权，产品无此调用方），
 *   WebDriver closeWindow 又绕过 JS 管线直杀窗口，两者均不等价用户路径。
 * - 窗口关闭证据 = 会话终止（destroy 后应用进程退出，后续 driver 命令必然失败）；
 *   「全部保存」为本 capability 末用例，session 终止不影响后续 capability 拉起
 *   新实例（AC-M-21 无脏直通关窗以 keybinding-restart spec 末用例等价覆盖）。
 *
 * E2E 局限（如实披露，禁止伪造断言）：
 * - AC-M-13「全屏时菜单栏隐藏」：菜单栏为 OS 原生 UI，WebDriver 无法观测；
 * - AC-M-6「源码语法高亮」：CodeMirror 高亮类名为生成态（非稳定选择器），
 *   高亮装配由 SourceModeLayer 挂载 @codemirror/lang-markdown 的 Vitest 层覆盖；
 * - AC-M-15 置顶 / New Window 行为：见 window-shell-new-window.e2e.ts（独立
 *   capability——New Window 触发后 driver 会话上下文被新窗口顶掉，必须独立收尾）。
 */

/** 启动 fixture 绝对路径（--reopen-file 目标；写盘断言基准） */
const fixturePath = path.join(process.cwd(), "e2e", ".fixtures", "opening.md");

/**
 * 向主窗投递 WM_CLOSE（等价用户点标题栏 X 的真实路径）。
 * 句柄经 Get-Process typora-replica 的 MainWindowHandle 获取（FindWindow 按标题
 * 匹配在本机环境不可靠，进程快照标题实证可读）；ps1 落临时目录避免内联引号转义。
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

/** 查询当前窗口全屏态（经应用 services/window-io 的 IPC 封装，同实例同调用链） */
async function isFullscreen(): Promise<boolean> {
  return browser.execute(async () => {
    const io = (await import("/src/services/window-io.ts")) as {
      isWindowFullscreen: () => Promise<boolean>;
    };
    return io.isWindowFullscreen();
  });
}

/** 取当前可见（激活）的编辑器宿主 pane（TabHost v-show 保活，须按显示态定位——11 同款惯例） */
async function visiblePane() {
  const panes = await $$(".tabs-host__pane");
  for (const pane of panes) {
    if (await pane.isDisplayed()) return pane;
  }
  throw new Error("未找到可见编辑器宿主");
}

/** 点击退出确认弹窗的指定按钮（全部保存/全部不保存/取消） */
async function clickDialogButton(label: string): Promise<void> {
  const buttons = await $$('[role="dialog"] button');
  for (const button of buttons) {
    if ((await button.getText()) === label) {
      await button.click();
      return;
    }
  }
  throw new Error(`弹窗按钮未找到: ${label}`);
}

describe("12 窗口外壳", () => {
  before(async () => {
    // 套件前置：等应用与编辑器完全就绪。状态栏挂出早于编辑器实例 adopt 与源码层
    // 宿主挂载（实测 Ctrl+/ 在状态栏刚出现时触发会被 source-mode 双前置守卫拒绝）——
    // 必须等 WYSIWYG 编辑器与源码层 CodeMirror 容器都渲染完成
    await $("[data-status-bar]").waitForExist({ timeout: 15000 });
    await $(".tabs-host__pane .milkdown .ProseMirror").waitForExist({ timeout: 15000 });
    await $('[data-testid="source-mode-layer"] .cm-content').waitForExist({ timeout: 15000 });
  });

  it("Ctrl+/ 切入源码模式：源码层显示 markdown 源码、WYSIWYG 层隐藏（AC-M-6）", async () => {
    await browser.keys(["Control", "/"]);
    // 切入含 IPC 无关的纯前端状态翻转 + nextTick 渲染，waitUntil 容忍调度抖动
    await browser.waitUntil(
      async () => {
        const layer = await $('[data-testid="source-mode-layer"]');
        return (await layer.isExisting()) && (await layer.isDisplayed());
      },
      { timeout: 5000, timeoutMsg: "源码层未在时限内显示" },
    );
    // 源码层承载 markdown 源文本（fixture 首行标题原样可见——AC-M-6 显示源码语义）
    const sourceText = await $('[data-testid="source-mode-layer"] .cm-content').getText();
    expect(sourceText).toContain("# 启动测试");
    // 双实例保活：WYSIWYG 侧以 v-show 隐藏（实例仍在 DOM——启动单标签场景取首 pane
    // 断言不可见即可，切入后可见 pane 不存在）
    const pane = await $(".tabs-host__pane");
    await expect(pane).not.toBeDisplayed();
  });

  it("源码层编辑后 Ctrl+/ 切回：内容同步 WYSIWYG 且焦点回编辑器（AC-M-7/8）", async () => {
    const sentinel = "E2E源码追加";
    // 在源码层末尾追加一行（Ctrl+End 到文档尾后键入）
    await $('[data-testid="source-mode-layer"] .cm-content').click();
    await browser.keys(["Control", "End"]);
    await browser.keys(["Enter", sentinel]);
    await browser.keys(["Control", "/"]);
    await browser.waitUntil(
      async () => !(await (await $('[data-testid="source-mode-layer"]')).isDisplayed()),
      { timeout: 5000, timeoutMsg: "源码层未在时限内隐藏" },
    );
    await expect(await visiblePane()).toBeDisplayed();
    // AC-M-8 内容同步：源码编辑经全文回写进入 WYSIWYG（回写为单事务，waitUntil 只防调度）
    const pane = await visiblePane();
    const editor = await pane.$(".milkdown .ProseMirror");
    await browser.waitUntil(async () => (await editor.getText()).includes(sentinel), {
      timeout: 5000,
      timeoutMsg: "源码编辑未同步回 WYSIWYG",
    });
    // AC-M-7 焦点移交：切出后装配层 nextTick 聚焦编辑器（键盘输入不丢失的可观测面）
    const activeIsEditor = await browser.execute(
      () => document.activeElement?.classList.contains("ProseMirror") ?? false,
    );
    expect(activeIsEditor).toBe(true);
    // 还原 fixture 基准内容（防止本用例追加文本污染退出确认用例的写盘断言基准）：
    // Ctrl+Z 撤销源码追加的单次回写事务（setContent 单事务保 undo——source-mode 契约）
    await editor.click();
    await browser.keys(["Control", "z"]);
    await browser.waitUntil(async () => !(await editor.getText()).includes(sentinel), {
      timeout: 5000,
      timeoutMsg: "撤销未还原基准内容",
    });
  });

  it("F11 进入全屏后再次 F11 退出恢复（AC-M-13）", async () => {
    await browser.keys("F11");
    // 全屏切换为窗口管理器异步操作，轮询应用 IPC 查询面至生效
    await browser.waitUntil(async () => (await isFullscreen()) === true, {
      timeout: 5000,
      timeoutMsg: "F11 后未进入全屏",
    });
    await browser.keys("F11");
    await browser.waitUntil(async () => (await isFullscreen()) === false, {
      timeout: 5000,
      timeoutMsg: "再次 F11 后未退出全屏",
    });
  });

  it("Ctrl+Shift+= 放大一档整窗缩放，Ctrl+Shift+0 恢复原始尺寸（AC-M-14）", async () => {
    const baseline = await browser.execute(() => window.devicePixelRatio);
    // Ctrl+Shift+= 按物理键位判定（event.code=Equal，Shift 参与 key 漂移为 "+"）
    await browser.keys(["Control", "Shift", "="]);
    // 放大一档 = 110%：页面缩放因子按比例放大（实测 1.5 → 1.65，留浮点容差）
    await browser.waitUntil(
      async () => (await browser.execute(() => window.devicePixelRatio)) > baseline * 1.05,
      { timeout: 5000, timeoutMsg: "缩放放大一档未生效" },
    );
    await browser.keys(["Control", "Shift", "0"]);
    await browser.waitUntil(
      async () => (await browser.execute(() => window.devicePixelRatio)) === baseline,
      { timeout: 5000, timeoutMsg: "Ctrl+Shift+0 未恢复原始尺寸" },
    );
  });

  /**
   * 退出聚合确认组（AC-M-18~21 用户可见行为路径）。
   * 组前置经设置面板关闭自动保存（真实 UI 路径）：停笔防抖 ~1s 会抢先写盘并清脏，
   * 使「取消后标签仍脏」与「全部保存写盘」断言失去确定性——关闭后本组完全由
   * 退出聚合管线独占写盘时机。设置落盘由 wdio.conf onComplete 字节级还原兜底，
   * 组后置立即还原开关，防同轮运行内后续 capability 的实例读到关闭态。
   */
  describe("退出聚合确认", () => {
    before(async () => {
      await browser.keys(["Control", ","]);
      const autoSaveSwitch = await $(
        '[data-testid="setting-row-save-recover.auto-save"] input[type="checkbox"]',
      );
      if (await autoSaveSwitch.isSelected()) {
        await autoSaveSwitch.click();
        await browser.pause(300); // 设置写盘为异步 IPC，留缓冲保证组内状态稳定
      }
      await browser.keys(["Escape"]);
    });

    after(async () => {
      // 还原自动保存开关（开）：与组前置对称，保持后续用例运行环境与默认一致。
      // 「全部保存」用例以窗口关闭结束（会话终止）时本还原无从执行——设置文件
      // 由 wdio.conf onComplete 字节级还原兜底，此处吞掉会话终止错误防假红
      try {
        await browser.keys(["Control", ","]);
        const autoSaveSwitch = await $(
          '[data-testid="setting-row-save-recover.auto-save"] input[type="checkbox"]',
        );
        if (!(await autoSaveSwitch.isSelected())) {
          await autoSaveSwitch.click();
          await browser.pause(300);
        }
        await browser.keys(["Escape"]);
      } catch {
        // 会话已终止（窗口关闭是本组末用例的预期终态）：跳过还原
      }
    });

    it("源码态未回写编辑直接关窗：回写置脏进确认列表，取消后内容不丢（静默丢失修复）", async () => {
      // 基准干净化：Ctrl+S 存盘清脏（本组已关自动保存）——此后确认弹窗的出现
      // 完全归因于源码态关窗回写置脏，排除既有脏状态干扰（修复前此处无脏直通
      // destroy，源码层编辑静默丢失且无任何确认/备份/提示）
      await browser.keys(["Control", "s"]);
      await browser.waitUntil(
        async () => {
          const cls = await (await $(".tab-bar__tab--active")).getAttribute("class");
          return !cls.includes("tab-bar__tab--dirty");
        },
        { timeout: 5000, timeoutMsg: "Ctrl+S 后标签未变干净" },
      );
      // 进源码模式在 CM 层追加哨兵（不置脏、不产 markdownUpdated 的静默编辑面）
      const sentinel = "源码态关窗哨兵";
      await browser.keys(["Control", "/"]);
      await $('[data-testid="source-mode-layer"] .cm-content').click();
      await browser.keys(["Control", "End"]);
      await browser.keys(["Enter", sentinel]);
      // 关窗请求：回写先于聚合发生——干净标签被置脏进确认列表（AC-M-18 语义
      // 覆盖源码层编辑），未确认前不写盘
      sendWmClose();
      const dialog = await $('[role="dialog"][aria-label="未保存的更改"]');
      await dialog.waitForExist({ timeout: 5000 });
      expect(await $(".exit-confirm__list").getText()).toContain("opening.md");
      expect(readFileSync(fixturePath, "utf8").includes(sentinel)).toBe(false);
      // 取消（AC-M-20）：窗口保持，回写内容不丢
      await clickDialogButton("取消");
      await browser.waitUntil(async () => !(await dialog.isExisting()), {
        timeout: 3000,
        timeoutMsg: "取消后弹窗未关闭",
      });
      // 回写证据：切回 WYSIWYG 后哨兵已在编辑器内容中（flush 进 PM 文档，
      // 非仅置脏标志）
      await browser.keys(["Control", "/"]);
      await browser.waitUntil(
        async () =>
          (await (await visiblePane()).$(".milkdown .ProseMirror").getText()).includes(sentinel),
        { timeout: 5000, timeoutMsg: "关窗回写未进入编辑器内容" },
      );
    });

    it("脏标签关窗弹列表式确认，取消后窗口保持内容不变（AC-M-18/20）", async () => {
      // 制脏：在 WYSIWYG 末尾追加哨兵文本（markdownUpdated 全链路 500ms 防抖后置脏）
      const sentinel = "退出确认哨兵文本";
      const pane = await visiblePane();
      const editor = await pane.$(".milkdown .ProseMirror");
      await editor.click();
      await browser.keys(["Control", "End"]);
      await browser.keys(sentinel);
      await browser.pause(700); // 等 markdownUpdated 防抖到达置脏（宪法 B.3 预算）
      // 关窗请求 → 聚合出脏标签 → 列表式一次性确认（AC-M-18）
      sendWmClose();
      const dialog = await $('[role="dialog"][aria-label="未保存的更改"]');
      await dialog.waitForExist({ timeout: 5000 });
      const listText = await $(".exit-confirm__list").getText();
      expect(listText).toContain("opening.md");
      // 取消（AC-M-20）：弹窗关闭、窗口保持、内容不丢（无写盘——自动保存已关）
      await clickDialogButton("取消");
      await browser.waitUntil(async () => !(await dialog.isExisting()), {
        timeout: 3000,
        timeoutMsg: "取消后弹窗未关闭",
      });
      await expect(await $(".milkdown").isExisting()).toBe(true);
      expect((await editor.getText()).includes(sentinel)).toBe(true);
      expect(readFileSync(fixturePath, "utf8").includes(sentinel)).toBe(false);
    });

    it("再触发关窗选「全部保存」：逐标签写盘成功后窗口关闭（AC-M-19）", async () => {
      const sentinel = "退出确认哨兵文本";
      const original = readFileSync(fixturePath, "utf8");
      try {
        // 上一用例取消后标签仍脏（取消无写盘），直接再触发关窗
        sendWmClose();
        const dialog = await $('[role="dialog"][aria-label="未保存的更改"]');
        await dialog.waitForExist({ timeout: 5000 });
        await clickDialogButton("全部保存");
        // 写盘是 AC-M-19 的核心业务结果（Node 侧读 fixture 断言，不依赖会话存活；
        // 自动保存已关，写盘唯一来源 = 全部保存出口）
        await browser.waitUntil(() => readFileSync(fixturePath, "utf8").includes(sentinel), {
          timeout: 8000,
          interval: 200,
          timeoutMsg: "全部保存未写盘",
        });
        // 全部成功后 destroy 关窗（复核聚合为空 → closing 终态）：会话终止即窗口
        // 关闭证据——窗口销毁后应用进程退出，任何后续 driver 命令必然失败。
        // 用例为 capability 1 最后一个用例，session 终止不影响后续 capability
        await browser.waitUntil(
          async () => {
            try {
              await browser.execute(() => 1);
              return false;
            } catch {
              return true;
            }
          },
          { timeout: 8000, interval: 200, timeoutMsg: "全部保存后窗口未关闭" },
        );
      } finally {
        // 还原 fixture 原始字节：写盘断言改变了基准文件（Node 侧 fs 独立于已终止
        // 的会话；下次运行由 wdio.conf 顶层重置，此处立即还原防同轮污染）
        writeFileSync(fixturePath, original, "utf8");
      }
    });
  });
});
