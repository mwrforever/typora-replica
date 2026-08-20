// C2 关闭流程集成测试（04：脏挂起/保存/不保存/取消/干净直关，AC-C2-1~5）
//
// 依赖 mock 策略（沿用 tabs-controller.spec.ts 手法）：mock 服务层
// file-io（readFile/writeFile 成功，FileIoError 同构导出供 save catch 判定）、
// settings（默认偏好，autoSave 关闭避免 5 分钟兜底定时器）、recent-files
// （saveAs 成功记录最近文件）、open-commands（saveAsDialog 受控——未命名
// 「保存」分支需对话框返回值）。编辑器实例注册表展开原模块（防御分支可经
// spy 注入）；DocumentSession/AutoSaveController/editorManager 真实构造。
// 控制器为模块级单例 → 动态 import 且逐项清理（含 closeRequest 挂起态）。
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Crepe } from "@milkdown/crepe";
import type { TabsController } from "./tabs-controller";

const mockReadFile = vi.fn();
const mockWriteFile = vi.fn();
const mockLoadSettings = vi.fn();
const mockUpdateSettings = vi.fn();
const mockRecord = vi.fn();
const mockSaveAsDialog = vi.fn();

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
vi.mock("../../services/open-commands", () => ({
  // saveAsDialog 受控 mock：未命名标签「保存」分支的对话框返回值可编程
  saveAsDialog: (...a: unknown[]) => mockSaveAsDialog(...a),
}));

/** fake crepe：adopt 经 setupEditorEvents 调 crepe.on；getMarkdownFor 调 getMarkdown */
function fakeCrepe(markdown = "正文"): Crepe {
  return { on: vi.fn(), getMarkdown: () => markdown } as unknown as Crepe;
}

let controller: TabsController;
let registry: typeof import("./editor-registry");

