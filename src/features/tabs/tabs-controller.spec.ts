// tabs-controller 编排控制器（04：每标签会话栈/打开回滚/超限回收/透传编排）
//
// 控制器为模块级单例（useTabsStore 在模块求值期调用）→ 本文件必须在 active
// Pinia 就绪后动态 import；用例间隔离：store.$reset + initialDocs/recycledIds
// 清空 + clearRegistryForTest（单例状态不随 resetModules 重建，逐项清理）。
// DocumentSession/AutoSaveController/editorManager 真实构造（不 mock 进本体），
// 仅 mock 服务层（file-io/settings/recent-files）与 fake crepe（adopt 需 on 桩）。
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Crepe } from "@milkdown/crepe";
import type { TabsController } from "./tabs-controller";
import { MAX_TABS } from "./tabs-store";

const mockReadFile = vi.fn();
const mockWriteFile = vi.fn();
const mockLoadSettings = vi.fn();
const mockUpdateSettings = vi.fn();
const mockRecord = vi.fn();

vi.mock("../../services/file-io", () => ({
  // FileIoError 必须同构导出（document-session 的 catch 用 instanceof 判定）
  FileIoError: class FileIoError extends Error {},
  readFile: (...a: unknown[]) => mockReadFile(...a),
  writeFile: (...a: unknown[]) => mockWriteFile(...a),
}));
vi.mock("../../services/settings", () => ({
  loadSettings: (...a: unknown[]) => mockLoadSettings(...a),
  updateSettings: (...a: unknown[]) => mockUpdateSettings(...a),
}));
vi.mock("../../services/recent-files", () => ({
  // 同构导出 RecentFiles 类：record 委托 mock（document-session 用 new + .catch 消费）
  RecentFiles: class {
    record = (...a: unknown[]) => mockRecord(...a);
  },
}));
// 展开原模块成可写命名空间：使 maybeRecycle 防御分支（victim 实例缺失）可经
// vi.spyOn 注入幽灵 id 触发（生产路径不可达——victimId 恒出自同一实例表迭代）
vi.mock("./editor-registry", async (importOriginal) => {
  const mod = await importOriginal<typeof import("./editor-registry")>();
  return { ...mod };
});

/** fake crepe：adopt 经 setupEditorEvents 调 crepe.on；getMarkdownFor 调 getMarkdown */
function fakeCrepe(markdown = "正文"): Crepe {
  return { on: vi.fn(), getMarkdown: () => markdown } as unknown as Crepe;
}

/** 本测试激活过 autoSave 的标签（afterEach 停订清理 5 分钟兜底定时器） */
const startedAutoSaveIds: string[] = [];

let controller: TabsController;
let registry: typeof import("./editor-registry");

