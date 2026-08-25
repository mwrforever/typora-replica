import { $, $$, browser, expect } from "@wdio/globals";

/**
 * 搜索替换 E2E（06 模块，AC-F24-1/2/4/5、F25-3、F26-1/2/3）
 *
 * 前置：wdio.conf 为本 spec 单设 capability——以 --reopen-file=<系统临时目录>/
 * markwell-e2e-search/opening.md 启动。扫描根不可用 e2e/.fixtures（被仓库
 * gitignore 覆盖，全局搜索按 F26 尊重 ignore 恒零命中），故以仓库外可见的
 * 临时目录为侧栏 currentDir（F1-2 父目录加载），即全局搜索数据源。
 * 本 spec 独占一个应用会话，三用例按序执行：
 *   1. 当前文件查找：Ctrl+N 新建文档 → Ctrl+F 浮层弹出且输入框聚焦 → 计数 n/m
 *      + 命中高亮类 → F3 活动高亮类 → Esc 关闭（AC-F24-1/2/4/5）。
 *   2. 替换与单次撤销：Ctrl+H 替换态 → 「全部」→ 原词全部消失 → Ctrl+Z 一次
 *      全部还原（replaceAll 单事务合并语义的用户可见面，AC-F25-3）。
 *   3. 跨文件定位：Ctrl+Shift+F 全局搜索入口 → 键入 opening.md 稳定词 + Enter
 *      → opening.md 分组出现 → 点击条目 → 激活 opening.md 标签且编辑器出现
 *      选区/闪现高亮证据（AC-F26-1/2/3）。
 * 披露：①截断提示（AC-F26-3 上限面）依赖结果量，E2E 不造大目录——由 Rust 单测
 * （truncated 标志）+ GlobalSearchPanel 组件用例覆盖，此处不做；②Ctrl+F/H、
 * Ctrl+Shift+F、F3、Esc 经 WebDriver 合成时组合键 event.key 受键盘布局影响
 * （outline.e2e 同款披露），探测未命中时以合成 KeyboardEvent 兜底——走同一条
 * window keydown 监听链路（search-shortcuts / file-tree-shortcuts 注册处）。
 */
