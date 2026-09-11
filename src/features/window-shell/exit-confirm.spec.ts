// 退出聚合确认状态机测试（12 窗口外壳 W6；AC-M-18~21；核心域 100%）
//
// 第一段：依赖全部 vi.fn 注入（04 脏聚合/saveTab、02 自动保存暂停恢复、services
// 关窗），直呼状态机方法断言阶段迁移与依赖派发——无脏直通/有脏进确认/取消静止态/
// 全部保存顺序写盘/失败复显弹窗（错误区携带失败原因、自动保存保持暂停）/失败后
// 改选与重试/弹窗期与写盘期重入忽略/关窗失败回退。「弹窗期新变脏」场景一律放
// 第二段经真实 session/auto-save 链路驱动（生产脏标记唯一触发点 auto-save
// markDirty——mock collect 返回差异集属固化不可达前提，已随双通道修复删除）。
// 第二段：接 04 真实控制器的 AC 集成（mock 服务层，手法沿 tab-close-flow.spec.ts：
// 单例动态 import + 逐项清理；DocumentSession/AutoSaveController 真实构造）+
// 弹窗期真实链路断言（crepe 事件注入 → editor-events 防抖 → 门面分发 → 标脏/写盘）。
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
 * （02 session.save 成功 → markSaved → store 清除脏标记），复核聚合据此为空；
 * failFirstFor 指定首写必败标签（建模 02 写盘失败，重试即成功——失败复显路径）。
 * 返回类型推断（不显式标注 ExitConfirmDeps——vi.fn 构造签名与方法交叉冲突，
 * 结构化兼容由 createExitConfirm(deps) 调用点校验） */
