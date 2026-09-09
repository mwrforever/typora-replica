// 状态栏数据装配用例（11 P1）：docUpdated/selectionUpdated 双通道 + 活动标签绑定（AC-S3-7）
//
// mock/构造模式沿 OutlinePanel.spec（vi.hoisted 共享桩状态规避 TDZ；手动投递模拟事件桥）。
// 多标签语义依据（已核实，见计划「editorManager 多标签语义核实结论」）：门面事件恒来自
// 激活标签（adopt 重绑事件桥 + 晚挂号快照广播），本用例另钉 watch activeTabId 主动拉取
// 兜底通道（adopt 广播被跳过窗口期的补齐路径，useOutlineData 同模式）。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { nextTick } from "vue";

const h = vi.hoisted(() => ({
  /** 装配层注册的 docUpdated 订阅回调（用例内手动投递模拟事件桥） */
  docCbs: [] as Array<(doc: unknown) => void>,
  /** 装配层注册的 selectionUpdated 订阅回调 */
  selCbs: [] as Array<(sel: unknown) => void>,
  /** getView() 返回值（按用例注入视图桩；undefined = 门面空态） */
  view: undefined as unknown,
}));

vi.mock("../editor/editor-manager", () => ({
  editorManager: {
    getView: (): unknown => h.view,
    subscribeDocUpdated: (cb: (doc: unknown) => void) => {
      h.docCbs.push(cb);
      return () => {
        const i = h.docCbs.indexOf(cb);
        if (i >= 0) h.docCbs.splice(i, 1);
      };
    },
    subscribeSelectionUpdated: (cb: (sel: unknown) => void) => {
      h.selCbs.push(cb);
      return () => {
        const i = h.selCbs.indexOf(cb);
        if (i >= 0) h.selCbs.splice(i, 1);
      };
    },
  },
}));

import { useStatusBarData } from "./use-status-bar-data";
import { useStatusBarStore } from "./status-bar-store";
import { useTabsStore } from "../tabs/tabs-store";
import type { CountableDoc, CountableNode } from "../../utils/word-count";

/** 文本节点构造（同 word-count.spec 桩） */
function textNode(t: string): CountableNode {
  return { isText: true, type: { name: "text" }, text: t };
}

/** 块节点构造 */
function blockNode(name: string): CountableNode {
  return { isText: false, type: { name }, text: undefined };
}

interface DocEntry {
  pos: number;
  size: number;
  node: CountableNode;
}

/** 最小文档桩（word-count.spec makeDoc 同构） */
function makeDoc(entries: DocEntry[]): CountableDoc {
  return {
    descendants(cb): void {
      for (const e of entries) cb(e.node, e.pos);
    },
    nodesBetween(from, to, cb): void {
      for (const e of entries) {
        if (e.pos + e.size > from && e.pos < to) cb(e.node, e.pos);
      }
    },
  };
}

/** 单段「Hello 世界」文档桩 */
function helloDoc(): CountableDoc {
  return makeDoc([
    { pos: 0, size: 10, node: blockNode("paragraph") },
    { pos: 1, size: 8, node: textNode("Hello 世界") },
  ]);
}

/** 视图桩：state.doc + state.selection（装配层双统计的拉取源） */
function makeView(doc: CountableDoc, from = 0, to = 0): unknown {
  return { state: { doc, selection: { from, to } } };
}