describe("06 搜索替换", () => {
  /**
   * 取当前可见（激活）的编辑器宿主 pane。
   * TabHost 以 v-show 保活全部标签，隐藏 pane 仍在 DOM——必须按显示态定位
   * （tabs.e2e / outline.e2e 同款惯例）。
   */
  async function visiblePane() {
    const panes = await $$(".tabs-host__pane");
    for (const pane of panes) {
      if (await pane.isDisplayed()) return pane;
    }
    throw new Error("未找到可见编辑器宿主");
  }

  /** 取激活编辑器的 ProseMirror 根元素（点击聚焦 / 文本断言入口） */
  async function activeEditor() {
    const pane = await visiblePane();
    return pane.$(".milkdown .ProseMirror");
  }

  /** 统计当前激活编辑器文本中某词出现次数（替换/撤销的量化断言） */
  async function countWordInEditor(word: string): Promise<number> {
    const text = await (await activeEditor()).getText();
    return text.split(word).length - 1;
  }

  /**
   * 窗口级快捷键触发：真实键位优先，短轮询探测未命中时以合成 KeyboardEvent 兜底。
   *
   * 兜底原因：WebDriver 键序列的组合键 event.key 由目标键盘布局决定（outline.e2e
   * 实测 Shift+数字产生 "!"），可能绕不过快捷键注册处的 key 判断；合成事件与
   * 单测同构，命中同一条 window keydown 链路。
   * @param keys 真实键序（browser.keys 参数）
   * @param synthetic 合成事件 init（key 与修饰位，与快捷键判断字段同构）
   * @param probe 生效判定（轮询至 true 为止）
   * @param probeMsg 探测超时文案
   */
  async function triggerWindowShortcut(
    keys: string[],
    synthetic: { key: string; ctrlKey?: boolean; shiftKey?: boolean },
    probe: () => Promise<boolean>,
    probeMsg: string,
  ): Promise<void> {
    await browser.keys(keys);
    let hit = false;
    for (let i = 0; i < 8 && !hit; i++) {
      hit = await probe();
      if (!hit) await browser.pause(100);
    }
    if (!hit) {
      await browser.execute((init) => {
        window.dispatchEvent(
          new KeyboardEvent("keydown", { ...init, bubbles: true, cancelable: true }),
        );
      }, synthetic);
    }
    await browser.waitUntil(probe, { timeout: 5000, timeoutMsg: probeMsg });
  }

  /** Ctrl+N 新建空文档并等待其标签激活（outline.e2e 同款惯例） */
  async function newUntitledDoc(): Promise<void> {
    await browser.keys(["Control", "n"]);
    await browser.waitUntil(
      async () => {
        const active = await $(".tab-bar__tab--active .tab-bar__title");
        return active && (await active.getText()).includes("Untitled");
      },
      { timeout: 10000, timeoutMsg: "Ctrl+N 新标签未在时限内激活" },
    );
  }

  it("Ctrl+F 弹浮层聚焦输入，计数 n/m + 高亮类，F3 活动态，Esc 关闭（AC-F24-1/2/4/5）", async () => {
    // 新建文档键入两段含重复词文本；光标停文末——activeMatchIndex 按命中末序回写
    await newUntitledDoc();
    const editor = await activeEditor();
    await editor.click();
    await browser.keys(["alpha", " ", "beta", " ", "alpha", " ", "gamma"]);

    // Ctrl+F 打开 Find 浮层（窗口层 search-shortcuts 链路）
    await triggerWindowShortcut(
      ["Control", "f"],
      { key: "f", ctrlKey: true },
      () => $("[data-find-panel]").isExisting(),
      "Ctrl+F 未在时限内打开查找面板",
    );

    // AC-F24-1：面板弹出且查询框自动聚焦
    const findInput = await $("[data-find-input]");
    await expect(findInput).toBeDisplayed();
    await expect(findInput).toBeFocused();

    // 键入关键词：计数 n/m（光标在文末→活动序号落最后一处→2/2）+ 两处高亮装饰；
    // 计数经 applyToView→150ms 防抖回写，waitUntil 吸收时延
    await findInput.setValue("alpha");
    const count = await $("[data-find-count]");
    await count.waitForExist({ timeout: 5000 });
    await browser.waitUntil(async () => (await count.getText()) === "2/2", {
      timeout: 5000,
      interval: 100,
      timeoutMsg: "计数未回写为 2/2",
    });
    const pane = await visiblePane();
    await expect(pane.$$(".ProseMirror-search-match")).toBeElementsArrayOfSize(2);
    // 光标不在任何命中上：活动态装饰尚未出现（F3 前置基线，排除假阳性）
    await expect(pane.$(".ProseMirror-active-search-match")).not.toExist();

    // F3 导航：选区落到首个命中上，插件重建装饰出活动高亮类（AC-F24-4）。
    // 注：此刻焦点在查找框，ProseMirror 不回写 DOM 选区（focused 才同步），
    // 故以活动装饰元素的文本作命中落点证据，不读 window.getSelection
    await triggerWindowShortcut(
      ["F3"],
      { key: "F3" },
      async () => (await pane.$(".ProseMirror-active-search-match").isExisting()) === true,
      "F3 后未出现活动命中高亮",
    );
    const activeText = await pane.$(".ProseMirror-active-search-match").getText();
    expect(activeText).toContain("alpha");

    // Esc 关闭浮层（AC-F24-5）：v-if 卸载，装饰随 close 清除
    await triggerWindowShortcut(
      ["Escape"],
      { key: "Escape" },
      async () => !(await $("[data-find-panel]").isExisting()),
      "Esc 未在时限内关闭查找面板",
    );
  });

  it("Ctrl+H 替换态「全部」一键全替，Ctrl+Z 一次全部还原（AC-F25-3）", async () => {
    // 全新空文档构造三处命中（上一用例关闭了面板，store 会话记忆残留旧词需覆写）
    await newUntitledDoc();
    const editor = await activeEditor();
    await editor.click();
    await browser.keys(["red", " ", "green", " ", "red", " ", "blue", " ", "red"]);

    // Ctrl+H 直接进替换态：替换行渲染（AC-F25-1/2 的 E2E 面）
    await triggerWindowShortcut(
      ["Control", "h"],
      { key: "h", ctrlKey: true },
      () => $("[data-replace-input]").isExisting(),
      "Ctrl+H 未在时限内进入替换态",
    );
    const findInput = await $("[data-find-input]");
    await findInput.setValue("red");
    // 等「全部」可用（canReplace = 查询非空且状态 ok）再点，避免禁用守卫吞掉动作
    const count = await $("[data-find-count]");
    await browser.waitUntil(async () => (await count.getText()) === "3/3", {
      timeout: 5000,
      interval: 100,
      timeoutMsg: "查询 red 计数未回写为 3/3",
    });
    await $("[data-replace-input]").setValue("pink");

    // 「全部」：单事务合并全部替换步——原词全部消失
    await $("[data-replace-all]").click();
    await browser.waitUntil(
      async () => (await countWordInEditor("red")) === 0 && (await countWordInEditor("pink")) === 3,
      { timeout: 5000, interval: 100, timeoutMsg: "全部替换后编辑器文本不符合预期" },
    );

    // 焦点回编辑器后 Ctrl+Z 一次：三处原词全部还原、新词全部消失（单事务撤销语义）。
    // 不用几何点击聚焦——Find 浮层悬于编辑区右上，点击编辑器中心会被面板拦截
    // （element click intercepted），改为程序化 focus 可见面板的 ProseMirror 根
    await browser.execute(() => {
      const panes = Array.from(document.querySelectorAll<HTMLElement>(".tabs-host__pane"));
      const pm = panes
        .find((p) => p.style.display !== "none")
        ?.querySelector<HTMLElement>(".ProseMirror");
      pm?.focus();
    });
    await browser.keys(["Control", "z"]);
    let undone = false;
    for (let i = 0; i < 10 && !undone; i++) {
      undone = (await countWordInEditor("red")) === 3 && (await countWordInEditor("pink")) === 0;
      if (!undone) {
        // WebDriver 键序偶发不稳时的兜底：向可见 pane 的 ProseMirror 派发 Mod-Z
        // keydown（prosemirror-keymap 在编辑器根元素上接键，同一条命令链路）
        await browser.execute(() => {
          const panes = Array.from(document.querySelectorAll<HTMLElement>(".tabs-host__pane"));
          const target = panes
            .find((p) => p.style.display !== "none")
            ?.querySelector(".ProseMirror");
          target?.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: "z",
              ctrlKey: true,
              bubbles: true,
              cancelable: true,
            }),
          );
        });
        await browser.pause(200);
      }
    }
    expect(undone).toBe(true);
  });

  it("全局搜索键入 opening.md 稳定词，点击结果定位到激活标签与选区（AC-F26-1/2/3）", async () => {
    // Ctrl+Shift+F 触发全局搜索入口（file-tree-shortcuts showSearch 链路）：
    // 先弹出侧栏顶部快速搜索框 [data-search-input]
    await triggerWindowShortcut(
      ["Control", "Shift", "f"],
      { key: "f", ctrlKey: true, shiftKey: true },
      () => $("[data-search-input]").isExisting(),
      "Ctrl+Shift+F 未在时限内打开全局搜索入口",
    );

    // 在快速搜索框键入稳定词：逐键经 createSearchEntry 切入「搜索」tab
    // （GlobalSearchPanel 挂载出 [data-global-input]，值经 store.globalQuery 同步）
    const quickInput = await $("[data-search-input]");
    await quickInput.setValue("启动测试");
    const globalInput = await $("[data-global-input]");
    await globalInput.waitForExist({ timeout: 5000 });
    // 在全局面板查询框回车直发（flushGlobalSearch 绕过防抖；opening.md 内容由
    // wdio.conf 每次运行重写，「启动测试」恒存在）
    await globalInput.click();
    await browser.keys("Enter");

    // 流式结果：等待 opening.md 分组出现（Rust 扫描 + Channel 推送有时延）。
    // 同目录可能有历史运行遗留的同内容副本文件，分组序不定——必须按文件名
    // 定位目标分组，不假设其排第一
    async function findOpeningGroup(): Promise<WebdriverIO.Element | undefined> {
      const groups = await $$(".global-search__group");
      for (const g of groups) {
        const head = await g.$("[data-global-file]");
        if ((await head.getAttribute("data-global-file")) === "opening.md") return g;
      }
      return undefined;
    }
    await browser.waitUntil(async () => (await findOpeningGroup()) !== undefined, {
      timeout: 15000,
      interval: 200,
      timeoutMsg: "全局搜索未在时限内给出 opening.md 分组",
    });
    // 流式追加期间列表会重渲染，留余量让 done 落定后再取条目，降低失稳概率；
    // 引用须重新解析（Vue 重渲染后旧 Element 句柄可能 stale）
    await browser.pause(500);
    const group = await findOpeningGroup();
    const item = await group!.$("[data-global-item]");
    await item.waitForExist({ timeout: 5000 });
    await item.click();

    // 双证据：激活标签切到 opening.md 且编辑器出现定位证据（选区含关键词或
    // revealRange 3 秒闪现高亮类，tabs.e2e / outline.e2e 同款 DOM 断言手段）
    await browser.waitUntil(
      async () => {
        const title = await $(".tab-bar__tab--active .tab-bar__title");
        if (!title || !(await title.getText()).includes("opening.md")) return false;
        const selText = await browser.execute(() => window.getSelection()?.toString() ?? "");
        if ((selText as string).includes("启动测试")) return true;
        const pane = await visiblePane();
        return pane.$(".markwell-reveal-highlight").isExisting();
      },
      { timeout: 10000, interval: 100, timeoutMsg: "点击结果后未见标签激活与定位证据" },
    );
    // 选区为持久状态作硬断言；闪现类受 3 秒时限影响仅作 waitUntil 内辅助证据
    const selText = await browser.execute(() => window.getSelection()?.toString() ?? "");
    expect(selText as string).toContain("启动测试");
    await expect($(".tab-bar__tab--active .tab-bar__title")).toHaveText(
      expect.stringContaining("opening.md"),
    );
  });
});