function makeDeps(dirty: DirtyTabEntry[] = [], failFirstFor?: string) {
  const savedIds = new Set<string>();
  const failedOnce = new Set<string>();
  return {
    collectDirtyTabs: vi.fn(() => dirty.filter((t) => !savedIds.has(t.id)).map((t) => ({ ...t }))),
    saveTab: vi.fn(async (tabId: string) => {
      if (failFirstFor !== undefined && tabId === failFirstFor && !failedOnce.has(tabId)) {
        failedOnce.add(tabId);
        return saveFailed();
      }
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

  it("单标签写盘失败不阻断其余：全部尝试后回确认态复显失败原因（自动保存保持暂停）", async () => {
    const deps = makeDeps(
      [
        { id: "tab-1", title: "b.md" },
        { id: "tab-2", title: "c.md" },
        { id: "tab-3", title: "d.md" },
      ],
      "tab-2",
    );
    const machine = createExitConfirm(deps);
    await machine.handleCloseRequest();
    await machine.saveAll();
    // 失败标签不阻断：三个标签全部尝试；任一失败 → 不关窗（不部分关闭）、
    // 回 confirming 复显弹窗（错误区携带失败原因，用户可改选或重试）、
    // 不恢复自动保存（confirming ⇒ 已暂停不变量未破，失败标签保持脏态留窗）
    expect(deps.saveTab).toHaveBeenCalledTimes(3);
    expect(deps.closeWindow).not.toHaveBeenCalled();
    expect(deps.resumeAutoSave).not.toHaveBeenCalled();
    expect(deps.suspendAutoSave).toHaveBeenCalledTimes(1);
    expect(machine.phase.value).toBe("confirming");
    expect(machine.failMessage.value).toBe("磁盘写入失败");
  });

  it("失败复显后改选全部不保存：完成退出（已放弃标签复核不回弹）", async () => {
    const deps = makeDeps(
      [
        { id: "tab-1", title: "b.md" },
        { id: "tab-2", title: "c.md" },
      ],
      "tab-2",
    );
    const machine = createExitConfirm(deps);
    await machine.handleCloseRequest();
    await machine.saveAll(); // tab-2 失败 → 复显
    expect(machine.phase.value).toBe("confirming");
    await machine.discardAll();
    // 改选放弃：本轮冻结列表（含失败标签）并入放弃集，复核排除后关窗
    expect(deps.saveTab).toHaveBeenCalledTimes(2); // 失败轮不再补写
    expect(deps.closeWindow).toHaveBeenCalledTimes(1);
    expect(machine.phase.value).toBe("closing");
  });

  it("失败复显后重试全部保存：成功后失败消息清除并关窗", async () => {
    const deps = makeDeps([{ id: "tab-1", title: "b.md" }], "tab-1");
    const machine = createExitConfirm(deps);
    await machine.handleCloseRequest();
    await machine.saveAll();
    expect(machine.failMessage.value).toBe("磁盘写入失败");
    await machine.saveAll(); // 重试（夹具建模：第二次写盘成功）
    expect(deps.saveTab).toHaveBeenCalledTimes(2);
    expect(machine.failMessage.value).toBeUndefined();
    expect(deps.closeWindow).toHaveBeenCalledTimes(1);
    expect(machine.phase.value).toBe("closing");
  });

  it("新一轮确认清除上一轮失败消息（弹窗错误区不残留旧失败）", async () => {
    const deps = makeDeps([{ id: "tab-1", title: "b.md" }], "tab-1");
    const machine = createExitConfirm(deps);
    await machine.handleCloseRequest();
    await machine.saveAll();
    expect(machine.failMessage.value).toBe("磁盘写入失败");
    machine.cancel();
    await machine.handleCloseRequest(); // 新决策点重新聚合
    expect(machine.phase.value).toBe("confirming");
    expect(machine.failMessage.value).toBeUndefined();
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

  /** 本测试激活过 autoSave 的标签（afterEach 停订清理——门面订阅不随 destroy
   *  清理，残留运行态控制器会在后续用例的编辑事件中照常落盘，污染写盘断言） */
  const startedAutoSaveIds: string[] = [];

  /** 注入 markdownUpdated 的 listener 桩切片（attachEditorEvents 消费面） */
  interface ListenerRegistrar {
    markdownUpdated(reg: (ctx: unknown, md: string) => void): void;
    updated(reg: (ctx: unknown, doc: unknown) => void): void;
    selectionUpdated(reg: (ctx: unknown, sel: unknown) => void): void;
  }
  /** 带事件注入的 fake crepe 形态（fireMarkdownUpdated 为测试专用注入口） */
  type FireCrepe = Crepe & { fireMarkdownUpdated(md: string): void };

  /**
   * fake crepe（沿本文件惯例，on 桩升级为同步回放真实注册流程）：adopt 经
   * setupEditorEvents 调 crepe.on 时同步递交 listener 桩收集 markdownUpdated
   * 注册器；fireMarkdownUpdated 触发经真实 editor-events 300ms 防抖与门面分发
   * 到达 autoSave 标脏订阅——弹窗期编辑事件的集成驱动入口。
   * detachEditorEvents 的 cancel 语义真实生效：后台标签（门面已切走）的注册器
   * 触发为 no-op，与「仅激活标签事件可达订阅方」的生产语义一致。
   */
  function fakeCrepe(markdown = "正文"): Crepe {
    const regs: Array<(ctx: unknown, md: string) => void> = [];
    const listener: ListenerRegistrar = {
      markdownUpdated: (reg) => void regs.push(reg),
      updated: () => undefined,
      selectionUpdated: () => undefined,
    };
    const crepe = {
      on: (cb: (l: ListenerRegistrar) => void) => cb(listener),
      getMarkdown: () => markdown,
    };
    return Object.assign(crepe, {
      fireMarkdownUpdated: (md: string) => {
        for (const reg of regs) reg(undefined, md);
      },
    }) as unknown as Crepe;
  }

  /**
   * 经真实事件链注入一次 markdownUpdated 编辑事件并等防抖送达订阅方
   * （crepe listener → editor-events 300ms 防抖 → 门面分发 → autoSave 标脏）
   */
  async function fireEdit(id: string, md = "弹窗期编辑"): Promise<void> {
    (registry.getInstance(id)!.crepe as FireCrepe).fireMarkdownUpdated(md);
    await vi.advanceTimersByTimeAsync(300);
  }

  /**
   * 打开文件并挂载实例 + 经 02 会话置脏（真实单一事件源链路：
   * session.markDirty → onDirtyChange → store.markDirty——直改 store 会使
   * 保存后的 markSaved 广播无法清脏，复核聚合会把假脏标签拉回新轮次）。
   * @param dirty 是否置脏（复核聚合用例需要「聚合时干净」的对照标签时传 false）
   */
  async function openDirtyFile(
    path: string,
    title: string,
    id: string,
    dirty = true,
  ): Promise<void> {
    await tabs.openFile(path, title);
    tabs.onInstanceReady(id, { crepe: fakeCrepe(`# ${title}`), frontMatter: null });
    // 追踪激活过 autoSave 的标签：门面订阅不随 destroy 清理，残留运行态控制器
    // 会在后续用例的编辑事件中照常写盘（afterEach 统一停订，防跨用例断言污染）
    startedAutoSaveIds.push(id);
    if (dirty) registry.getInstance(id)!.session.markDirty();
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
    for (const id of startedAutoSaveIds) registry.getInstance(id)?.autoSave.stop();
    startedAutoSaveIds.length = 0;
    vi.useRealTimers();
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

  it("弹窗期 suspendAutoSave 生效：编辑事件经真实链路不写盘，取消恢复后同一链路照常落盘", async () => {
    vi.useFakeTimers();
    // 开自动保存：证明「不写盘」是暂停生效而非开关关闭（对照后半段恢复后落盘）
    mockLoadSettings.mockResolvedValue({
      autoSave: { enabled: true, timerMinutes: 5 },
      defaultLineEnding: "lf",
      launch: { mode: "new", customPath: "" },
    });
    await openDirtyFile("D:\\a\\b.md", "b.md", "tab-1");
    await machine.handleCloseRequest();
    expect(machine.phase.value).toBe("confirming");
    // 弹窗期键盘编辑：crepe → editor-events 防抖 → 门面分发 → autoSave——
    // 标脏订阅活跃（编辑不丢），但保存定时器挂起 → 停笔再久也零写盘
    await fireEdit("tab-1", "弹窗期编辑");
    await vi.advanceTimersByTimeAsync(1000);
    expect(mockWriteFile).not.toHaveBeenCalled();
    // 取消：恢复自动保存；同一编辑链路立即恢复写盘能力（证明暂停是唯一阻断因素）
    machine.cancel();
    expect(machine.phase.value).toBe("cancelled");
    await fireEdit("tab-1", "恢复后编辑");
    await vi.advanceTimersByTimeAsync(1000);
    expect(mockWriteFile).toHaveBeenCalledTimes(1);
  });

  it("全部保存成功后复核：弹窗期经 markdownUpdated 编辑变脏的标签开启新一轮确认", async () => {
    vi.useFakeTimers();
    await openDirtyFile("D:\\a\\b.md", "b.md", "tab-1"); // 冻结列表：仅 b.md
    await openDirtyFile("D:\\a\\c.md", "c.md", "tab-2", false); // 聚合时干净（激活中）
    await machine.handleCloseRequest();
    expect(machine.dirtyTabs.value.map((t) => t.title)).toEqual(["b.md"]);
    // 弹窗期对激活标签 c.md 键盘编辑——标脏订阅活跃（双通道修复后生产可达），
    // 经真实防抖链路置脏；保存定时器挂起不写盘
    await fireEdit("tab-2", "弹窗期新编辑");
    expect(tabs.store.tabs.find((t) => t.id === "tab-2")!.dirty).toBe(true);
    expect(mockWriteFile).not.toHaveBeenCalled();
    await machine.saveAll(); // 仅写冻结列表 b.md
    // b.md 保存成功（脏标记清除），复核发现弹窗期新变脏的 c.md → 新一轮确认，
    // 不静默关窗（防 c.md 内容随 destroy 丢失）
    expect(mockWriteFile).toHaveBeenCalledTimes(1);
    expect(mockCloseWindow).not.toHaveBeenCalled();
    expect(machine.phase.value).toBe("confirming");
    expect(machine.dirtyTabs.value.map((t) => t.title)).toEqual(["c.md"]);
  });

  it("全部不保存复核排除累计放弃集：新变脏标签确认后放弃即关窗（防复核死循环）", async () => {
    vi.useFakeTimers();
    await openDirtyFile("D:\\a\\b.md", "b.md", "tab-1");
    await openDirtyFile("D:\\a\\c.md", "c.md", "tab-2", false); // 聚合时干净
    await machine.handleCloseRequest(); // 冻结 [b.md]
    await fireEdit("tab-2"); // 弹窗期 c.md 变脏
    await machine.discardAll(); // b.md 显式放弃 → 复核发现 c.md → 新一轮
    expect(machine.phase.value).toBe("confirming");
    expect(machine.dirtyTabs.value.map((t) => t.title)).toEqual(["c.md"]);
    expect(mockCloseWindow).not.toHaveBeenCalled();
    // 再次放弃 c.md：b.md 已在累计放弃集内不得回弹（否则两轮互相踢皮球永不退出）
    await machine.discardAll();
    expect(mockCloseWindow).toHaveBeenCalledTimes(1);
    expect(machine.phase.value).toBe("closing");
  });

  it("真实链路写盘失败：窗口保持且弹窗复显失败原因，改选全部不保存完成退出", async () => {
    // 02 会话错误经 onNotice 桥接 console（04 装配无用户可见通知）——静默之
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { FileIoError } = await import("../../services/file-io");
    mockWriteFile.mockRejectedValue(new FileIoError("磁盘已满，写入失败"));
    await openDirtyFile("D:\\a\\b.md", "b.md", "tab-1");
    await machine.handleCloseRequest();
    await machine.saveAll();
    // 失败用户可见反馈：不关窗（窗口保持）、回确认态复显弹窗、错误区携带失败原因、
    // 失败标签保持脏态留在窗口
    expect(mockCloseWindow).not.toHaveBeenCalled();
    expect(machine.phase.value).toBe("confirming");
    expect(machine.failMessage.value).toContain("磁盘已满");
    expect(tabs.store.tabs[0]!.dirty).toBe(true);
    // 用户改选「全部不保存」：放弃失败标签完成退出（复核排除已放弃标签正常关窗）
    await machine.discardAll();
    expect(mockCloseWindow).toHaveBeenCalledTimes(1);
    expect(machine.phase.value).toBe("closing");
  });
});