describe("useStatusBarData 统计装配", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    h.docCbs.length = 0;
    h.selCbs.length = 0;
    h.view = undefined;
  });

  it("docUpdated 投递驱动全文统计重算（结构通道，200ms 防抖事件）", () => {
    const { dispose } = useStatusBarData();
    for (const cb of h.docCbs) cb(helloDoc());
    expect(useStatusBarStore().docStats).toEqual({ words: 3, characters: 8, lines: 1 });
    dispose();
  });

  it("selectionUpdated 非空选区按门面当前文档做区间统计（即时通道，doc 不缓存旧引用）", () => {
    // doc 取自 getView() 当前视图（B.3.3 禁缓存旧 state——选区与文档同源拉取）
    h.view = makeView(
      makeDoc([
        { pos: 0, size: 8, node: blockNode("paragraph") },
        { pos: 1, size: 6, node: textNode("abcdef") },
        { pos: 8, size: 8, node: blockNode("paragraph") },
        { pos: 9, size: 6, node: textNode("ghijkl") },
      ]),
    );
    const { dispose } = useStatusBarData();
    for (const cb of h.selCbs) cb({ from: 3, to: 11 });
    expect(useStatusBarStore().selectionStats).toEqual({ words: 2, characters: 6, lines: 2 });
    dispose();
  });

  it("selectionUpdated 光标态清除选区统计", () => {
    const store = useStatusBarStore();
    store.applySelectionStats({ words: 2, characters: 6, lines: 2 }); // 前置有选中
    h.view = makeView(helloDoc());
    const { dispose } = useStatusBarData();
    for (const cb of h.selCbs) cb({ from: 3, to: 3 }); // 光标（from === to）
    expect(store.selectionStats).toBeUndefined();
    dispose();
  });

  it("切换活动标签后从门面拉取新标签文档重算统计（AC-S3-7）", async () => {
    const tabsStore = useTabsStore();
    h.view = makeView(helloDoc());
    const { dispose } = useStatusBarData();
    // 首标签统计已就位
    for (const cb of h.docCbs) cb(helloDoc());
    expect(useStatusBarStore().docStats).toEqual({ words: 3, characters: 8, lines: 1 });
    // 切换标签：门面视图已切新文档（adopt 重绑 + 快照广播）；直接改 state 模拟激活切换
    // （activate 动作要求标签元数据存在，测试只关注 activeTabId 变更触发拉取）
    h.view = makeView(
      makeDoc([
        { pos: 0, size: 8, node: blockNode("paragraph") },
        { pos: 1, size: 6, node: textNode("second") },
      ]),
      1,
      4, // 新标签带选区 "sec"：拉取同时刷新选区统计
    );
    tabsStore.activeTabId = "tab-2";
    await nextTick(); // watch 回调 await nextTick 后拉取
    expect(useStatusBarStore().docStats).toEqual({ words: 1, characters: 6, lines: 1 });
    expect(useStatusBarStore().selectionStats).toEqual({ words: 1, characters: 3, lines: 1 });
    dispose();
  });

  it("门面空态复位全零与无选中且即时通道静默跳过", async () => {
    const store = useStatusBarStore();
    store.applyDocStats({ words: 3, characters: 8, lines: 1 });
    store.applySelectionStats({ words: 1, characters: 3, lines: 1 });
    const { dispose } = useStatusBarData(); // 挂载即拉取：h.view = undefined → 复位
    await nextTick(); // 挂载拉取在 immediate watch 的 nextTick 续延内执行（同标签切换用例）
    expect(store.docStats).toEqual({ words: 0, characters: 0, lines: 0 });
    expect(store.selectionStats).toBeUndefined();
    // 门面空态下事件投递不崩溃、不回写（选区通道空守卫）
    for (const cb of h.docCbs) cb(helloDoc()); // doc 通道正常重算（事件载荷可用）
    for (const cb of h.selCbs) cb({ from: 3, to: 11 }); // 选区通道守卫跳过
    expect(store.selectionStats).toBeUndefined();
    dispose();
  });

  it("编辑器 create 中期（视图已存在但 state 未就绪）到达的选区事件被静默忽略且不抛错——E2E 实证缺陷回修", () => {
    // 缺陷出处（E2E 实证 + 二分定位 5549ee7 挂载起生效）：milkdown listener 插件在
    // Editor.create() 过程中同步触发 selectionUpdated 桥，此时门面 view 已存在但
    // state 尚未构造完，回调读 view.state.doc 抛 TypeError 沿同步栈上抛，炸断 create
    // 整链（编辑器永久停留 OnCreate、门面事件流全死、自动保存不落盘）。
    // 语义：create 中期事件静默忽略——create 完成后 adopt 晚挂号快照广播会补发当前
    // doc/selection，统计不丢失。
    const store = useStatusBarStore();
    // 前置：既有统计已就位（create 中期事件不得破坏前值）
    store.applyDocStats({ words: 3, characters: 8, lines: 1 });
    store.applySelectionStats({ words: 1, characters: 3, lines: 1 });
    // create 中期视图桩：view 已存在但 state 未就绪（复现缺陷的最小形态）
    h.view = { state: undefined };
    const { dispose } = useStatusBarData();
    // 投递不沿同步栈抛错（TypeError 上抛即 create 链断裂的根因路径）
    expect(() => {
      for (const cb of h.selCbs) cb({ from: 3, to: 11 });
    }).not.toThrow();
    // 前值不被中期事件破坏（doc 统计同样不受影响）
    expect(store.selectionStats).toEqual({ words: 1, characters: 3, lines: 1 });
    expect(store.docStats).toEqual({ words: 3, characters: 8, lines: 1 });
    dispose();
  });

  it("启动窗口期（视图存在但 state 未就绪）的挂载拉取静默复位为全零且不抛错——同型缺陷挂载路径回修", async () => {
    // 同型缺陷第二处（8eb5b3c 修了选区回调，本用例钉挂载拉取路径）：应用启动窗口期
    // StatusBar 挂载 → watch immediate → nextTick 续延 → pullFromFacade，该时点可能
    // 早于 Editor.create() 完成——门面 view 已存在但 state 尚未构造完，旧实现读
    // view.state.doc 在 async 续延内抛 TypeError → unhandled rejection，首帧统计
    // 不初始化。语义：与 !view 分支同型复位而非跳过——门面未就绪 = 统计归零待
    // 事件补发（adopt 晚挂号快照广播 / docUpdated 防抖重算）。
    const store = useStatusBarStore();
    // 前置：既有统计已就位（挂载拉取须将其复位，证明拉取链完整走完）
    store.applyDocStats({ words: 3, characters: 8, lines: 1 });
    store.applySelectionStats({ words: 1, characters: 3, lines: 1 });
    // create 中期视图桩：view 已存在但 state 未就绪（复现缺陷的最小形态）
    h.view = { state: undefined };
    const { dispose } = useStatusBarData(); // 挂载即触发 immediate watch → nextTick 续延内拉取
    await nextTick(); // 续延执行完再断言：旧实现此处抛 unhandled rejection、统计停留前值
    // 不抛 unhandled rejection 的行为证据：拉取链走完复位全零与无选中（抛错即停留前值）
    expect(store.docStats).toEqual({ words: 0, characters: 0, lines: 0 });
    expect(store.selectionStats).toBeUndefined();
    dispose();
  });

  it("dispose 成对解除双通道订阅与标签 watch", async () => {
    const tabsStore = useTabsStore();
    h.view = makeView(helloDoc());
    const { dispose } = useStatusBarData();
    expect(h.docCbs).toHaveLength(1);
    expect(h.selCbs).toHaveLength(1);
    dispose();
    expect(h.docCbs).toHaveLength(0);
    expect(h.selCbs).toHaveLength(0);
    // 标签 watch 已停：activeTabId 变更不再触发拉取（门面已切新文档也不回写）
    h.view = makeView(
      makeDoc([
        { pos: 0, size: 8, node: blockNode("paragraph") },
        { pos: 1, size: 6, node: textNode("second") },
      ]),
    );
    tabsStore.activeTabId = "tab-2";
    await nextTick();
    expect(useStatusBarStore().docStats).toEqual({ words: 0, characters: 0, lines: 0 });
  });
});
