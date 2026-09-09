import { $, $$, browser, expect } from "@wdio/globals";

/**
 * 状态栏 E2E（11 模块，AC 抽样：AC-S3-1/2/3/7 + AC-S3-8）
 *
 * 前置：wdio.conf 以 --reopen-file=e2e/.fixtures/opening.md 启动（启动即 1 个标签，
 * 固定内容「# 启动测试 / 自动保存验证占位。」= 12 词 / 13 字符 / 2 行——标签切换
 * 用例的期望值来源），状态栏默认显示（settings.appearance.showStatusBar 默认 true）、
 * 默认计数单位 words（组件内会话态）。
 * 覆盖：新建空文档 0 词不崩溃 + 输入中拉混排文本计数实时更新（AC-S3-1/8）、
 * 字数按钮弹统计面板四项与 click-away 关闭（AC-S3-2）、点击单位条目切换按钮即时
 * 跟随且重开面板勾选保持（AC-S3-3）、Ctrl+Tab 切换标签统计跟随（AC-S3-7）。
 * 防抖预算：docUpdated 全链路 400ms（事件桥 200ms + listener 内置 200ms，宪法 B.3）——
 * 统计文案变化的断言统一走 waitUntil（上限 5000ms），既覆盖预算又容忍 CI 抖动。
 */
