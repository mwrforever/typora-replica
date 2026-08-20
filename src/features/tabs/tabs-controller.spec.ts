// tabs-controller 编排控制器（04：每标签会话栈/打开回滚/超限回收/透传编排）
//
// 控制器为模块级单例（useTabsStore 在模块求值期调用）→ 本文件必须在 active
// Pinia 就绪后动态 import；用例间隔离：store.$reset + initialDocs/recycledIds
// 清空 + clearRegistryForTest（单例状态不随 resetModules 重建，逐项清理）。
// DocumentSession/AutoSaveController/editorManager 真实构造（不 mock 进本体），
// 仅 mock 服务层（file-io/settings/recent-files）与 fake crepe（adopt 需 on 桩）。
import { createPinia, setActivePinia } from "pinia";
import { nextTick } from "vue";
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

  it("reopenClosed：空内容经 restore 广播入 initialDocs；未命名不登记路径；栈空安全返回", () => {
    controller.createUntitled();
    const aId = controller.store.activeTabId!;
    controller.closeTab(aId); // 未挂载无快照 → 空串入栈；D3 自动新建 Untitled 2
    controller.reopenClosed();
    const reopenedId = controller.store.activeTabId!;
    // I1：restore 恒广播内容（含空串）入 initialDocs——TabHost 模板 "?? ''" 保底空文档
    expect(controller.initialDocs.get(reopenedId)).toBe("");
    controller.onInstanceReady(reopenedId, { crepe: fakeCrepe(), frontMatter: null });
    const session = registry.getInstance(reopenedId)!.session;
    expect(session.currentPath).toBeUndefined(); // 未命名重开：restore 不登记路径
    expect(session.dirty).toBe(false);
    startedAutoSaveIds.push(reopenedId); // 重开即激活（afterEach 停订）
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

  it("openFile 去重命中已回收标签：解除回收标记触发重建（AC-F29-7 收口）", async () => {
    vi.useFakeTimers();
    const ids: string[] = [];
    for (let i = 0; i < MAX_TABS; i++) {
      mockReadFile.mockResolvedValueOnce({
        content: `内容${i}`,
        encoding: "utf8",
        lineEnding: "lf",
      });
      expect(await controller.openFile(`C:/a/${i}.md`, `${i}.md`)).toBe(true);
      ids.push(controller.store.activeTabId!);
    }
    // 依次挂载并推进时间：lastActivatedAt 递增 → 第 17 个标签触发回收最久未激活（首个）
    for (let i = 0; i < ids.length; i++) {
      vi.advanceTimersByTime(1000);
      controller.onInstanceReady(ids[i], {
        crepe: fakeCrepe(`内容${i}`),
        frontMatter: null,
      });
    }
    const victimId = ids[0];
    mockReadFile.mockResolvedValueOnce({ content: "新内容", encoding: "utf8", lineEnding: "lf" });
    expect(await controller.openFile("C:/a/new.md", "new.md")).toBe(true);
    expect(controller.recycledIds.has(victimId)).toBe(true); // 前置：已回收（v-if 卸载态）
    // 重开同一路径：去重命中已回收标签（created=false）→ 解除 recycled 标记
    expect(await controller.openFile("C:/a/0.md", "0.md")).toBe(false);
    expect(controller.recycledIds.has(victimId)).toBe(false); // TabHost 重挂载触发点
    expect(controller.store.activeTabId).toBe(victimId); // store.openFile 已激活
    // 重建链路就绪：TabHost 重挂载 → onInstanceReady → 登记 + 清快照 + 激活门面
    controller.onInstanceReady(victimId, { crepe: fakeCrepe("重建正文"), frontMatter: null });
    expect(registry.getInstance(victimId)).toBeDefined();
    expect(controller.store.tabs.find((t) => t.id === victimId)!.contentSnapshot).toBeUndefined();
    expect(controller.activeSession()).toBe(registry.getInstance(victimId)!.session);
    startedAutoSaveIds.push(victimId); // 重建即激活（afterEach 停订）
  });

  it("getContext：挂载取实例序列化；未挂载取快照/空串；未知 id undefined", async () => {
    expect(controller.getContext("nope")).toBeUndefined();
    // 未挂载且无快照 → 空串（Task 14 与 finalizeClose 同口径，initialDocs 不参与序列化）
    mockReadFile.mockResolvedValueOnce({ content: "文件内容", encoding: "utf8", lineEnding: "lf" });
    await controller.openFile("C:/a/b.md", "b.md");
    const id = controller.store.activeTabId!;
    expect(controller.getContext(id)!.serialize()).toBe("");
    // 挂载：按实例序列化（getMarkdownFor）
    controller.onInstanceReady(id, { crepe: fakeCrepe("编辑器内容"), frontMatter: null });
    expect(controller.getContext(id)!.serialize()).toBe("编辑器内容");
    // 未挂载 + 快照优先
    controller.createUntitled();
    const uId = controller.store.activeTabId!;
    controller.store.setSnapshot(uId, "快照");
    expect(controller.getContext(uId)!.serialize()).toBe("快照");
    // 无快照 → 空串（重开空文档场景：关闭无快照标签再重开）
    controller.closeTab(uId); // "快照" 入重开栈，邻位激活文件标签
    controller.createUntitled(); // 新未命名标签（未挂载无快照）
    const emptyId = controller.store.activeTabId!;
    controller.closeTab(emptyId); // "" 入重开栈（LIFO 顶部）
    controller.reopenClosed();
    const reopenedId = controller.store.activeTabId!;
    expect(controller.getContext(reopenedId)!.serialize()).toBe("");
    // 兜底链路：上下文存在但无快照（内容源缺失边缘）→ 空串
    controller.createUntitled();
    const bareId = controller.store.activeTabId!;
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

  it("终审 C1：激活/轮换只改簿记仍驱动门面 adopt（activeSession 与 autoSave 切换）", async () => {
    mockReadFile.mockResolvedValueOnce({ content: "a 文档", encoding: "utf8", lineEnding: "lf" });
    await controller.openFile("D:/a/a.md", "a.md");
    const aId = controller.store.activeTabId!;
    mockReadFile.mockResolvedValueOnce({ content: "b 文档", encoding: "utf8", lineEnding: "lf" });
    await controller.openFile("D:/a/b.md", "b.md");
    const bId = controller.store.activeTabId!;
    // 挂两个标签：a 非激活仅登记；b 挂载即激活（门面 adopt b）
    controller.onInstanceReady(aId, { crepe: fakeCrepe("a 内容"), frontMatter: null });
    controller.onInstanceReady(bId, { crepe: fakeCrepe("b 内容"), frontMatter: null });
    const instA = registry.getInstance(aId)!;
    const instB = registry.getInstance(bId)!;
    expect(controller.activeSession()).toBe(instB.session); // 前置：门面在 b
    // 插入 spy 后 a.start / b.stop 各应经 watch 驱动触发一次（此前 a 未激活、b 从未停）
    const startSpyA = vi.spyOn(instA.autoSave, "start");
    const stopSpyB = vi.spyOn(instB.autoSave, "stop");
    controller.activate(aId); // 点击标签 a：store.activate → watch → activateInstance(a)
    await nextTick(); // 冲刷 Vue watch 微任务队列
    expect(controller.activeSession()).toBe(instA.session); // 门面已 adopt a
    expect(startSpyA).toHaveBeenCalledTimes(1); // a 的 autoSave 启动
    expect(stopSpyB).toHaveBeenCalledTimes(1); // b 的 autoSave 停订
    // 轮换路径（Ctrl+Tab → store.cycle）同样走 watch：切回 b
    const startSpyB2 = vi.spyOn(instB.autoSave, "start");
    const stopSpyA = vi.spyOn(instA.autoSave, "stop");
    controller.cycle(1);
    await nextTick();
    expect(controller.activeSession()).toBe(instB.session);
    expect(startSpyB2).toHaveBeenCalledTimes(1);
    expect(stopSpyA).toHaveBeenCalledTimes(1);
    // 清理：还原 spy 后真实停订两个标签（避免残留订阅与 5 分钟兜底定时器）
    startSpyA.mockRestore();
    stopSpyB.mockRestore();
    startSpyB2.mockRestore();
    stopSpyA.mockRestore();
    instA.autoSave.stop();
    instB.autoSave.stop();
  });

  it("终审 C2：后台脏标签「保存」写自身文件（per-tab 序列化注入，不串激活标签内容）", async () => {
    mockReadFile.mockResolvedValueOnce({ content: "a 文档", encoding: "utf8", lineEnding: "lf" });
    await controller.openFile("D:/a/a.md", "a.md");
    const aId = controller.store.activeTabId!;
    controller.onInstanceReady(aId, { crepe: fakeCrepe("a 编辑器内容"), frontMatter: null });
    mockReadFile.mockResolvedValueOnce({ content: "b 文档", encoding: "utf8", lineEnding: "lf" });
    await controller.openFile("D:/a/b.md", "b.md");
    const bId = controller.store.activeTabId!;
    controller.onInstanceReady(bId, { crepe: fakeCrepe("b 编辑器内容"), frontMatter: null });
    // 前置：门面已 adopt b、a 为后台（若无 per-tab 注入，a 保存会经门面取到 b 内容）
    expect(controller.activeSession()).toBe(registry.getInstance(bId)!.session);
    // a 脏 → 挂起关闭 → 选「保存」
    controller.store.markDirty(aId);
    controller.closeTab(aId);
    await controller.confirmCloseSave();
    // 写盘目标与内容必须属于 a（不得把 b 的内容写进 a.md）
    expect(mockWriteFile).toHaveBeenCalledTimes(1);
    const [targetPath, diskContent] = mockWriteFile.mock.calls[0] as [string, string];
    expect(targetPath).toBe("D:/a/a.md");
    expect(diskContent).toContain("a 编辑器内容");
    expect(diskContent).not.toContain("b");
    // a 保存成功已关闭；b 保持打开且门面不变
    expect(controller.store.tabs.map((t) => t.id)).toEqual([bId]);
    expect(controller.activeSession()).toBe(registry.getInstance(bId)!.session);
  });

  it("终审 I1：reopenClosed 经 session.restore 登记原路径与脏状态（Ctrl+S 直存不弹另存为）", async () => {
    mockReadFile.mockResolvedValue({ content: "内容", encoding: "utf8", lineEnding: "lf" });
    await controller.openFile("D:/a/reopen.md", "reopen.md");
    const aId = controller.store.activeTabId!;
    controller.onInstanceReady(aId, { crepe: fakeCrepe("脏内容"), frontMatter: null });
    controller.store.markDirty(aId); // 编辑置脏
    controller.closeTab(aId); // 脏 → 挂起确认
    controller.confirmCloseDiscard(); // 丢弃：关闭前脏内容入重开栈
    controller.reopenClosed();
    const reopenedId = controller.store.activeTabId!;
    // 重开标签挂载登记 → 会话恢复状态可检（restore 已登记原路径/脏状态）
    controller.onInstanceReady(reopenedId, { crepe: fakeCrepe(), frontMatter: null });
    const session = registry.getInstance(reopenedId)!.session;
    expect(session.currentPath).toBe("D:/a/reopen.md"); // 原文件路径恢复（非空 → 不弹另存为）
    expect(session.dirty).toBe(true); // 脏状态恢复
    expect(controller.initialDocs.get(reopenedId)).toBe("脏内容"); // restore 广播内容入 initialDocs
    startedAutoSaveIds.push(reopenedId); // 重开即激活（afterEach 停订）
  });

  it("终审 I1 兜底分支：重开标签快照缺失时 restore 回落空串（类型防御）", () => {
    // store.reopenClosed 恒写 contentSnapshot（字符串），`tab.contentSnapshot ?? ""` 的
    // 空串侧仅在类型级防御（TabMeta.contentSnapshot 可选缺失）可及——经 spy 注入缺失
    // 快照的重开 id 覆盖兜底侧（与既有防御分支用例同手法：tab-close-flow 幽灵 id 注入）。
    const spy = vi.spyOn(controller.store, "reopenClosed").mockReturnValueOnce("defensive-id");
    controller.store.$patch((s) => {
      s.tabs.push({
        id: "defensive-id",
        kind: "untitled",
        title: "防御",
        dirty: false,
        contentReady: true,
      });
    });
    controller.reopenClosed(); // restore(tab.path=undefined, "" 兜底, ...)
    controller.onInstanceReady("defensive-id", { crepe: fakeCrepe(), frontMatter: null });
    const session = registry.getInstance("defensive-id")!.session;
    expect(session.currentPath).toBeUndefined(); // 无路径不登记
    expect(session.dirty).toBe(false);
    expect(controller.initialDocs.get("defensive-id")).toBe(""); // 空串经 restore 广播入 initialDocs
    spy.mockRestore();
  });

  it("终审 I2：回收重建内容源 contentSnapshot（回收时最新）优先 initialDocs（打开时旧值）", () => {
    // 前置簿记（终审 I2）：initialDocs 打开时写入后从不清理（恒陈旧）；contentSnapshot
    // 由 maybeRecycle 以实例最新内容覆盖（恒新鲜）。TabHost 重建模板序
    // ":initial-doc=\"tab.contentSnapshot ?? initialDocs.get(tab.id) ?? ''\"" 把
    // contentSnapshot 放左侧 → 编辑后最新内容优先，回收重建不丢编辑；若序颠倒会读到旧值。
    controller.createUntitled();
    const id = controller.store.activeTabId!;
    controller.initialDocs.set(id, "打开时旧内容");
    controller.store.setSnapshot(id, "编辑后最新内容"); // 模拟 maybeRecycle 覆盖快照
    // 重建解析式（与 TabHost 模板逐字对应）：contentSnapshot 优先
    const tab = controller.store.tabs.find((t) => t.id === id)!;
    const rebuildDoc = tab.contentSnapshot ?? controller.initialDocs.get(id) ?? "";
    expect(rebuildDoc).toBe("编辑后最新内容");
    expect(controller.initialDocs.get(id)).toBe("打开时旧内容"); // 旧值仍在但被 contentSnapshot 遮蔽
  });
});
