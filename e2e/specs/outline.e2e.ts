import { $, $$, browser, expect } from "@wdio/globals";

/**
 * 大纲面板 E2E（05 模块，AC-F16-1/F17/F18-1/F21）
 *
 * 前置：wdio.conf 以 --reopen-file=e2e/.fixtures/opening.md 启动（启动即 1 个标签、
 * 侧栏默认文件树面板），本文件不依赖文件树，全部在 Ctrl+N 新建的空文档上操作。
 * 覆盖：Ctrl+Shift+1 打开大纲 + 两级标题条目渲染与层级缩进（AC-F16-1/F17）、
 * 点击「准备」条目跳转——以「条目激活高亮 / 编辑器选区 / 闪现高亮类」任一证据
 * 判定光标落位（AC-F18-1）、过滤框输入不存在的词出空态文案 + 清空恢复（AC-F21）。
 * 披露：滚动通道高亮依赖真实布局度量（pickActiveByTop），E2E 不做像素级断言，
 * 由 vitest 纯函数用例覆盖；Ctrl+Shift+1 经 WebDriver 合成时 Shift+数字的
 * event.key 受键盘布局影响（美式布局为 "!"），不命中时以合成 KeyboardEvent
 * 兜底（走同一条 window keydown 监听链路，见场景 1 注释）。
 */
