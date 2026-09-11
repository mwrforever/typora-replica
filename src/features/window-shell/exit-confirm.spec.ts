// 退出聚合确认状态机测试（12 窗口外壳 W6；AC-M-18~21；核心域 100%）
//
// 第一段：依赖全部 vi.fn 注入（04 脏聚合/saveTab、02 自动保存暂停恢复、services
// 关窗），直呼状态机方法断言阶段迁移与依赖派发——无脏直通/有脏进确认/取消静止态/
// 全部保存顺序写盘/单标签失败不阻断/全部不保存/弹窗期与写盘期重入忽略/关窗前复核
// 聚合（防弹窗期新变脏标签随关窗静默丢失）/关窗失败回退。
// 第二段：接 04 真实控制器的 AC 集成（mock 服务层，手法沿 tab-close-flow.spec.ts：
// 单例动态 import + 逐项清理；DocumentSession/AutoSaveController 真实构造）。
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Crepe } from "@milkdown/crepe";
import type { SaveOutcome } from "../document/document-session";
import type { TabsController } from "../tabs/tabs-controller";
import { createExitConfirm } from "./exit-confirm";
import type { DirtyTabEntry, ExitConfirmController } from "./exit-confirm";

/* ------------------------------------------------------------------ */
/* 集成段服务层 mock（必须模块顶层声明——vi.mock 嵌套在 describe 内时
 * 工厂执行时机错位，动态 import 链会拿到真实模块，readFile 实读失败回滚） */
const mockReadFile = vi.fn();
const mockWriteFile = vi.fn();
const mockLoadSettings = vi.fn();
const mockUpdateSettings = vi.fn();
const mockRecord = vi.fn();
const mockSaveAsDialog = vi.fn();
const mockCloseWindow = vi.fn();

vi.mock("../../services/file-io", () => ({
  // FileIoError 必须同构导出（document-session 的 catch 用 instanceof 判定）
  FileIoError: class FileIoError extends Error {},
  readFile: (...a: unknown[]) => mockReadFile(...a),
  writeFile: (...a: unknown[]) => mockWriteFile(...a),
}));
vi.mock("../../services/settings", () => ({
  loadSettings: (...a: unknown[]) => mockLoadSettings(...a),
  updateSettings: (...a: unknown[]) => mockUpdateSettings(...a),
  // 失效事件常量（register.ts 模块级 addEventListener 消费，mock 面须与真实导出对齐）
  SETTINGS_INVALIDATED_EVENT: "markwell-settings-updated",
}));
vi.mock("../../services/recent-files", () => ({
  // 同构导出 RecentFiles 类（document-session 用 new + .catch 消费）
  RecentFiles: class {
    record = (...a: unknown[]) => mockRecord(...a);
  },
}));
vi.mock("../../services/open-commands", () => ({
  // saveAsDialog 受控 mock（未命名标签保存分支；本文件默认取消）
  saveAsDialog: (...a: unknown[]) => mockSaveAsDialog(...a),
}));

/** 保存成功产物（夹具简写） */
const saved = (path = "D:\\a\\x.md"): SaveOutcome => ({ saved: true, path });

/** 写盘失败产物（夹具简写） */
const saveFailed = (message = "磁盘写入失败"): SaveOutcome => ({
  saved: false,
  reason: "io-error",
  message,
});

/** 依赖夹具（全 vi.fn，成功态默认；单用例按需改写返回值）。
 * saveTab 默认实现登记已保存 id，collect 过滤之——建模真实不变量
 * （02 session.save 成功 → markSaved → store 清除脏标记），复核聚合据此为空。
 * 返回类型推断（不显式标注 ExitConfirmDeps——vi.fn 构造签名与方法交叉冲突，
 * 结构化兼容由 createExitConfirm(deps) 调用点校验） */
function makeDeps(dirty: DirtyTabEntry[] = []) {
  const savedIds = new Set<string>();
  return {
    collectDirtyTabs: vi.fn(() => dirty.filter((t) => !savedIds.has(t.id)).map((t) => ({ ...t }))),
    saveTab: vi.fn(async (tabId: string) => {
      savedIds.add(tabId);
      return saved();
    }),
    suspendAutoSave: vi.fn(() => undefined),
    resumeAutoSave: vi.fn(() => undefined),
    closeWindow: vi.fn(async () => undefined),
  };
}

