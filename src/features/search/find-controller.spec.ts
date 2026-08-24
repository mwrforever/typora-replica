// find-controller 装配层集成用例：真实 editorManager + 真实插件装饰，
// 断言走 DOM 装饰类与 store 计数（不 mock 引擎——装配正确性正是被测对象）。
// 坐标断言一律由查询动态求出或走 textBetween（真实文档段落坐标有 +1 偏移陷阱，
// 不硬编码 pos——search-plugin.spec「甲乙甲」首处为 1..2 的同款口径）
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { SearchQuery } from "prosemirror-search";
import { TextSelection } from "@milkdown/kit/prose/state";
import { destroyTestEditors, makeTestEditor } from "../../test/editor-test-utils";
import { editorManager } from "../editor/editor-manager";
import { useTabsStore } from "../tabs/tabs-store";
import {
  navigateNext,
  navigatePrev,
  replaceAllInView,
  replaceOneInView,
  useFindController,
} from "./find-controller";
import { useSearchStore } from "./search-store";

describe("useFindController", () => {
  let dispose: (() => void) | undefined;

  beforeEach(() => {
    setActivePinia(createPinia());
    vi.useFakeTimers();
  });

  afterEach(async () => {
    dispose?.();
    dispose = undefined;
    // 门面单例收尾（幂等；Editor.destroy 对已销毁实例直接返回，重复销毁安全）
    editorManager.destroy();
    await destroyTestEditors();
    vi.useRealTimers();
  });

  async function openWith(
    query: string,
    doc = "hello world hello",
  ): Promise<ReturnType<typeof useSearchStore>> {
    const store = useSearchStore();
    dispose = useFindController().dispose;
    await editorManager.create(doc);
    await vi.advanceTimersByTimeAsync(500); // create 后事件桥防抖窗口
    store.toggleFind();
    store.setQuery(query);
    await vi.advanceTimersByTimeAsync(300); // 输入 watch → 派发 + 计数防抖
    return store;
  }

  it("打开面板输入关键词：DOM 装饰出现且 matchCount/activeIndex 回写（AC-F24-2）", async () => {
    const store = await openWith("hello");
    expect(store.queryStatus).toBe("ok");
    expect(store.matchCount).toBe(2);
    expect(store.activeIndex).toBe(0);
    const view = editorManager.getView()!;
    expect(view.dom.querySelectorAll(".ProseMirror-search-match")).toHaveLength(2);
  });

  it("改词重算；清词与关面板均清除装饰（重开恢复关键词——AC-F24 会话记忆）", async () => {
    const store = await openWith("hello");
    const view = editorManager.getView()!;
    store.setQuery("world");
    await vi.advanceTimersByTimeAsync(300);
    expect(view.dom.querySelectorAll(".ProseMirror-search-match")).toHaveLength(1);
    store.setQuery("");
    await vi.advanceTimersByTimeAsync(300);
    expect(view.dom.querySelectorAll(".ProseMirror-search-match")).toHaveLength(0);
    store.close();
    expect(store.query).toBe(""); // 本用例清过词，会话记忆断言在 store 层已覆盖
  });

  it("打开态光标置文档尾 navigateNext 回绕跳到第一处；面板关闭后 no-op（AC-F24 F3 不再继续）", async () => {
    const store = await openWith("hello");
    const view = editorManager.getView()!;
    // 期望落点（第一处 hello 的区间）由查询动态求出：findNext 尾回绕向前扫描
    // 必落在文档第一处；若误用 findPrev 则会落到第二处（区间不同），可区分方向
    const expectedFirst = new SearchQuery({ search: "hello" }).findNext(view.state, 0)!;
    // 打开态：光标置文档尾（near 自文末向前回退到最近合法文本位——doc 末位是深度 0
    // 的块边界，直接 create 会产生非法 TextSelection）→ navigateNext 回绕到第一处
    const $end = view.state.doc.resolve(view.state.doc.content.size);
    view.dispatch(view.state.tr.setSelection(TextSelection.near($end, -1)));
    navigateNext();
    expect(view.state.selection.from).toBe(expectedFirst.from);
    expect(view.state.selection.to).toBe(expectedFirst.to);

    store.close();
    const before = view.state.selection.from;
    navigateNext(); // 关闭态 no-op
    expect(view.state.selection.from).toBe(before);
  });

  it("切实例（adopt 快照广播链）后新视图自动重放查询", async () => {
    const store = await openWith("hello");
    // 生产切实例路径 = 集成层新建实例后门面 adopt（adopt 同步补发 doc/selection 快照；
    // 裸 create 路径无事务、事件桥不广播——见 task-4-report 偏差披露①）
    const second = await makeTestEditor("hello again hello again");
    editorManager.adopt(second.crepe);
    const newView = editorManager.getView()!;
    expect(newView.dom.querySelectorAll(".ProseMirror-search-match")).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(300); // 重放后计数回写防抖窗口
    expect(store.matchCount).toBe(2);
  });

  it("非法正则：queryStatus=invalid-regex、无装饰、navigateNext no-op（AC-F25-5）", async () => {
    const store = await openWith("(");
    // 「(」按普通词派发是合法字面查询（Task 2 口径：非法正则仅在 regexp 模式判定），
    // 切正则模式后才进入 invalid-regex 态
    store.toggleOption("regexp");
    await vi.advanceTimersByTimeAsync(300);
    expect(store.queryStatus).toBe("invalid-regex");
    expect(editorManager.getView()!.dom.querySelectorAll(".ProseMirror-search-match")).toHaveLength(
      0,
    );
    const before = editorManager.getView()!.state.selection.from;
    navigateNext();
    expect(editorManager.getView()!.state.selection.from).toBe(before);
  });

  it("navigatePrev 自第二处回退到第一处（Shift+F3 反向导航）", async () => {
    await openWith("hello");
    const view = editorManager.getView()!;
    const q = new SearchQuery({ search: "hello" });
    const first = q.findNext(view.state, 0)!;
    const second = q.findNext(view.state, first.to)!;
    // 光标置于第二处匹配（区间由查询动态求出，规避 +1 偏移硬编码）
    view.dispatch(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, second.from, second.to)),
    );
    navigatePrev();
    expect(view.state.selection.from).toBe(first.from);
    expect(view.state.selection.to).toBe(first.to);
  });

  it("replaceOneInView 两段式：未选中先选中下一处，再次调用原位替换（AC-F25-4）", async () => {
    const store = await openWith("hello");
    const view = editorManager.getView()!;
    store.setReplacement("你好");
    // 替换串经输入 watch 异步重放挂载到插件查询（同 replaceAllInView 用例口径）
    await vi.advanceTimersByTimeAsync(0);
    // 第一段：光标不在匹配上（初始为空选区）→ 仅选中下一处，文档不变
    expect(replaceOneInView()).toBe(true);
    expect(view.state.doc.textBetween(0, view.state.doc.content.size)).toBe("hello world hello");
    const first = new SearchQuery({ search: "hello" }).findNext(view.state, 0)!;
    expect([view.state.selection.from, view.state.selection.to]).toEqual([first.from, first.to]);
    // 第二段：光标恰在匹配上 → 原位替换
    expect(replaceOneInView()).toBe(true);
    expect(view.state.doc.textBetween(0, view.state.doc.content.size)).toBe("你好 world hello");
  });

  it("replaceOneInView 两段式：光标不在匹配上先选中下一处；再点原位替换并前进（AC-F25-4）", async () => {
    const store = await openWith("hello", "hello x hello");
    const view = editorManager.getView()!;
    store.setReplacement("嗨");
    // 替换串经输入 watch 异步重放挂载到插件查询（同既有 replaceOne/replaceAll 用例口径）
    await vi.advanceTimersByTimeAsync(0);
    // 第一击：初始光标（空选区）不在匹配上 → 仅选中第一处，文档不变。
    // 返回值语义同官方 replaceNext「命中即 true」；区间动态求出，规避段落 +1 偏移硬编码
    expect(replaceOneInView()).toBe(true);
    const first = new SearchQuery({ search: "hello" }).findNext(view.state, 0)!;
    expect([view.state.selection.from, view.state.selection.to]).toEqual([first.from, first.to]);
    // 第二击：选中态即匹配 → 原位替换并前进到下一处
    expect(replaceOneInView()).toBe(true);
    expect(view.state.doc.textBetween(0, view.state.doc.content.size)).toContain("嗨 x hello");
    const advanced = new SearchQuery({ search: "hello" }).findNext(view.state, 0)!;
    expect([view.state.selection.from, view.state.selection.to]).toEqual([
      advanced.from,
      advanced.to,
    ]);
  });

  it("标签切换信号（activeTabId 变更）触发查询重放——装饰与计数保持", async () => {
    const store = await openWith("hello");
    const view = editorManager.getView()!;
    useTabsStore().activate("tab-1"); // 无真实多实例：仅驱动重放通道冒烟（真实切换见 adopt 用例）
    await vi.advanceTimersByTimeAsync(300); // nextTick 重放 + 计数防抖窗口
    expect(view.dom.querySelectorAll(".ProseMirror-search-match")).toHaveLength(2);
    expect(store.matchCount).toBe(2);
  });

  it("replaceAllInView 单事务全替 + 计数归零（AC-F25-3 单元口径）", async () => {
    const store = await openWith("hello");
    const view = editorManager.getView()!;
    store.setReplacement("你好");
    // 官方 replaceAll 消费插件内挂载的查询对象，替换串经输入 watch 异步重放生效
    // （真实使用中「全部」点击必然晚于替换串输入），此处等一次微任务刷新对齐时序
    await vi.advanceTimersByTimeAsync(0);
    expect(replaceAllInView()).toBe(true);
    expect(view.state.doc.textBetween(0, view.state.doc.content.size, "\n")).toBe(
      "你好 world 你好",
    );
    await vi.advanceTimersByTimeAsync(300);
    expect(store.matchCount).toBe(0);
  });
});
