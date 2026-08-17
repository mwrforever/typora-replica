import { $, $$, browser, expect } from "@wdio/globals";
import { writeFileSync } from "node:fs";
import path from "node:path";

/**
 * 多标签 E2E（04 模块，AC-F29/C2 进程级验证）
 *
 * 前置：wdio.conf 以 --reopen-file=e2e/.fixtures/opening.md 启动（启动即 1 个标签），
 * 侧栏目录 = fixture 父目录（F1-2 父目录加载），文件树由 watch 事件自动刷新
 * （300ms 防抖 + 重扫，见 file-tree.e2e.ts 惯例），before 预写 fixture 后留余量。
 * 覆盖：打开两文件生成两标签 + Ctrl+Tab 轮换（AC-F29-3）、脏标签关闭三按钮确认
 * + 不保存后 Ctrl+Shift+T 重开恢复（AC-C2/AC-F29-5/6）、超限回收与快照重建
 * （AC-F29-7，17 文件打开触发两轮回收）。
 */
describe("04 多标签", () => {
  // 幂等预置：second.md + 回收场景 17 个 fixture（树由 watch 自动刷新；
  // 残留标签不跨运行——每次运行 tauri-driver 重新拉起应用，状态全新）
  before(async () => {
    const fixtureDir = path.join(process.cwd(), "e2e/.fixtures");
    writeFileSync(path.join(fixtureDir, "second.md"), "# 第二个文件\n\nsecond 内容。\n", "utf8");
    for (let i = 1; i <= 17; i++) {
      const n = String(i).padStart(2, "0");
      writeFileSync(path.join(fixtureDir, `recycle-${n}.md`), `# 回收${n}\n\n内容${i}\n`, "utf8");
    }
    // watch 事件触发刷新（300ms 防抖 + 重扫），等余量后再断言
    await browser.pause(1200);
  });

  /**
   * 经文件树点击打开文件，并等待其成为最后一个标签。
   * 打开链路含异步读文件（session.openFile）与内容就绪判定，标签先入簿记、
   * 挂载在后——以「最后标签标题命中」为完成信号，足够支撑下一轮点击。
   * @param name 文件名（fixture 目录内，树节点文本含该名）
   */
  async function openFileViaTree(name: string): Promise<void> {
    // 部分文本选择器须挂在元素上（file-tree.e2e 同款）：wdio v9 的 `*=text`
    // 语法不能与后代组合器联用（`.file-tree .x*=` 会报 invalid selector）
    const tree = await $(".file-tree");
    const item = await tree.$(`.file-tree-item--file*=${name}`);
    await item.waitForExist({ timeout: 10000 });
    await item.click();
    await browser.waitUntil(
      async () => {
        const tabs = await $$(".tab-bar__tab");
        const last = tabs[tabs.length - 1];
        if (!last) return false;
        return (await last.$(".tab-bar__title").getText()).includes(name);
      },
      { timeout: 15000, timeoutMsg: `标签 ${name} 未在时限内打开` },
    );
    // 打开动作自身触发侧栏 loadDir 重扫（树节点重渲染），下一轮点击前留余量
    await browser.pause(300);
  }

  /**
   * 取当前可见（激活）的编辑器宿主 pane。
   * TabHost 以 v-show 保活全部标签，隐藏 pane 仍在 DOM——必须按显示态定位，
   * 直接取第一个会命中不可见的旧标签编辑器（点击/断言都会落到错误实例）。
   */
  async function visiblePane() {
    const panes = await $$(".tabs-host__pane");
    for (const pane of panes) {
      if (await pane.isDisplayed()) return pane;
    }
    throw new Error("未找到可见编辑器宿主");
  }

  /** 在激活编辑器内追加一段文本（点击编辑区获得焦点 + 键盘输入，smoke 同款定位） */
  async function typeIntoActiveEditor(text: string): Promise<void> {
    const pane = await visiblePane();
    const editor = await pane.$(".milkdown .ProseMirror");
    await editor.click();
    await browser.keys(["End", "Enter", text]);
  }

  it("打开两个文件生成两个标签，Ctrl+Tab 轮换激活（AC-F29-3）", async () => {
    // 启动标签（--reopen-file=opening.md）恒存在
    const tabs = await $$(".tab-bar__tab");
    await expect(tabs).toBeElementsArrayOfSize(1);
    await expect(tabs[0]).toHaveText(expect.stringContaining("opening.md"));

    // 文件树点击打开 second.md → 第 2 个标签且处于激活态
    await openFileViaTree("second.md");
    await expect($$(".tab-bar__tab")).toBeElementsArrayOfSize(2);
    await expect($(".tab-bar__tab--active .tab-bar__title")).toHaveText(
      expect.stringContaining("second.md"),
    );

    // Ctrl+Tab 正向轮换：second.md → opening.md；再按一次回绕 → second.md
    await browser.keys(["Control", "Tab"]);
    await expect($(".tab-bar__tab--active .tab-bar__title")).toHaveText(
      expect.stringContaining("opening.md"),
    );
    await browser.keys(["Control", "Tab"]);
    await expect($(".tab-bar__tab--active .tab-bar__title")).toHaveText(
      expect.stringContaining("second.md"),
    );
  });

  it("脏标签关闭弹三按钮确认，选不保存后 Ctrl+Shift+T 可重开恢复（AC-C2/AC-F29-5/6）", async () => {
    // 编辑输入 → 脏标记出现（markdownUpdated 事件桥 500ms → store.markDirty）。
    // 窗口 ~1s：自动保存停笔防抖后写盘会清脏——以脏标记出现为信号立即 Ctrl+W
    await typeIntoActiveEditor("脏标签E2E内容");
    const dirtyTab = await $(".tab-bar__tab--dirty");
    await dirtyTab.waitForExist({ timeout: 5000, interval: 100 });

    // Ctrl+W → C2 三按钮确认弹窗（AC-C2-1）
    await browser.keys(["Control", "w"]);
    const dialog = await $(".confirm-close");
    await dialog.waitForExist({ timeout: 5000 });
    await expect(dialog).toBeDisplayed();
    await expect(dialog.$(".confirm-close__message")).toHaveText(
      expect.stringContaining("second.md 有未保存的更改"),
    );
    const buttons = await dialog.$$(".confirm-close__actions button");
    await expect(buttons).toBeElementsArrayOfSize(3);
    await expect(buttons[0]).toHaveText("保存");
    await expect(buttons[1]).toHaveText("不保存");
    await expect(buttons[2]).toHaveText("取消");

    // 选「不保存」→ 弹窗关闭、标签关闭（剩启动标签；重开栈存关闭前内容——D4）
    await dialog.$("button*=不保存").click();
    await dialog.waitForExist({ reverse: true, timeout: 5000 });
    await expect($$(".tab-bar__tab")).toBeElementsArrayOfSize(1);

    // Ctrl+Shift+T LIFO 重开：标签回归激活态且内容恢复关闭前快照
    await browser.keys(["Control", "Shift", "t"]);
    await expect($$(".tab-bar__tab")).toBeElementsArrayOfSize(2);
    await expect($(".tab-bar__tab--active .tab-bar__title")).toHaveText(
      expect.stringContaining("second.md"),
    );
    const pane = await visiblePane();
    await expect(pane.$(".milkdown")).toHaveText(expect.stringContaining("脏标签E2E内容"));
  });

  it("超过 16 个标签时最久未激活被回收，重新激活内容重建（AC-F29-7）", async () => {
    // 收敛到单个干净标签（脏标签经 C2 弹窗「不保存」关闭；末标签关闭自动新建 Untitled）
    for (let guard = 0; guard < 20 && (await $$(".tab-bar__tab")).length > 1; guard++) {
      await browser.keys(["Control", "w"]);
      const dialog = await $(".confirm-close");
      if (await dialog.isExisting()) {
        await dialog.$("button*=不保存").click();
        await dialog.waitForExist({ reverse: true, timeout: 5000 });
      }
      await browser.pause(400);
    }
    await expect($$(".tab-bar__tab")).toBeElementsArrayOfSize(1);

    // 连续打开 17 个文件 → 18 标签：第 16 个打开（总量 17 > MAX_TABS=16）回收
    // 最久未激活者（收敛后剩余标签），第 17 个打开再回收最早打开的文件标签
    for (let i = 1; i <= 17; i++) {
      await openFileViaTree(`recycle-${String(i).padStart(2, "0")}.md`);
    }
    await expect($$(".tab-bar__tab")).toBeElementsArrayOfSize(18);

    // 回收断言：被回收标签的编辑器宿主 v-if 卸载（pane 仍在 DOM，内部无编辑器），
    // 挂载中的编辑器总数 = 18 标签 - 2 已回收 = 16
    const panes = await $$(".tabs-host__pane");
    await expect(panes).toBeElementsArrayOfSize(18);
    await expect(panes[0].$(".markwell-editor")).not.toExist();
    await expect(panes[1].$(".markwell-editor")).not.toExist();
    await expect($$(".markwell-editor")).toBeElementsArrayOfSize(16);

    // 重新激活最早打开的文件标签（树中点击，去重命中已回收标签 → 回收标记解除
    // → 内容快照重建挂载）。此路径不新建标签，不能复用 openFileViaTree 的
    // 「最后标签」判定——直接等待该 pane 挂出编辑器
    const tree = await $(".file-tree");
    const item = await tree.$(`.file-tree-item--file*=recycle-01.md`);
    await item.waitForExist({ timeout: 10000 });
    await item.click();
    await browser.waitUntil(
      async () => {
        const panesAfter = await $$(".tabs-host__pane");
        return panesAfter[1] && (await panesAfter[1].$(".markwell-editor").isExisting());
      },
      { timeout: 15000, timeoutMsg: "recycle-01 未在时限内重建挂载" },
    );
    await expect($(".tab-bar__tab--active .tab-bar__title")).toHaveText(
      expect.stringContaining("recycle-01.md"),
    );
    // 内容重建正确性：快照序列化往返后 h1 仍为文件原文标题；启动标签仍保持回收态
    await expect($$(".markwell-editor")).toBeElementsArrayOfSize(17);
    const panesAfter = await $$(".tabs-host__pane");
    await expect(panesAfter[1].$(".milkdown h1")).toHaveText("回收01");
  });
});