describe("退出聚合状态机（AC-M-18~21）", () => {
  it("AC-M-21 无脏标签直通关窗：不弹窗、不暂停自动保存", async () => {
    const deps = makeDeps([]);
    const machine = createExitConfirm(deps);
    await machine.handleCloseRequest();
    // 直通：阶段未经确认态（弹窗不出现），直接关窗；自动保存从未暂停
    expect(machine.phase.value).toBe("idle");
    expect(deps.closeWindow).toHaveBeenCalledTimes(1);
    expect(deps.suspendAutoSave).not.toHaveBeenCalled();
    expect(deps.collectDirtyTabs).toHaveBeenCalledTimes(1);
  });

  it("AC-M-18 多脏标签进入确认：列表按聚合序冻结并暂停自动保存", async () => {
    const deps = makeDeps([
      { id: "tab-1", title: "b.md" },
      { id: "tab-2", title: "c.md" },
    ]);
    const machine = createExitConfirm(deps);
    await machine.handleCloseRequest();
    // 确认态：列表冻结（列出全部脏文件），自动保存已暂停，不关窗
    expect(machine.phase.value).toBe("confirming");
    expect(machine.dirtyTabs.value.map((t) => t.title)).toEqual(["b.md", "c.md"]);
    expect(deps.suspendAutoSave).toHaveBeenCalledTimes(1);
    expect(deps.closeWindow).not.toHaveBeenCalled();
  });

  it("AC-M-20 取消：回 cancelled 静止态，恢复自动保存，不写盘不关窗", async () => {
    const deps = makeDeps([{ id: "tab-1", title: "b.md" }]);
    const machine = createExitConfirm(deps);
    await machine.handleCloseRequest();
    machine.cancel();
    // 窗口保持内容不变：无写盘无关窗，仅恢复自动保存
    expect(machine.phase.value).toBe("cancelled");
    expect(deps.resumeAutoSave).toHaveBeenCalledTimes(1);
    expect(deps.saveTab).not.toHaveBeenCalled();
    expect(deps.closeWindow).not.toHaveBeenCalled();
  });

  it("cancelled 静止态再次关闭请求：重新聚合开启新一轮确认", async () => {
    const deps = makeDeps([{ id: "tab-1", title: "b.md" }]);
    const machine = createExitConfirm(deps);
    await machine.handleCloseRequest();
    machine.cancel();
    await machine.handleCloseRequest();
    // 新轮次：重新聚合（第二次 collect），确认态与列表重建
    expect(machine.phase.value).toBe("confirming");
    expect(deps.collectDirtyTabs).toHaveBeenCalledTimes(2);
    expect(machine.dirtyTabs.value).toEqual([{ id: "tab-1", title: "b.md" }]);
  });

  it("AC-M-19 全部保存：按冻结列表顺序逐标签写盘，全部成功才关窗", async () => {
    const deps = makeDeps([
      { id: "tab-1", title: "b.md" },
      { id: "tab-2", title: "c.md" },
    ]);
    const machine = createExitConfirm(deps);
    await machine.handleCloseRequest();
    await machine.saveAll();
    // 顺序写盘（列表序，取 mock 调用参数序）→ 全部成功 → 关窗；
    // 成功路径不恢复自动保存（窗口随即销毁）
    expect(deps.saveTab.mock.calls.map((c) => c[0])).toEqual(["tab-1", "tab-2"]);
    expect(deps.closeWindow).toHaveBeenCalledTimes(1);
    expect(deps.resumeAutoSave).not.toHaveBeenCalled();
    expect(machine.phase.value).toBe("closing");
  });

  it("写盘进行中阶段为 saving（受控 Promise 观测中间态）", async () => {
    const deps = makeDeps([{ id: "tab-1", title: "b.md" }]);
    let resolveSave!: (outcome: SaveOutcome) => void;
    deps.saveTab.mockImplementationOnce(
      () =>
        new Promise<SaveOutcome>((resolve) => {
          resolveSave = resolve;
        }),
    );
    // 受控 Promise 绕过夹具默认登记：once 队列按消费序——首次聚合同默认，
    // 复核聚合（第二次 collect）显式返回空
    deps.collectDirtyTabs
      .mockImplementationOnce(() => [{ id: "tab-1", title: "b.md" }])
      .mockImplementationOnce(() => []);
    const machine = createExitConfirm(deps);
    await machine.handleCloseRequest();
    const pending = machine.saveAll();
    // 首标签写盘未完成：处于 saving（弹窗保持展示、按钮禁用态）
    expect(machine.phase.value).toBe("saving");
    resolveSave(saved("D:\\a\\b.md"));
    await pending;
    expect(machine.phase.value).toBe("closing");
  });

  it("单标签写盘失败不阻断其余：全部尝试后窗口保持并恢复自动保存", async () => {
    const deps = makeDeps([
      { id: "tab-1", title: "b.md" },
      { id: "tab-2", title: "c.md" },
      { id: "tab-3", title: "d.md" },
    ]);
    deps.saveTab.mockImplementation(async (tabId: string) =>
      tabId === "tab-2" ? saveFailed() : saved(),
    );
    const machine = createExitConfirm(deps);
    await machine.handleCloseRequest();
    await machine.saveAll();
    // 失败标签不阻断：三个标签全部尝试；任一失败 → 不关窗（不部分关闭）、
    // 恢复自动保存、回 cancelled 静止态（失败标签保持脏态留在窗口）
    expect(deps.saveTab).toHaveBeenCalledTimes(3);
    expect(deps.closeWindow).not.toHaveBeenCalled();
    expect(deps.resumeAutoSave).toHaveBeenCalledTimes(1);
    expect(machine.phase.value).toBe("cancelled");
  });

  it("弹窗期再次关闭请求：安全忽略（不重复聚合、不重复暂停）", async () => {
    const deps = makeDeps([{ id: "tab-1", title: "b.md" }]);
    const machine = createExitConfirm(deps);
    await machine.handleCloseRequest();
    await machine.handleCloseRequest();
    await machine.handleCloseRequest();
    // 确认弹窗已模态展示：重入不重新聚合（collect 仅首次）、不重复暂停
    expect(deps.collectDirtyTabs).toHaveBeenCalledTimes(1);
    expect(deps.suspendAutoSave).toHaveBeenCalledTimes(1);
    expect(machine.phase.value).toBe("confirming");
  });

  it("写盘期再次关闭请求：安全忽略（写盘原子性，不中断不重入）", async () => {
    const deps = makeDeps([{ id: "tab-1", title: "b.md" }]);
    let resolveSave!: (outcome: SaveOutcome) => void;
    deps.saveTab.mockImplementationOnce(
      () =>
        new Promise<SaveOutcome>((resolve) => {
          resolveSave = resolve;
        }),
    );
    // 受控 Promise 绕过夹具默认登记：once 队列按消费序——首次聚合同默认，
    // 复核聚合（第二次 collect）显式返回空
    deps.collectDirtyTabs
      .mockImplementationOnce(() => [{ id: "tab-1", title: "b.md" }])
      .mockImplementationOnce(() => []);
    const machine = createExitConfirm(deps);
    await machine.handleCloseRequest();
    const pending = machine.saveAll();
    await machine.handleCloseRequest(); // 写盘进行中的关闭重入
    resolveSave(saved("D:\\a\\b.md"));
    await pending;
    // 重入被忽略：写盘流程不受影响，照常关窗
    expect(deps.saveTab).toHaveBeenCalledTimes(1);
    expect(deps.closeWindow).toHaveBeenCalledTimes(1);
  });

  it("全部不保存：不写盘直接关窗（用户显式一次性决定，丢弃列表变更）", async () => {
    const deps = makeDeps([
      { id: "tab-1", title: "b.md" },
      { id: "tab-2", title: "c.md" },
    ]);
    const machine = createExitConfirm(deps);
    await machine.handleCloseRequest();
    await machine.discardAll();
    expect(deps.saveTab).not.toHaveBeenCalled();
    expect(deps.closeWindow).toHaveBeenCalledTimes(1);
    expect(machine.phase.value).toBe("closing");
  });

  it("全部保存成功后复核：弹窗期新变脏的标签开启新一轮确认（防随关窗静默丢失）", async () => {
    const deps = makeDeps([{ id: "tab-1", title: "b.md" }]);
    // 第一次聚合仅 b.md；b.md 保存成功后（脏标记已清除），复核时 c.md 已在
    // 弹窗期被编辑变脏——mock 与真实不变量一致（已保存标签不再出现在脏集合）
    deps.collectDirtyTabs
      .mockImplementationOnce(() => [{ id: "tab-1", title: "b.md" }])
      .mockImplementationOnce(() => [{ id: "tab-2", title: "c.md" }]);
    const machine = createExitConfirm(deps);
    await machine.handleCloseRequest();
    await machine.saveAll(); // b.md 保存成功
    // 复核发现 c.md 变脏：不关窗，开启新一轮确认（列表以最新脏集合重建）
    expect(deps.closeWindow).not.toHaveBeenCalled();
    expect(machine.phase.value).toBe("confirming");
    expect(machine.dirtyTabs.value).toEqual([{ id: "tab-2", title: "c.md" }]);
  });

  it("全部不保存复核排除冻结列表：弹窗期新变脏的其他标签仍获确认", async () => {
    const deps = makeDeps([{ id: "tab-1", title: "b.md" }]);
    // 复核时 b.md 仍在脏集合（显式放弃，不重复弹窗）且 c.md 新变脏
    deps.collectDirtyTabs
      .mockImplementationOnce(() => [{ id: "tab-1", title: "b.md" }])
      .mockImplementationOnce(() => [
        { id: "tab-1", title: "b.md" },
        { id: "tab-2", title: "c.md" },
      ]);
    const machine = createExitConfirm(deps);
    await machine.handleCloseRequest();
    await machine.discardAll();
    // b.md 已显式放弃（排除）；c.md 未被本轮决定覆盖 → 新一轮确认
    expect(machine.phase.value).toBe("confirming");
    expect(machine.dirtyTabs.value).toEqual([{ id: "tab-2", title: "c.md" }]);
    expect(deps.closeWindow).not.toHaveBeenCalled();
  });

  it("全部保存复核为空时正常关窗（复核为空 = 常规路径，行为与 AC 一致）", async () => {
    const deps = makeDeps([{ id: "tab-1", title: "b.md" }]);
    // 第一次聚合 [b.md]；写盘成功后复核为空（保存已清除脏标记的常规形态）
    deps.collectDirtyTabs
      .mockImplementationOnce(() => [{ id: "tab-1", title: "b.md" }])
      .mockImplementationOnce(() => []);
    const machine = createExitConfirm(deps);
    await machine.handleCloseRequest();
    await machine.saveAll();
    expect(deps.closeWindow).toHaveBeenCalledTimes(1);
    expect(machine.phase.value).toBe("closing");
  });

  it("关窗失败（confirming 起源）：恢复自动保存并回退 idle，窗口可再次关闭", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const deps = makeDeps([{ id: "tab-1", title: "b.md" }]);
    deps.closeWindow.mockRejectedValueOnce(new Error("IPC 失败"));
    const machine = createExitConfirm(deps);
    await machine.handleCloseRequest();
    await machine.discardAll();
    // 关窗失败不困死于 closing（否则后续关闭请求全被忽略）：回退交互态
    expect(machine.phase.value).toBe("idle");
    expect(deps.resumeAutoSave).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalled();
  });

  it("无脏直通关窗失败：仅记录，阶段保持 idle（自动保存从未暂停不误恢复）", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const deps = makeDeps([]);
    deps.closeWindow.mockRejectedValueOnce(new Error("IPC 失败"));
    const machine = createExitConfirm(deps);
    await machine.handleCloseRequest();
    // 直通路径未暂停任何资源：失败仅记录，不触发恢复（防 start 二次订阅）
    expect(machine.phase.value).toBe("idle");
    expect(deps.resumeAutoSave).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
  });

  it("非确认态调用三按钮动作：安全忽略（双击/空闲态守卫）", async () => {
    const deps = makeDeps([]);
    const machine = createExitConfirm(deps);
    await machine.saveAll();
    await machine.discardAll();
    machine.cancel();
    // idle 态下三动作均为 no-op：无写盘、无关窗、无恢复
    expect(deps.saveTab).not.toHaveBeenCalled();
    expect(deps.closeWindow).not.toHaveBeenCalled();
    expect(deps.resumeAutoSave).not.toHaveBeenCalled();
  });
});