describe("11 状态栏", () => {
  before(async () => {
    // 套件前置：等状态栏与字数按钮挂出（应用启动 + 设置快照装载后渲染）
    await $("[data-status-bar]").waitForExist({ timeout: 15000 });
    await $("[data-status-bar-count]").waitForExist({ timeout: 5000 });
  });

  /**
   * 取当前可见（激活）的编辑器宿主 pane。
   * TabHost 以 v-show 保活全部标签，隐藏 pane 仍在 DOM——必须按显示态定位，
   * 直接取第一个会命中不可见的旧标签编辑器（outline.e2e / tabs.e2e 同款惯例）。
   */
  async function visiblePane() {
    const panes = await $$(".tabs-host__pane");
    for (const pane of panes) {
      if (await pane.isDisplayed()) return pane;
    }
    throw new Error("未找到可见编辑器宿主");
  }

  /** 字数按钮（计数文案与 aria-expanded 的统一断言口） */
  function countButton() {
    return $("[data-status-bar-count]");
  }

  /**
   * 等待字数按钮文案变为期望值。
   * 统计更新落在 docUpdated 全链路 400ms 防抖预算内，超时上限留足余量容忍 CI 抖动。
   * @param label 期望的按钮完整文案（如「3 词」「8 字符」）
   */
  async function waitForButtonLabel(label: string): Promise<void> {
    await browser.waitUntil(async () => (await countButton().getText()) === label, {
      timeout: 5000,
      interval: 100,
      timeoutMsg: `字数按钮未在时限内变为「${label}」`,
    });
  }

  /** 点击字数按钮打开统计面板并等挂出 */
  async function openPanel(): Promise<void> {
    await countButton().click();
    await $("[data-status-bar-panel]").waitForExist({ timeout: 5000 });
  }

  /** click-away 关闭：点击编辑器触发 document 一次性 click 监听，等面板摘除 */
  async function closePanelViaClickAway(): Promise<void> {
    const pane = await visiblePane();
    await pane.$(".milkdown .ProseMirror").click();
    await $("[data-status-bar-panel]").waitForExist({ reverse: true, timeout: 5000 });
  }

  it("新建空文档显示 0 词，输入中拉混排文本后计数实时更新为 3 词（AC-S3-1/8）", async () => {
    // Ctrl+N 新建空文档（04 createUntitled），等新标签激活——挂载完成后编辑器才可聚焦输入
    await browser.keys(["Control", "n"]);
    await browser.waitUntil(
      async () => {
        const active = await $(".tab-bar__tab--active .tab-bar__title");
        return active && (await active.getText()).includes("Untitled");
      },
      { timeout: 10000, timeoutMsg: "Ctrl+N 新标签未在时限内激活" },
    );
    // 空文档 0 词不崩溃（AC-S3-8；标签切换拉取通道将统计复位为空文档口径）
    await waitForButtonLabel("0 词");

    // 键入「Hello 世界」：Hello 连续拉丁串 = 1 词 + 世/界逐字各 1 词 = 3 词
    // （CJK 逐字 + 拉丁连续串计词口径，AC-S3-1）
    const pane = await visiblePane();
    const editor = await pane.$(".milkdown .ProseMirror");
    await editor.click();
    await browser.keys("Hello 世界");
    // 实时更新断言落在 400ms 防抖预算内（等待窗口见 waitForButtonLabel 注释）
    await waitForButtonLabel("3 词");
  });

  it("点击字数按钮弹出统计面板四项，click-away 点击外部关闭（AC-S3-2）", async () => {
    await openPanel();
    const panel = await $("[data-status-bar-panel]");
    await expect(panel).toBeDisplayed();
    // 面板可访问语义：role=dialog + aria-label=统计详情
    await expect(panel).toHaveAttribute("role", "dialog");
    await expect(panel).toHaveAttribute("aria-label", "统计详情");

    // 四项可见：行数/字数/字符数三个单位条目 + 估计阅读时间信息行
    // （默认阅读速度 200 词/分 > 0，阅读时间行显示）
    const unitRows = await $$("[data-status-bar-panel] [data-status-bar-unit]");
    await expect(unitRows).toBeElementsArrayOfSize(3);
    const labels: string[] = [];
    for (const row of unitRows) {
      labels.push(await row.getText());
    }
    expect(labels.some((t) => t.includes("行数"))).toBe(true);
    expect(labels.some((t) => t.includes("字数"))).toBe(true);
    expect(labels.some((t) => t.includes("字符数"))).toBe(true);
    await expect($(".status-bar__row--info")).toHaveText(expect.stringContaining("估计阅读时间"));
    await expect(countButton()).toHaveAttribute("aria-expanded", "true");

    // click-away：点击编辑器空白处 → document 一次性 click → 面板关闭 + 展开态归位
    await closePanelViaClickAway();
    await expect($("[data-status-bar-panel]")).not.toExist();
    await expect(countButton()).toHaveAttribute("aria-expanded", "false");
  });

  it("面板点击「字符数」切换单位：按钮即时跟随、重开面板勾选保持（AC-S3-3）", async () => {
    await openPanel();
    // 点击字符数条目 → 默认计数单位切换，按钮即时由「3 词」变「8 字符」
    // （Hello 世界 = 5 拉丁 + 1 空格 + 2 汉字 = 8 字符，字符口径含空格）
    await $('[data-status-bar-unit="characters"]').click();
    await waitForButtonLabel("8 字符");
    // ✓ 勾选移到字符数行（当前单位标识），字数行勾选清空
    await expect($('[data-status-bar-unit="characters"] .status-bar__check')).toHaveText("✓");
    await expect($('[data-status-bar-unit="words"] .status-bar__check')).toHaveText("");

    // 关闭后重开：单位为会话内组件状态，勾选保持在字符数上
    await closePanelViaClickAway();
    await openPanel();
    await expect($('[data-status-bar-unit="characters"] .status-bar__check')).toHaveText("✓");

    // 还原字数单位（会话态虽不跨重启持久，还原保持后续用例与默认口径一致）
    await $('[data-status-bar-unit="words"]').click();
    await waitForButtonLabel("3 词");
    await closePanelViaClickAway();
  });

  it("Ctrl+Tab 切换标签，状态栏统计跟随活动标签文档（AC-S3-7）", async () => {
    // 当前 Untitled = 3 词；Ctrl+Tab 正向轮换回启动标签 opening.md
    // （fixture 固定内容 = 12 词：「启动测试」4 + 「自动保存验证占位」8，句号不计词）
    await browser.keys(["Control", "Tab"]);
    await waitForButtonLabel("12 词");
    await expect($(".tab-bar__tab--active .tab-bar__title")).toHaveText(
      expect.stringContaining("opening.md"),
    );
    // 再切回 Untitled，统计跟随回该文档口径
    await browser.keys(["Control", "Tab"]);
    await waitForButtonLabel("3 词");
    await expect($(".tab-bar__tab--active .tab-bar__title")).toHaveText(
      expect.stringContaining("Untitled"),
    );
  });
});
