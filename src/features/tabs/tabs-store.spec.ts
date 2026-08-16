// tabs-store 标签状态机（04 核心：打开去重/邻位激活/LIFO 重开/LRU 快照/脏流转/末标签新建）
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import { CLOSED_STACK_LIMIT, useTabsStore } from "./tabs-store";

describe("tabsStore 标签状态机", () => {
  beforeEach(() => setActivePinia(createPinia()));
  const store = () => useTabsStore();

  it("openFile 打开新文件：新建标签并激活（AC-F29-2 未开分支）", () => {
    const r = store().openFile("D:\\a\\b.md", "b.md");
    expect(r.created).toBe(true);
    expect(store().tabs).toHaveLength(1);
    expect(store().activeTabId).toBe(r.id);
    expect(store().tabs[0]).toMatchObject({
      kind: "file",
      path: "D:\\a\\b.md",
      title: "b.md",
      dirty: false,
      contentReady: false,
    });
  });

  it("openFile 同路径去重：激活既有标签不新建（AC-F29-2 已开分支）", () => {
    const s = store();
    s.openFile("D:\\a\\b.md", "b.md");
    const r2 = s.openFile("D:\\a\\b.md", "b.md");
    expect(r2.created).toBe(false);
    expect(s.tabs).toHaveLength(1);
    expect(s.activeTabId).toBe(r2.id);
  });

  it("openFile 路径归一化去重：分隔符差异视为同一文件", () => {
    const s = store();
    s.openFile("D:/a/b.md", "b.md");
    const r = s.openFile("D:\\a\\b.md", "b.md");
    expect(r.created).toBe(false);
    expect(s.tabs).toHaveLength(1);
  });

  it("createUntitled：标题递增且激活（AC-F29-1）", () => {
    const s = store();
    s.createUntitled();
    const id2 = s.createUntitled();
    expect(s.tabs.map((t) => t.title)).toEqual(["Untitled 1", "Untitled 2"]);
    expect(s.activeTabId).toBe(id2);
  });

  it("cycle 正向轮换：1→2→3→1（AC-F29-3）", () => {
    const s = store();
    const [a, b, c] = [s.createUntitled(), s.createUntitled(), s.createUntitled()];
    expect(s.activeTabId).toBe(c);
    s.cycle(1);
    expect(s.activeTabId).toBe(a);
    s.cycle(1);
    expect(s.activeTabId).toBe(b);
    s.cycle(1);
    expect(s.activeTabId).toBe(c);
  });

  it("cycle 反向轮换：3→2→1（AC-F29-3）", () => {
    const s = store();
    const [a, b] = [s.createUntitled(), s.createUntitled(), s.createUntitled()];
    s.cycle(-1);
    expect(s.activeTabId).toBe(b);
    s.cycle(-1);
    expect(s.activeTabId).toBe(a);
  });

  it("closeTab 关闭当前标签：激活右邻；无右邻激活左邻（AC-F29-4）", () => {
    const s = store();
    const [a, b, c] = [s.createUntitled(), s.createUntitled(), s.createUntitled()];
    s.activate(b);
    s.closeTab(b, "内容B");
    expect(s.activeTabId).toBe(c); // 右邻
    s.activate(c);
    s.closeTab(c, "内容C");
    expect(s.activeTabId).toBe(a); // 无右邻 → 左邻
  });

  it("closeTab 关闭后台标签：激活标签不变", () => {
    const s = store();
    const [a, b] = [s.createUntitled(), s.createUntitled()];
    s.closeTab(a, "内容A");
    expect(s.activeTabId).toBe(b);
    expect(s.tabs.map((t) => t.id)).toEqual([b]);
  });

  it("closeTab 恒存关闭前内容入重开栈（D4），栈深超限丢最旧（AC-F29-6）", () => {
    const s = store();
    for (let i = 0; i < CLOSED_STACK_LIMIT + 5; i++) {
      const id = s.createUntitled();
      s.closeTab(id, `内容${i}`);
    }
    expect(s.closedStack).toHaveLength(CLOSED_STACK_LIMIT);
    expect(s.closedStack[0].content).toBe("内容5"); // 丢掉了 0-4
    expect(s.closedStack[CLOSED_STACK_LIMIT - 1].content).toBe(`内容${CLOSED_STACK_LIMIT + 4}`);
  });

  it("reopenClosed LIFO：最近关闭先重开，恢复内容与脏状态（AC-F29-5）", () => {
    const s = store();
    const [a] = [s.createUntitled(), s.createUntitled()];
    s.markDirty(a);
    s.closeTab(a, "脏内容A");
    const reopenedId = s.reopenClosed();
    expect(reopenedId).not.toBe(a); // 新 id（自增不复用）
    const reopened = s.tabs.find((t) => t.id === reopenedId)!;
    expect(reopened.contentSnapshot).toBe("脏内容A");
    expect(reopened.dirty).toBe(true); // 关闭时脏 → 重开脏
    expect(s.activeTabId).toBe(reopenedId);
  });

  it("reopenClosed 栈空返回 undefined", () => {
    expect(store().reopenClosed()).toBeUndefined();
  });

  it("关闭最后一个标签自动新建 Untitled（D3/AC-F29-9）", () => {
    const s = store();
    const id = s.createUntitled();
    s.closeTab(id, "内容");
    expect(s.tabs).toHaveLength(1);
    expect(s.tabs[0].kind).toBe("untitled");
    expect(s.activeTabId).toBe(s.tabs[0].id);
  });

  it("脏状态流转：markDirty/markSaved 只影响目标标签（AC-F29-8 簿记）", () => {
    const s = store();
    const [a, b] = [s.createUntitled(), s.createUntitled()];
    s.markDirty(a);
    expect(s.tabs.find((t) => t.id === a)!.dirty).toBe(true);
    expect(s.tabs.find((t) => t.id === b)!.dirty).toBe(false);
    s.markSaved(a);
    expect(s.tabs.find((t) => t.id === a)!.dirty).toBe(false);
  });

  it("快照登记与清除（LRU 回收簿记，AC-F29-7 前置）", () => {
    const s = store();
    const id = s.createUntitled();
    s.setSnapshot(id, "快照内容");
    expect(s.tabs[0].contentSnapshot).toBe("快照内容");
    s.clearSnapshot(id);
    expect(s.tabs[0].contentSnapshot).toBeUndefined();
  });

  it("removeTab 回滚（打开失败路径）：末标签移除后按 D3 新建 Untitled（编辑器常驻无空态）", () => {
    const s = store();
    const id = s.openFile("D:\\a\\bad.md", "bad.md").id;
    s.removeTab(id);
    expect(s.tabs).toHaveLength(1);
    expect(s.tabs[0].kind).toBe("untitled");
    expect(s.activeTabId).toBe(s.tabs[0].id);
  });

  it("removeTab 回滚非末标签：邻位激活、其余标签不变", () => {
    const s = store();
    const [a, b] = [s.createUntitled(), s.createUntitled()];
    s.removeTab(a);
    expect(s.tabs.map((t) => t.id)).toEqual([b]);
    expect(s.activeTabId).toBe(b);
  });

  it("removeTab 回滚激活且非末标签：移除后激活邻位", () => {
    const s = store();
    const [a, b, c] = [s.createUntitled(), s.createUntitled(), s.createUntitled()];
    s.activate(a);
    s.removeTab(a);
    expect(s.tabs.map((t) => t.id)).toEqual([b, c]);
    expect(s.activeTabId).toBe(b);
  });

  it("activeTab getter：返回当前激活标签；空态返回 undefined", () => {
    expect(store().activeTab).toBeUndefined();
    const s = store();
    const id = s.createUntitled();
    expect(s.activeTab?.id).toBe(id);
  });

  it("closeTab/removeTab 不存在的 id：安全忽略、无副作用", () => {
    const s = store();
    const id = s.createUntitled();
    s.closeTab("nope", "内容");
    s.removeTab("nope");
    expect(s.tabs).toHaveLength(1);
    expect(s.tabs[0].id).toBe(id);
    expect(s.closedStack).toHaveLength(0);
  });

  it("cycle 空标签条：安全返回不改变状态", () => {
    const s = store();
    s.cycle(1);
    s.cycle(-1);
    expect(s.activeTabId).toBeUndefined();
  });

  it("markContentReady：标记内容就绪（可挂载编辑器）", () => {
    const s = store();
    s.createUntitled();
    expect(s.tabs[0].contentReady).toBe(true);
    const fileId = s.openFile("D:\\a\\b.md", "b.md").id;
    expect(s.tabs.find((t) => t.id === fileId)!.contentReady).toBe(false);
    s.markContentReady(fileId);
    expect(s.tabs.find((t) => t.id === fileId)!.contentReady).toBe(true);
  });

  it("对不存在的标签执行簿记操作：安全忽略", () => {
    const s = store();
    s.markContentReady("nope");
    s.markDirty("nope");
    s.markSaved("nope");
    s.setSnapshot("nope", "内容");
    s.clearSnapshot("nope");
    expect(s.tabs).toHaveLength(0);
  });
});