describe("tabsController 编排控制器", () => {
  beforeAll(async () => {
    setActivePinia(createPinia());
    // 单例在模块求值期调用 useTabsStore → 必须先有 active Pinia 再 import
    controller = (await import("./tabs-controller")).useTabsController();
    registry = await import("./editor-registry");
  });

  beforeEach(() => {
    // 单例状态逐项清理（不 resetModules：动态 import 缓存同一模块实例）
    controller.store.$reset();
    controller.initialDocs.clear();
    controller.recycledIds.clear();
    registry.clearRegistryForTest();
    mockReadFile.mockReset();
    mockWriteFile.mockReset();
    mockLoadSettings.mockReset().mockResolvedValue({
      autoSave: { enabled: true, timerMinutes: 5 },
      defaultLineEnding: "lf",
      launch: {},
    });
    mockUpdateSettings.mockReset().mockResolvedValue({});
    mockRecord.mockReset().mockResolvedValue(undefined);
    // 静默会话通知（onNotice 桥接 console，避免测试输出噪音）
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
  });

  afterEach(() => {
    for (const id of startedAutoSaveIds) registry.getInstance(id)?.autoSave.stop();
    startedAutoSaveIds.length = 0;
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("openFile 成功：读入内容入 initialDocs、标记就绪并激活（created=true）", async () => {
    mockReadFile.mockResolvedValueOnce({ content: "你好", encoding: "utf8", lineEnding: "lf" });
    const created = await controller.openFile("C:/docs/a.md", "a.md");
    expect(created).toBe(true);
    const id = controller.store.activeTabId!;
    expect(controller.store.tabs).toHaveLength(1);
    expect(controller.store.tabs[0]).toMatchObject({ kind: "file", contentReady: true });
    expect(controller.initialDocs.get(id)).toBe("你好");
  });

  it("openFile 同路径去重：激活既有标签不重复读入（created=false）", async () => {
    mockReadFile.mockResolvedValue({ content: "内容", encoding: "utf8", lineEnding: "lf" });
    expect(await controller.openFile("D:\\a\\b.md", "b.md")).toBe(true);
    expect(await controller.openFile("D:/a/b.md", "b.md")).toBe(false);
    expect(controller.store.tabs).toHaveLength(1);
  });

  it("openFile 读取失败：回滚挂起标签（末标签场景按 D3 新建 Untitled）", async () => {
    // 会话 openFile 失败仅 notify 不广播 → initialDocs 无该 id → 控制器回滚
    mockReadFile.mockRejectedValueOnce(
      Object.assign(new Error("读取失败"), { name: "FileIoError" }),
    );
    expect(await controller.openFile("C:/bad.md", "bad.md")).toBe(false);
    // 回滚：挂起标签移除 → 末标签按 D3 新建 Untitled（无空态）
    expect(controller.store.tabs).toHaveLength(1);
    expect(controller.store.tabs[0].kind).toBe("untitled");
    expect(controller.initialDocs.size).toBe(0);
  });

  it("openFile 读取失败：回滚不影响既有标签（非末标签邻位激活）", async () => {
    mockReadFile.mockResolvedValueOnce({ content: "已有", encoding: "utf8", lineEnding: "lf" });
    expect(await controller.openFile("C:/a/ok.md", "ok.md")).toBe(true);
    const keepId = controller.store.activeTabId!;
    mockReadFile.mockRejectedValueOnce(
      Object.assign(new Error("读取失败"), { name: "FileIoError" }),
    );
    expect(await controller.openFile("C:/a/bad.md", "bad.md")).toBe(false);
    expect(controller.store.tabs).toHaveLength(1);
    expect(controller.store.activeTabId).toBe(keepId);
  });

  it("createUntitled：内容空串就绪并激活", () => {
    controller.createUntitled();
    const id = controller.store.activeTabId!;
    expect(controller.store.tabs).toHaveLength(1);
    expect(controller.store.tabs[0].kind).toBe("untitled");
    expect(controller.store.tabs[0].contentReady).toBe(true);
    expect(controller.initialDocs.get(id)).toBe("");
  });

  it("onInstanceReady：登记实例 + 清快照 + 激活门面（激活标签的会话可及）", async () => {
    mockReadFile.mockResolvedValue({ content: "内容", encoding: "utf8", lineEnding: "lf" });
    await controller.openFile("C:/a/b.md", "b.md");
    const id = controller.store.activeTabId!;
    controller.store.setSnapshot(id, "旧快照"); // 挂载完成前残留快照 → 挂载即清除
    expect(controller.activeSession()).toBeUndefined();
    controller.onInstanceReady(id, { crepe: fakeCrepe("编辑器正文"), frontMatter: null });
    const inst = registry.getInstance(id);
    expect(inst).toBeDefined();
    expect(controller.store.tabs[0].contentSnapshot).toBeUndefined(); // clearSnapshot
    expect(controller.activeSession()).toBe(inst!.session); // 激活 → 门面会话可及
    startedAutoSaveIds.push(id); // 激活即 start（afterEach 停订）
  });

  it("onInstanceReady 非激活标签：登记但不激活门面；未知 tabId 安全忽略", async () => {
    mockReadFile.mockResolvedValue({ content: "A", encoding: "utf8", lineEnding: "lf" });
    await controller.openFile("C:/a/a.md", "a.md");
    const aId = controller.store.activeTabId!;
    await controller.openFile("C:/a/b.md", "b.md"); // activeTabId = b
    controller.onInstanceReady(aId, { crepe: fakeCrepe(), frontMatter: null });
    expect(registry.getInstance(aId)).toBeDefined();
    expect(controller.activeSession()).toBeUndefined(); // a 非激活 → 不 adopt
    controller.onInstanceReady("nope", { crepe: fakeCrepe(), frontMatter: null });
    expect(registry.getInstance("nope")).toBeUndefined();
  });

  it("activate：store 透传 + 回收标记解除（重建触发）", () => {
    controller.createUntitled();
    const id = controller.store.activeTabId!;
    controller.recycledIds.add(id); // 模拟 LRU 回收后激活
    controller.activate(id);
    expect(controller.store.activeTabId).toBe(id);
    expect(controller.recycledIds.has(id)).toBe(false); // 标记解除
    // 无标记的标签激活：仅透传无副作用
    controller.createUntitled();
    const id2 = controller.store.activeTabId!;
    controller.activate(id2);
    expect(controller.store.activeTabId).toBe(id2);
    expect(controller.recycledIds.size).toBe(0);
  });

  it("closeTab：已挂载标签按实例序列化入重开栈并注销实例", async () => {
    mockReadFile.mockResolvedValue({ content: "内容", encoding: "utf8", lineEnding: "lf" });
    await controller.openFile("C:/a/a.md", "a.md");
    const aId = controller.store.activeTabId!;
    controller.onInstanceReady(aId, { crepe: fakeCrepe("内容A"), frontMatter: null });
    await controller.openFile("C:/a/b.md", "b.md"); // 激活 b，a 转后台
    controller.closeTab(aId);
    expect(controller.store.closedStack[0].content).toBe("内容A"); // getMarkdownFor 序列化
    expect(controller.store.tabs.map((t) => t.id)).toEqual([controller.store.activeTabId]);
    expect(registry.getInstance(aId)).toBeUndefined(); // 注销实例
  });

  it("closeTab：未挂载标签取快照；无快照取空串；未知 id 安全忽略", () => {
    controller.createUntitled(); // tab1 未挂载
    const aId = controller.store.activeTabId!;
    controller.createUntitled(); // tab2（激活）
    controller.store.setSnapshot(aId, "快照内容");
    controller.closeTab(aId);
    expect(controller.store.closedStack[0].content).toBe("快照内容");
    // 未挂载且无快照 → 空串（关闭末标签后 D3 自动新建 Untitled，不出现空态）
    controller.closeTab(controller.store.activeTabId!);
    expect(controller.store.closedStack[1].content).toBe("");
    // 未知 id：无副作用
    controller.closeTab("nope");
    expect(controller.store.tabs).toHaveLength(1); // D3 自动新建的 Untitled
    expect(controller.store.closedStack).toHaveLength(2);
  });

  it("reopenClosed：恢复关闭前内容快照入 initialDocs（新 id 重挂载）", () => {
    controller.createUntitled();
    const aId = controller.store.activeTabId!;
    controller.onInstanceReady(aId, { crepe: fakeCrepe("脏内容"), frontMatter: null });
    controller.closeTab(aId); // 激活标签关闭 → 按 D3 新建 Untitled
    controller.reopenClosed();
    const reopened = controller.store.tabs.find((t) => t.id !== controller.store.tabs[0].id)!;
    expect(reopened).toBeDefined();
    expect(controller.initialDocs.get(reopened.id)).toBe("脏内容");
  });

  it("reopenClosed：空串快照不写 initialDocs（空文档重开）；栈空安全返回", () => {
    controller.createUntitled();
    const aId = controller.store.activeTabId!;
    controller.closeTab(aId); // 未挂载无快照 → 空串入栈；D3 自动新建 Untitled 2
    controller.reopenClosed();
    const reopenedId = controller.store.activeTabId!;
    expect(controller.initialDocs.has(reopenedId)).toBe(false);
    controller.reopenClosed(); // 栈空：安全返回（标签不变）
    expect(controller.store.tabs).toHaveLength(2);
  });

  it("cycle：簿记轮换透传（Ctrl+Tab 语义）", () => {
    controller.createUntitled();
    controller.createUntitled();
    const [a, b] = controller.store.tabs.map((t) => t.id);
    expect(controller.store.activeTabId).toBe(b);
    controller.cycle(1);
    expect(controller.store.activeTabId).toBe(a);
    controller.cycle(-1);
    expect(controller.store.activeTabId).toBe(b);
  });

  it("超限回收：第 MAX_TABS+1 个标签回收最久未激活（快照登记 + 注销 + 标记）", async () => {
    vi.useFakeTimers();
    const contentById = new Map<string, string>();
    const ids: string[] = [];
    for (let i = 0; i < MAX_TABS; i++) {
      const content = `内容${i}`;
      contentById.set(`C:/a/${i}.md`, content);
      mockReadFile.mockResolvedValueOnce({ content, encoding: "utf8", lineEnding: "lf" });
      expect(await controller.openFile(`C:/a/${i}.md`, `${i}.md`)).toBe(true);
      ids.push(controller.store.activeTabId!);
    }
    // 依次挂载并推进时间：lastActivatedAt 递增 → 最久未激活 = 第一个挂载的
    for (let i = 0; i < ids.length; i++) {
      vi.advanceTimersByTime(1000);
      controller.onInstanceReady(ids[i], {
        crepe: fakeCrepe(contentById.get(`C:/a/${i}.md`)!),
        frontMatter: null,
      });
    }
    const victimId = ids[0];
    mockReadFile.mockResolvedValueOnce({ content: "新内容", encoding: "utf8", lineEnding: "lf" });
    expect(await controller.openFile("C:/a/new.md", "new.md")).toBe(true);
    expect(controller.store.tabs).toHaveLength(MAX_TABS + 1);
    const newId = controller.store.activeTabId!;
    expect(newId).not.toBe(victimId);
    expect(controller.recycledIds.has(victimId)).toBe(true); // 回收标记（TabHost 卸载重建）
    expect(controller.store.tabs.find((t) => t.id === victimId)!.contentSnapshot).toBe("内容0");
    expect(registry.getInstance(victimId)).toBeUndefined(); // 注销实例
    expect(controller.store.tabs.find((t) => t.id === newId)?.contentSnapshot).toBeUndefined(); // 新标签不受影响
  });

  it("超限但无存活实例：不回收（无 victim 安全返回）", async () => {
    for (let i = 0; i < MAX_TABS + 1; i++) {
      mockReadFile.mockResolvedValueOnce({ content: "x", encoding: "utf8", lineEnding: "lf" });
      expect(await controller.openFile(`C:/a/${i}.md`, `${i}.md`)).toBe(true);
    }
    expect(controller.store.tabs).toHaveLength(MAX_TABS + 1);
    expect(controller.recycledIds.size).toBe(0); // 无实例 → 无回收
  });

  it("超限回收：victim 实例缺失时跳过快照、仍注销并登记回收（防御分支）", async () => {
    // 生产路径下 victimId 恒出自实例表迭代（实例必存在）；本用例经 spy 注入
    // 幽灵 id 覆盖防御分支：不写快照但回收流程（注销/登记）不中断
    const spy = vi.spyOn(registry, "recycleLeastRecent").mockReturnValueOnce("ghost-id");
    for (let i = 0; i < MAX_TABS + 1; i++) {
      mockReadFile.mockResolvedValueOnce({ content: "x", encoding: "utf8", lineEnding: "lf" });
      expect(await controller.openFile(`C:/a/${i}.md`, `${i}.md`)).toBe(true);
    }
    expect(controller.recycledIds.has("ghost-id")).toBe(true);
    expect(controller.store.tabs.some((t) => t.contentSnapshot !== undefined)).toBe(false); // 无快照写入
    spy.mockRestore();
  });

  it("getContext：挂载取实例序列化；未挂载取快照/initialDoc/空串；未知 id undefined", async () => {
    expect(controller.getContext("nope")).toBeUndefined();
    // 未挂载：initialDocs 内容（openFile 成功路径）
    mockReadFile.mockResolvedValueOnce({ content: "文件内容", encoding: "utf8", lineEnding: "lf" });
    await controller.openFile("C:/a/b.md", "b.md");
    const id = controller.store.activeTabId!;
    expect(controller.getContext(id)!.serialize()).toBe("文件内容");
    // 挂载：按实例序列化（getMarkdownFor）
    controller.onInstanceReady(id, { crepe: fakeCrepe("编辑器内容"), frontMatter: null });
    expect(controller.getContext(id)!.serialize()).toBe("编辑器内容");
    // 未挂载 + 快照优先
    controller.createUntitled();
    const uId = controller.store.activeTabId!;
    controller.store.setSnapshot(uId, "快照");
    expect(controller.getContext(uId)!.serialize()).toBe("快照");
    // 无快照无 initialDoc → 空串（重开空文档场景：关闭无快照标签再重开）
    controller.closeTab(uId); // "快照" 入重开栈，邻位激活文件标签
    controller.createUntitled(); // 新未命名标签（未挂载无快照）
    const emptyId = controller.store.activeTabId!;
    controller.closeTab(emptyId); // "" 入重开栈（LIFO 顶部）
    controller.reopenClosed();
    const reopenedId = controller.store.activeTabId!;
    expect(controller.getContext(reopenedId)!.serialize()).toBe("");
    // 兜底链路：上下文存在但既无快照也无 initialDoc（内容源缺失边缘）→ 空串
    controller.createUntitled();
    const bareId = controller.store.activeTabId!;
    controller.initialDocs.delete(bareId);
    expect(controller.getContext(bareId)!.serialize()).toBe("");
  });

  it("会话事件桥接：onDirtyChange 双向回写簿记 + 通知按级别分发", () => {
    controller.createUntitled();
    const id = controller.store.activeTabId!;
    controller.onInstanceReady(id, { crepe: fakeCrepe(), frontMatter: null });
    const session = registry.getInstance(id)!.session;
    // 脏状态桥接（02 单一事件源）：markDirty/markSaved → store 簿记联动
    session.markDirty();
    expect(controller.store.tabs[0].dirty).toBe(true);
    session.markSaved();
    expect(controller.store.tabs[0].dirty).toBe(false);
    // 通知口径：error 走 console.error，info 走 console.info
    session.notify({ level: "error", message: "写盘失败" });
    expect(console.error).toHaveBeenCalledWith("[MarkWell]", "写盘失败");
    session.notify({ level: "info", message: "已保存" });
    expect(console.info).toHaveBeenCalledWith("[MarkWell]", "已保存");
  });
});