describe("C2 关闭流程（脏挂起/保存/不保存/取消）", () => {
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
    controller.closeRequest.value = undefined; // 挂起态不随 $reset，必须显式清
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
    mockSaveAsDialog.mockReset().mockResolvedValue(null);
    // 静默会话通知（onNotice 桥接 console，避免测试输出噪音）
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("脏标签关闭挂起确认；取消后标签保持（AC-C2-3）", async () => {
    await controller.openFile("D:\\a\\b.md", "b.md");
    // 模拟编辑置脏（session 事件桥：store.markDirty 由 onDirtyChange 驱动——
    // 直接经 store 置脏等价，单一事件源语义不在此用例范围）
    controller.store.markDirty(controller.store.activeTabId!);
    controller.closeTab(controller.store.activeTabId!);
    // 挂起而非关闭：closeRequest 携带标签标题供弹窗提示
    expect(controller.closeRequest.value?.title).toBe("b.md");
    expect(controller.store.tabs).toHaveLength(1);
    controller.cancelClose();
    // 取消：挂起清空，标签与内容不变（不触发关闭/序列化）
    expect(controller.closeRequest.value).toBeUndefined();
    expect(controller.store.tabs).toHaveLength(1);
    expect(controller.store.activeTabId).toBeDefined();
    expect(controller.store.closedStack).toHaveLength(0);
  });

  it("干净标签直接关闭不弹窗（AC-C2-4）", async () => {
    await controller.openFile("D:\\a\\b.md", "b.md");
    controller.closeTab(controller.store.activeTabId!);
    // 干净直关：不挂起确认，关闭内容入重开栈（未挂载无快照 → 空串兜底序列化）
    expect(controller.closeRequest.value).toBeUndefined();
    expect(controller.store.tabs).toHaveLength(1); // 末标签自动新建 → 1 个 Untitled
    expect(controller.store.tabs[0].kind).toBe("untitled");
    expect(controller.store.closedStack[0].content).toBe("");
  });

  it("不保存：丢弃变更关闭，重开可找回关闭前内容（AC-C2-3 + D4）", async () => {
    await controller.openFile("D:\\a\\b.md", "b.md");
    const id = controller.store.activeTabId!;
    // 挂载实例（未保存的编辑内容在实例侧，finalizeClose 按实例序列化）
    controller.onInstanceReady(id, { crepe: fakeCrepe("# 文档"), frontMatter: null });
    controller.store.markDirty(id);
    controller.closeTab(id);
    controller.confirmCloseDiscard();
    // 不保存：直接关闭，关闭前内容恒存重开栈（D4）
    expect(controller.closeRequest.value).toBeUndefined();
    expect(controller.store.tabs.every((t) => t.kind === "untitled")).toBe(true);
    expect(controller.store.closedStack[0].content).toBe("# 文档");
    controller.reopenClosed();
    const reopened = controller.store.tabs.find((t) => t.contentSnapshot === "# 文档");
    expect(reopened?.kind).toBe("file");
    expect(reopened?.path).toBe("D:\\a\\b.md");
  });

  it("保存：写盘成功后关闭（AC-C2-2）", async () => {
    await controller.openFile("D:\\a\\b.md", "b.md");
    controller.store.markDirty(controller.store.activeTabId!);
    controller.closeTab(controller.store.activeTabId!);
    await controller.confirmCloseSave();
    // 保存走 02 链路写盘成功 → 关闭（未挂载标签按快照兜底序列化入重开栈）
    expect(mockWriteFile).toHaveBeenCalled();
    expect(controller.closeRequest.value).toBeUndefined();
    expect(controller.store.tabs.every((t) => t.kind === "untitled")).toBe(true);
  });

  it("保存失败（io-error）：不关闭，标签保持打开（AC-C2-5）", async () => {
    await controller.openFile("D:\\a\\b.md", "b.md");
    controller.store.markDirty(controller.store.activeTabId!);
    controller.closeTab(controller.store.activeTabId!);
    // 写盘失败：02 广播错误 notice（console.error），finalize 不执行
    mockWriteFile.mockRejectedValueOnce(
      Object.assign(new Error("磁盘写入失败"), { name: "FileIoError" }),
    );
    await controller.confirmCloseSave();
    expect(controller.store.tabs).toHaveLength(1);
    expect(controller.store.tabs[0].kind).toBe("file"); // 标签保持打开
    expect(controller.store.tabs[0].dirty).toBe(true); // 内容未丢仍脏
    expect(controller.store.closedStack).toHaveLength(0);
  });

  it("未命名标签「保存」：另存为取消 → 中止，标签保持打开", async () => {
    controller.createUntitled();
    controller.store.markDirty(controller.store.activeTabId!);
    controller.closeTab(controller.store.activeTabId!);
    mockSaveAsDialog.mockResolvedValueOnce(null); // 对话框取消
    await controller.confirmCloseSave();
    // 取消等价中止：挂起已清（弹窗已关）无残留，标签与内容不变
    expect(controller.closeRequest.value).toBeUndefined();
    expect(controller.store.tabs).toHaveLength(1);
    expect(controller.store.tabs[0].kind).toBe("untitled");
    expect(controller.store.closedStack).toHaveLength(0);
  });

  it("未命名标签「保存」：另存为成功后写盘并关闭", async () => {
    controller.createUntitled();
    controller.store.markDirty(controller.store.activeTabId!);
    controller.closeTab(controller.store.activeTabId!);
    mockSaveAsDialog.mockResolvedValueOnce("D:\\a\\saved.md");
    await controller.confirmCloseSave();
    // 另存为路径 → 02 saveAs 写盘成功 → 关闭（内容入重开栈）
    expect(mockSaveAsDialog).toHaveBeenCalledTimes(1);
    expect(mockWriteFile).toHaveBeenCalled();
    expect(controller.store.tabs.every((t) => t.kind === "untitled")).toBe(true);
    expect(controller.store.closedStack[0].content).toBe("");
  });

  it("挂起期间重复关闭：陈旧挂起请求防御分支安全返回（上下文已失）", async () => {
    controller.createUntitled();
    const id = controller.store.activeTabId!;
    controller.store.markDirty(id);
    controller.closeTab(id);
    // 受控另存为：保存挂起期间用户再次 Ctrl+W → 二次挂起覆盖（弹窗态竞态）
    let resolveDialog!: (v: string) => void;
    mockSaveAsDialog.mockReturnValueOnce(
      new Promise<string>((resolve) => {
        resolveDialog = resolve;
      }),
    );
    const pending = controller.confirmCloseSave(); // 未命名 → await saveAsDialog 挂起
    controller.closeTab(id); // 挂起期间二次关闭：closeRequest 再次挂起同一标签
    expect(controller.closeRequest.value?.tabId).toBe(id);
    resolveDialog("D:\\a\\saved.md"); // 另存为确认 → 写盘成功 → 关闭 → 上下文已删
    await pending;
    // 陈旧挂起（标签已关/上下文已失）：confirm 回调经防御分支安全返回，不崩溃
    await controller.confirmCloseSave(); // 保存分支：req 在但上下文已失 → 安全返回
    controller.confirmCloseDiscard(); // 挂起已清（上一回调清空）→ 安全返回
    expect(controller.closeRequest.value).toBeUndefined();
    expect(controller.store.tabs.every((t) => t.kind === "untitled")).toBe(true);
  });

  it("无挂起请求或标签已移除：confirm 回调安全返回", async () => {
    controller.createUntitled();
    const id = controller.store.activeTabId!;
    controller.store.markDirty(id);
    // 无挂起请求（closeRequest 空）：三回调均安全 no-op
    controller.confirmCloseDiscard();
    await controller.confirmCloseSave();
    controller.cancelClose();
    expect(controller.store.tabs).toHaveLength(1);
    // 挂起后标签被移除（簿记与上下文脱节的防御边缘）：finalize 安全返回；
    // 末标签移除按 D3 自动新建 Untitled（无空态）
    controller.closeTab(id);
    expect(controller.closeRequest.value?.tabId).toBe(id);
    controller.store.removeTab(id);
    controller.confirmCloseDiscard();
    expect(controller.closeRequest.value).toBeUndefined();
    expect(controller.store.tabs).toHaveLength(1);
    expect(controller.store.tabs[0].kind).toBe("untitled");
  });
});