describe("退出聚合确认 AC 集成（接 04 控制器真实链路）", () => {
  let tabs: TabsController;
  let machine: ExitConfirmController;
  let registry: typeof import("../tabs/editor-registry");

  /** fake crepe（沿 tab-close-flow.spec.ts：adopt 经 setupEditorEvents 调 crepe.on） */
  function fakeCrepe(markdown = "正文"): Crepe {
    return { on: vi.fn(), getMarkdown: () => markdown } as unknown as Crepe;
  }

  /**
   * 打开文件并挂载实例 + 经 02 会话置脏（真实单一事件源链路：
   * session.markDirty → onDirtyChange → store.markDirty——直改 store 会使
   * 保存后的 markSaved 广播无法清脏，复核聚合会把假脏标签拉回新轮次）
   */
  async function openDirtyFile(path: string, title: string, id: string): Promise<void> {
    await tabs.openFile(path, title);
    tabs.onInstanceReady(id, { crepe: fakeCrepe(`# ${title}`), frontMatter: null });
    registry.getInstance(id)!.session.markDirty();
  }

  /** 按 App.vue 装配形态绑定状态机依赖（真实 04 controller + mock 关窗） */
  function bindMachine(): void {
    machine = createExitConfirm({
      collectDirtyTabs: () =>
        tabs.store.tabs.filter((t) => t.dirty).map((t) => ({ id: t.id, title: t.title })),
      saveTab: (tabId) => tabs.saveTab(tabId),
      suspendAutoSave: () => tabs.pauseAutoSave(),
      resumeAutoSave: () => tabs.resumeAutoSave(),
      closeWindow: () => mockCloseWindow(),
    });
  }

  beforeAll(async () => {
    setActivePinia(createPinia());
    // 单例在 createController 内调用 useTabsStore → 必须先有 active Pinia 再 import
    tabs = (await import("../tabs/tabs-controller")).useTabsController();
    registry = await import("../tabs/editor-registry");
  });

  beforeEach(() => {
    // 单例状态逐项清理（不 resetModules：动态 import 缓存同一模块实例）
    tabs.store.$reset();
    tabs.initialDocs.clear();
    tabs.recycledIds.clear();
    tabs.closeRequest.value = undefined;
    registry.clearRegistryForTest();
    mockReadFile.mockReset().mockResolvedValue({
      content: "# 文档",
      encoding: "utf8",
      lineEnding: "lf",
    });
    mockWriteFile.mockReset().mockResolvedValue(undefined);
    mockLoadSettings.mockReset().mockResolvedValue({
      autoSave: { enabled: false, timerMinutes: 5 }, // 关自动保存：无 5 分钟兜底定时器
      defaultLineEnding: "lf",
      launch: { mode: "new", customPath: "" },
    });
    mockUpdateSettings.mockReset().mockResolvedValue({});
    mockRecord.mockReset().mockResolvedValue(undefined);
    mockCloseWindow.mockReset().mockResolvedValue(undefined);
    // 静默会话通知（onNotice 桥接 console，避免测试输出噪音）
    bindMachine();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("AC-M-18 两个脏文件聚合出列表（读 04 store，经 02 脏桥驱动）", async () => {
    await openDirtyFile("D:\\a\\b.md", "b.md", "tab-1");
    await openDirtyFile("D:\\a\\c.md", "c.md", "tab-2");
    await machine.handleCloseRequest();
    expect(machine.phase.value).toBe("confirming");
    expect(machine.dirtyTabs.value.map((t) => t.title)).toEqual(["b.md", "c.md"]);
    expect(mockWriteFile).not.toHaveBeenCalled();
    expect(mockCloseWindow).not.toHaveBeenCalled();
  });

  it("AC-M-19 全部保存经 02 链路逐标签写盘后关窗", async () => {
    await openDirtyFile("D:\\a\\b.md", "b.md", "tab-1");
    await openDirtyFile("D:\\a\\c.md", "c.md", "tab-2");
    await machine.handleCloseRequest();
    await machine.saveAll();
    // 逐标签走 02 session.save（writeFile 两次），保存成功广播 markSaved 清脏
    // → 复核聚合为空 → 关窗回调触发
    expect(mockWriteFile).toHaveBeenCalledTimes(2);
    expect(mockCloseWindow).toHaveBeenCalledTimes(1);
    expect(machine.phase.value).toBe("closing");
    expect(tabs.store.tabs.find((t) => t.id === "tab-1")!.dirty).toBe(false);
    expect(tabs.store.tabs.find((t) => t.id === "tab-2")!.dirty).toBe(false);
  });

  it("AC-M-20 取消：标签与脏状态原样保持，无写盘无关窗", async () => {
    await openDirtyFile("D:\\a\\b.md", "b.md", "tab-1");
    await machine.handleCloseRequest();
    machine.cancel();
    expect(machine.phase.value).toBe("cancelled");
    expect(tabs.store.tabs).toHaveLength(1);
    expect(tabs.store.tabs[0]!.dirty).toBe(true);
    expect(mockWriteFile).not.toHaveBeenCalled();
    expect(mockCloseWindow).not.toHaveBeenCalled();
  });

  it("AC-M-21 无脏标签直通关窗：不进确认态", async () => {
    await tabs.openFile("D:\\a\\b.md", "b.md");
    await machine.handleCloseRequest();
    expect(machine.phase.value).toBe("idle");
    expect(mockWriteFile).not.toHaveBeenCalled();
    expect(mockCloseWindow).toHaveBeenCalledTimes(1);
  });
});