describe("05 大纲面板", () => {
  /**
   * 取当前可见（激活）的编辑器宿主 pane。
   * TabHost 以 v-show 保活全部标签，隐藏 pane 仍在 DOM——必须按显示态定位，
   * 直接取第一个会命中不可见的旧标签编辑器（tabs.e2e 同款惯例）。
   */
  async function visiblePane() {
    const panes = await $$(".tabs-host__pane");
    for (const pane of panes) {
      if (await pane.isDisplayed()) return pane;
    }
    throw new Error("未找到可见编辑器宿主");
  }

  /** 取大纲面板当前渲染的全部条目（data-outline-item，文档序） */
  function outlineItems() {
    return $$("[data-outline-item]");
  }

  /**
   * 打开大纲面板：真实键位 Ctrl+Shift+1 优先，短轮询未开面板时以合成事件兜底。
   *
   * 兜底原因：WebDriver 键序列在 Shift 按下时数字键的 event.key 由目标键盘布局
   * 决定（美式布局产生 "!"），可能绕不过 file-tree-shortcuts 的 key==="1" 判断；
   * 合成 KeyboardEvent 与 file-tree-shortcuts 单测同构（key="1"+ctrl+shift），
   * 命中同一条 window keydown → switchPanel("outline") 链路。
   */
  async function openOutlinePanel(): Promise<void> {
    await browser.keys(["Control", "Shift", "1"]);
    let opened = false;
    for (let i = 0; i < 8 && !opened; i++) {
      opened = await $(".outline-panel").isExisting();
      if (!opened) await browser.pause(100);
    }
    if (!opened) {
      await browser.execute(() => {
        window.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "1",
            ctrlKey: true,
            shiftKey: true,
            bubbles: true,
            cancelable: true,
          }),
        );
      });
    }
    await (await $(".outline-panel")).waitForExist({ timeout: 5000 });
  }

  it("新建文档输入两级标题，Ctrl+Shift+1 打开大纲并渲染缩进条目（AC-F16-1/F17）", async () => {
    // Ctrl+N 新建空文档（04 registerTabsShortcuts → createUntitled），
    // 等待新标签激活——挂载完成后编辑器才可聚焦输入
    await browser.keys(["Control", "n"]);
    await browser.waitUntil(
      async () => {
        const active = await $(".tab-bar__tab--active .tab-bar__title");
        return active && (await active.getText()).includes("Untitled");
      },
      { timeout: 10000, timeoutMsg: "Ctrl+N 新标签未在时限内激活" },
    );

    // 空文档键入两级标题：`# `/`## ` 输入规则实时转标题（smoke.e2e 同款键入惯例）
    const pane = await visiblePane();
    const editor = await pane.$(".milkdown .ProseMirror");
    await editor.click();
    await browser.keys(["#", " ", "安装", "Enter", "#", "#", " ", "准备", "Enter", "正文"]);
    // 结构通道防抖（updated 200ms）后大纲数据才稳定，留余量
    await browser.pause(600);

    // 快捷键打开大纲面板（侧栏默认文件树面板，打开动作本身即 AC-F16-1 断言点）
    await openOutlinePanel();

    // 条目渲染：h1「安装」+ h2「准备」按文档序各一条
    const items = await outlineItems();
    await expect(items).toBeElementsArrayOfSize(2);
    await expect(items[0]).toHaveText(expect.stringContaining("安装"));
    await expect(items[1]).toHaveText(expect.stringContaining("准备"));

    // 层级缩进（F17）：条目内联 padding-left = (level-1)*16px，h2 缩进必须大于 h1
    // （经 computed style 取数值比较，避免对样式注入方式的实现细节绑定）
    const indents = await browser.execute(() =>
      Array.from(document.querySelectorAll<HTMLElement>("[data-outline-item]")).map(
        (el) => Number.parseFloat(getComputedStyle(el).paddingLeft) || 0,
      ),
    );
    expect(indents).toHaveLength(2);
    expect(indents[1]).toBeGreaterThan(indents[0]);
  });

  it("点击「准备」条目跳转：编辑器光标落位该标题（AC-F18-1）", async () => {
    // 前置收敛：光标移到文首——文档以 h1 开头，pos 0 落在「安装」标题内部，
    // 编辑通道按祖先链判定激活为第 1 项（首个标题 pos=0，「之前无标题回退
    // undefined」的空高亮态在本文档不可达）。以此与目标第 2 项区分，
    // 排除「输入结束后激活本就停在『准备』」的假阳性
    const pane = await visiblePane();
    const editor = await pane.$(".milkdown .ProseMirror");
    await editor.click();
    await browser.keys(["Control", "Home"]);
    await browser.waitUntil(
      async () => {
        const before = await outlineItems();
        if (before.length < 2) return false;
        const first = await before[0].getAttribute("class");
        const second = await before[1].getAttribute("class");
        return (
          first.includes("outline-panel__item--active") &&
          !second.includes("outline-panel__item--active")
        );
      },
      { timeout: 5000, interval: 100, timeoutMsg: "光标移至文首后激活条目未落到第 1 项" },
    );

    // 点击第二项（准备）→ jumpTo 走锁定接口 revealRange：选中标题文本区间 +
    // 编辑器容器闪现 markwell-reveal-highlight（1200ms）+ selectionUpdated 即时
    // 通道回写 store 激活条目。三证据任一出现即判定跳转成立。
    const items = await outlineItems();
    await items[1].click();
    await browser.waitUntil(
      async () => {
        const activeClass = await items[1].getAttribute("class");
        if (activeClass.includes("outline-panel__item--active")) return true;
        const selection = await browser.execute(() => window.getSelection()?.toString() ?? "");
        if ((selection as string).includes("准备")) return true;
        return $(".milkdown h2.markwell-reveal-highlight").isExisting();
      },
      { timeout: 5000, interval: 100, timeoutMsg: "点击大纲条目后未观察到任何跳转证据" },
    );
    // 激活高亮为持久状态（选区通道回写 Pinia → 类绑定），作为最终硬断言；
    // 选区文本与闪现类受焦点/时限影响，仅作 waitUntil 内的辅助证据不作硬断言
    const activeClass = await items[1].getAttribute("class");
    expect(activeClass).toContain("outline-panel__item--active");
  });

  it("过滤框输入不存在的词出空态文案，清空后恢复全量条目（AC-F21）", async () => {
    const filter = await $("[data-outline-filter]");
    await filter.waitForExist({ timeout: 5000 });

    // 输入即滤：不存在命中的词 → 列表隐藏 + 空态文案「无匹配标题」（F21-2）
    await filter.setValue("不存在");
    await $("[data-outline-list]").waitForExist({ reverse: true, timeout: 5000 });
    await expect($(".outline-panel__empty")).toHaveText("无匹配标题");

    // 清空恢复：Ctrl+A 全选 + Backspace 删除清空过滤词（setValue 空串不产生
    // 按键事件、v-model 不回写，实测过滤态残留导致列表不恢复），空态消失（F21 往返）
    await filter.click();
    await browser.keys(["Control", "a", "Backspace"]);
    await $("[data-outline-list]").waitForExist({ timeout: 5000 });
    await expect($$("[data-outline-item]")).toBeElementsArrayOfSize(2);
    await expect($(".outline-panel__empty")).not.toExist();
  });
});
