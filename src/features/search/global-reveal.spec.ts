// 点击定位链路用例：editor-manager/reveal-range/search-query 全量 mock，
// tabs 走真实 Pinia store（openFile 同步建档激活，jsdom 无 IO 副作用）
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { createPinia, setActivePinia } from "pinia";

const h = vi.hoisted(() => ({
  revealRange: vi.fn(),
  nthMatch: vi.fn(),
  /** buildSearchQuery 桩返回值（默认恒 ok；用例可整体换桩模拟 invalid-regex 等态） */
  built: { status: "ok", query: { marker: true } } as { status: string; query?: unknown },
  /** getView 注入值（undefined = 门面空态） */
  view: undefined as unknown,
  /** getEditor 注入值 */
  editor: {} as unknown,
  /** 装配层注册的 docUpdated 订阅回调（手动投递模拟 adopt 广播） */
  docCbs: [] as Array<(doc: unknown) => void>,
}));
vi.mock("../editor/reveal-range", () => ({
  revealRange: (...a: unknown[]) => h.revealRange(...a),
}));
vi.mock("../editor/editor-manager", () => ({
  editorManager: {
    getEditor: (): unknown => h.editor,
    getView: (): unknown => h.view,
    subscribeDocUpdated: (cb: (doc: unknown) => void) => {
      h.docCbs.push(cb);
      return () => {
        const i = h.docCbs.indexOf(cb);
        if (i >= 0) h.docCbs.splice(i, 1);
      };
    },
  },
}));
vi.mock("./search-query", () => ({
  // 换桩化：返回 hoisted 容器的 built（默认 ok 形态；非 ok 用例整体覆写）
  buildSearchQuery: () => h.built,
  nthMatch: (...a: unknown[]) => h.nthMatch(...a),
}));
// 实例注册表桩：恒登记目标标签且实例与门面 h.editor 同源——
// 使「门面归属校验」判定通过，聚焦定位链路本身的编排逻辑
vi.mock("../tabs/editor-registry", () => ({
  getInstance: () => ({ crepe: { editor: h.editor } }),
}));

import { revealGlobalMatch } from "./global-reveal";
import { useSearchStore } from "./search-store";
import { useTabsStore } from "../tabs/tabs-store";

/** 最小视图桩（定位链路只经 nthMatch 消费 state、focus 落焦点，桩保持最小） */
function fakeView(): unknown {
  return { state: { doc: {} }, focus: vi.fn() };
}

beforeEach(() => {
  setActivePinia(createPinia());
  h.revealRange.mockClear();
  h.nthMatch.mockReset();
  h.built = { status: "ok", query: { marker: true } };
  h.view = undefined;
  h.editor = {};
  h.docCbs.length = 0;
});
afterEach(() => {
  vi.useRealTimers();
});

describe("revealGlobalMatch 定位链路（序号对齐口径）", () => {
  it("快路径（已激活已就绪）+ 命中：revealRange(editor, from, to, 3000)", async () => {
    vi.useFakeTimers();
    const tabs = useTabsStore();
    const { id } = tabs.openFile("C:/ws/a.md", "a.md"); // 预建标签：去重激活语义
    h.view = fakeView();
    h.nthMatch.mockReturnValue({ from: 10, to: 12 });
    await revealGlobalMatch("C:/ws/a.md", "a.md", 0);
    expect(tabs.activeTabId).toBe(id);
    expect(h.nthMatch).toHaveBeenCalledWith(expect.anything(), expect.anything(), 0);
    expect(h.revealRange).toHaveBeenCalledWith(h.editor, 10, 12, 3000); // AC-F26-2 + D-B 时长
    // 焦点先行：定位前必须落焦视图，否则 PM 不回写 DOM 选区（AC-F26-2 可见面）
    expect((h.view as { focus: Mock }).focus).toHaveBeenCalledTimes(1);
  });

  it("全新标签首挂：视图未就绪时经 adopt 广播完成等待（订阅一次性消费）", async () => {
    vi.useFakeTimers();
    useSearchStore().globalQuery = "目标";
    const pending = revealGlobalMatch("C:/ws/new.md", "new.md", 2);
    expect(h.revealRange).not.toHaveBeenCalled(); // 视图未就绪挂起中
    h.view = fakeView();
    h.nthMatch.mockReturnValue({ from: 5, to: 7 });
    h.docCbs[h.docCbs.length - 1]?.({}); // 模拟 adopt 快照广播
    await pending;
    expect(h.revealRange).toHaveBeenCalledWith(h.editor, 5, 7, 3000);
    expect(h.docCbs).toHaveLength(0); // 一次性订阅已注销
  });

  it("残余①窗口期（广播被跳过）：有限轮询兜底至视图就绪", async () => {
    vi.useFakeTimers();
    useSearchStore().globalQuery = "目标";
    const pending = revealGlobalMatch("C:/ws/fresh.md", "fresh.md", 2);
    h.nthMatch.mockReturnValue({ from: 1, to: 2 });
    await vi.advanceTimersByTimeAsync(50); // 第一拍仍无视图
    expect(h.revealRange).not.toHaveBeenCalled();
    h.view = fakeView();
    await vi.advanceTimersByTimeAsync(50); // 第二拍轮询命中
    await pending;
    expect(h.revealRange).toHaveBeenCalledOnce();
  });

  it("序号越界（文档已变更）：仅激活标签不定位、不抛错（降级披露口径）", async () => {
    vi.useFakeTimers();
    const tabs = useTabsStore();
    tabs.openFile("C:/ws/b.md", "b.md");
    h.view = fakeView();
    h.nthMatch.mockReturnValue(undefined);
    await revealGlobalMatch("C:/ws/b.md", "b.md", 7);
    expect(h.nthMatch).toHaveBeenCalledWith(expect.anything(), expect.anything(), 7);
    expect(h.revealRange).not.toHaveBeenCalled();
  });

  it("查询构建非 ok（invalid-regex）：仅激活标签不定位，nthMatch/revealRange 均不触（降级披露口径）", async () => {
    vi.useFakeTimers();
    const tabs = useTabsStore();
    tabs.openFile("C:/ws/bad.md", "bad.md"); // 预置已激活标签 + 就绪视图：直落状态分支
    h.view = fakeView();
    h.built = { status: "invalid-regex" }; // 换桩：查询构建失败（非法正则态）
    await revealGlobalMatch("C:/ws/bad.md", "bad.md", 0);
    expect(h.nthMatch).not.toHaveBeenCalled(); // 非 ok 不进入匹配取位
    expect(h.revealRange).not.toHaveBeenCalled(); // 仅激活标签不定位
  });

  it("超时未就绪：静默放弃不抛错（标签被切走场景）", async () => {
    vi.useFakeTimers();
    useSearchStore().globalQuery = "目标";
    const pending = revealGlobalMatch("C:/ws/gone.md", "gone.md", 1);
    await vi.advanceTimersByTimeAsync(50 * 45); // 越过 40 次上限
    await pending;
    expect(h.revealRange).not.toHaveBeenCalled();
  });
});
