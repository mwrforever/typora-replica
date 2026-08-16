import { describe, expect, it, vi, beforeEach } from "vitest";

const mockReadFile = vi.fn();
const mockWriteFile = vi.fn();
const mockLoadSettings = vi.fn();
const mockUpdateSettings = vi.fn();
const mockGetMarkdown = vi.fn();
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
vi.mock("../editor/editor-manager", () => ({
  editorManager: { getMarkdown: (...a: unknown[]) => mockGetMarkdown(...a) },
}));
vi.mock("../../services/recent-files", () => ({
  // 同构导出 RecentFiles 类：record 委托 mock（document-session 用 new + .catch 消费）
  RecentFiles: class {
    record = (...a: unknown[]) => mockRecord(...a);
  },
}));

import { FileIoError } from "../../services/file-io";
import { DocumentSession } from "./document-session";

describe("文档会话（打开/保存/dirty）", () => {
  beforeEach(() => {
    mockReadFile.mockReset();
    mockWriteFile.mockReset();
    mockLoadSettings.mockReset().mockResolvedValue({ defaultLineEnding: "lf" });
    mockUpdateSettings.mockReset().mockResolvedValue({});
    mockGetMarkdown.mockReset().mockReturnValue("正文");
    mockRecord.mockReset().mockResolvedValue(undefined);
  });

  it("openFile 读取并广播文档变更（父目录=当前目录）", async () => {
    const session = new DocumentSession();
    const docs: unknown[] = [];
    session.on({ onDocumentChange: (d) => docs.push(d) });
    mockReadFile.mockResolvedValue({ content: "你好", encoding: "utf8", lineEnding: "lf" });
    await session.openFile("C:/docs/sub/a.md");
    expect(session.currentPath).toBe("C:/docs/sub/a.md");
    expect(session.currentDir).toBe("C:/docs/sub");
    expect(session.dirty).toBe(false);
    expect(docs).toHaveLength(1);
    expect((docs[0] as { name: string }).name).toBe("a.md");
    // AC-F13-1：打开文件即记录最近文件（带完整路径）
    expect(mockRecord).toHaveBeenCalledWith("C:/docs/sub/a.md");
  });

  it("openFile 失败广播错误提示且不改当前文档", async () => {
    const session = new DocumentSession();
    const notices: unknown[] = [];
    session.on({ onNotice: (n) => notices.push(n) });
    mockReadFile.mockRejectedValue(new FileIoError("读取文件失败: 拒绝访问"));
    await session.openFile("C:/docs/bad.md");
    expect(notices).toHaveLength(1);
    expect((notices[0] as { level: string }).level).toBe("error");
    expect((notices[0] as { message: string }).message).toContain("拒绝访问");
    expect(session.currentPath).toBeUndefined();
    // 打开失败不记录最近文件（避免把打不开的路径塞进列表）
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it("save 成功：getMarkdown→补尾换行→写盘→dirty 清除", async () => {
    const session = new DocumentSession();
    session.dirty = true;
    session.currentPath = "C:/docs/a.md";
    mockGetMarkdown.mockReturnValue("正文");
    mockWriteFile.mockResolvedValue(undefined);
    const dirtyLog: boolean[] = [];
    session.on({ onDirtyChange: (d) => dirtyLog.push(d) });
    const out = await session.save();
    expect(out).toEqual({ saved: true, path: "C:/docs/a.md" });
    // 落盘内容 = 正文 + 尾换行（LF 目标）
    expect(mockWriteFile).toHaveBeenCalledWith("C:/docs/a.md", "正文\n", "lf");
    expect(session.dirty).toBe(false);
    expect(dirtyLog).toEqual([false]);
  });

  it("save 未命名文档返回 no-path 且不写盘", async () => {
    const session = new DocumentSession();
    session.dirty = true;
    const out = await session.save();
    expect(out).toEqual({ saved: false, reason: "no-path", message: expect.any(String) });
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it("save 写盘失败返回 io-error 且 dirty 保持（AC-F30-5）", async () => {
    const session = new DocumentSession();
    session.dirty = true;
    session.currentPath = "C:/docs/a.md";
    mockWriteFile.mockRejectedValue(new FileIoError("写入失败: 磁盘只读"));
    const out = await session.save();
    expect(out).toEqual({ saved: false, reason: "io-error", message: expect.any(String) });
    expect(session.dirty).toBe(true);
  });

  it("BUG-1 并发 save 串行化：后写排队等待先写完成（rename 不乱序覆盖）", async () => {
    const session = new DocumentSession();
    session.dirty = true;
    session.currentPath = "C:/docs/a.md";
    mockGetMarkdown.mockReturnValue("正文");
    // 第一次写盘挂起：第二个 save 必须排队，不得并发发起第二次 writeFile
    let releaseFirst!: () => void;
    mockWriteFile
      .mockImplementationOnce(() => new Promise<void>((resolve) => (releaseFirst = resolve)))
      .mockResolvedValue(undefined);
    const order: string[] = [];
    const p1 = session.save().then((o) => {
      order.push("first");
      return o;
    });
    const p2 = session.save().then((o) => {
      order.push("second");
      return o;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockWriteFile).toHaveBeenCalledTimes(1); // 第二个 save 排队中（未发起写盘）
    releaseFirst();
    const [o1, o2] = await Promise.all([p1, p2]);
    expect(o1).toMatchObject({ saved: true });
    expect(o2).toMatchObject({ saved: true });
    expect(mockWriteFile).toHaveBeenCalledTimes(2);
    // 先写先完成（串行不交错）
    expect(order).toEqual(["first", "second"]);
  });

  it("BUG-1 串行链上前置 save 失败不阻断后续 save", async () => {
    const session = new DocumentSession();
    session.dirty = true;
    session.currentPath = "C:/docs/a.md";
    mockGetMarkdown.mockReturnValue("正文");
    mockWriteFile
      .mockRejectedValueOnce(new FileIoError("写入失败: 磁盘只读"))
      .mockResolvedValue(undefined);
    const o1 = await session.save();
    expect(o1.saved).toBe(false); // 前置失败
    const o2 = await session.save();
    expect(o2.saved).toBe(true); // 后续排队不受影响（链未中断）
  });

  it("BUG-1 doSave 抛出未捕获异常不毒化串行链（onRejected 兜底）", async () => {
    const session = new DocumentSession();
    session.dirty = true;
    session.currentPath = "C:/docs/a.md";
    // 序列化阶段抛错（getMarkdown 在 try 之外）：doSave 直接 reject
    mockGetMarkdown.mockImplementationOnce(() => {
      throw new Error("序列化失败");
    });
    const p1 = session.save();
    await expect(p1).rejects.toThrow("序列化失败");
    // 链上异常被 saveChain 的 onRejected 吞掉：后续 save 正常执行
    mockGetMarkdown.mockReturnValue("正文");
    mockWriteFile.mockResolvedValue(undefined);
    await expect(session.save()).resolves.toMatchObject({ saved: true });
  });

  it("saveAs 设置新路径后保存并记录 lastFile", async () => {
    const session = new DocumentSession();
    session.dirty = true;
    session.currentDir = "C:/docs";
    mockWriteFile.mockResolvedValue(undefined);
    mockUpdateSettings.mockResolvedValue({});
    const out = await session.saveAs("C:/docs/b.md");
    expect(out).toEqual({ saved: true, path: "C:/docs/b.md" });
    expect(session.currentPath).toBe("C:/docs/b.md");
    expect(mockUpdateSettings).toHaveBeenCalledWith({
      launch: { lastFile: "C:/docs/b.md", lastFolder: "C:/docs" },
    });
    // 另存成功记录最近文件（F13 链路：新路径进入最近列表）
    expect(mockRecord).toHaveBeenCalledWith("C:/docs/b.md");
  });

  it("newDocument 复位路径与脏状态并广播空文档", async () => {
    const session = new DocumentSession();
    session.currentPath = "C:/docs/a.md";
    session.dirty = true;
    const docs: unknown[] = [];
    session.on({ onDocumentChange: (d) => docs.push(d) });
    session.newDocument();
    expect(session.currentPath).toBeUndefined();
    expect(session.dirty).toBe(false);
    expect(docs[0]).toMatchObject({ content: "", name: "未命名" });
  });

  it("markDirty 只广播一次（幂等）", () => {
    const session = new DocumentSession();
    const dirtyLog: boolean[] = [];
    session.on({ onDirtyChange: (d) => dirtyLog.push(d) });
    session.markDirty();
    session.markDirty();
    expect(dirtyLog).toEqual([true]);
  });

  it("openFolder 更新当前目录并记录 lastFolder", async () => {
    const session = new DocumentSession();
    mockUpdateSettings.mockResolvedValue({});
    await session.openFolder("C:/docs");
    expect(session.currentDir).toBe("C:/docs");
    expect(mockUpdateSettings).toHaveBeenCalledWith({ launch: { lastFolder: "C:/docs" } });
    // F13 语义：文件夹同样记录最近（侧栏/最近列表可重入）
    expect(mockRecord).toHaveBeenCalledWith("C:/docs");
  });

  // —— 以下为 100% 覆盖补足的业务语义用例（边界与容错，非凑数）——

  it("openFile 相对路径（无分隔符）时父目录为 undefined、文件名即路径", async () => {
    const session = new DocumentSession();
    const docs: unknown[] = [];
    session.on({ onDocumentChange: (d) => docs.push(d) });
    mockReadFile.mockResolvedValue({ content: "x", encoding: "utf8", lineEnding: "lf" });
    await session.openFile("a.md");
    expect(session.currentDir).toBeUndefined();
    expect((docs[0] as { name: string }).name).toBe("a.md");
  });

  it("openFile 非文件 IO 异常广播通用错误提示", async () => {
    const session = new DocumentSession();
    const notices: unknown[] = [];
    session.on({ onNotice: (n) => notices.push(n) });
    mockReadFile.mockRejectedValue(new Error("未知故障"));
    await session.openFile("C:/docs/x.md");
    expect(notices).toHaveLength(1);
    expect((notices[0] as { message: string }).message).toBe("打开文件失败");
    expect(session.currentPath).toBeUndefined();
  });

  it("openFile 偏好持久化失败不阻断文档打开", async () => {
    const session = new DocumentSession();
    const docs: unknown[] = [];
    session.on({ onDocumentChange: (d) => docs.push(d) });
    mockReadFile.mockResolvedValue({ content: "你好", encoding: "utf8", lineEnding: "lf" });
    mockUpdateSettings.mockRejectedValue(new Error("store 写入失败"));
    await session.openFile("C:/docs/a.md");
    expect(docs).toHaveLength(1);
    expect(session.currentPath).toBe("C:/docs/a.md");
  });

  it("openFile 等待自身 updateSettings 完成后再继续（F 修复：启动期偏好写回串行）", async () => {
    const session = new DocumentSession();
    session.on({ onDocumentChange: () => undefined });
    mockReadFile.mockResolvedValue({ content: "你好", encoding: "utf8", lineEnding: "lf" });
    // 挂起 updateSettings：验证 openFile 等待其完成，避免与后续写回交错覆盖
    let resolveUpdate!: () => void;
    mockUpdateSettings.mockImplementation(
      () => new Promise<void>((resolve) => (resolveUpdate = resolve)),
    );
    const opening = session.openFile("C:/docs/a.md");
    // openFile 已发起 updateSettings（挂起）：recordRecent 必须尚未执行
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockRecord).not.toHaveBeenCalled();
    resolveUpdate();
    await opening;
    expect(mockRecord).toHaveBeenCalledWith("C:/docs/a.md");
  });

  it("save 偏好读取失败回落默认 LF 仍成功保存", async () => {
    const session = new DocumentSession();
    session.dirty = true;
    session.currentPath = "C:/docs/a.md";
    mockLoadSettings.mockRejectedValue(new Error("store 读取失败"));
    mockWriteFile.mockResolvedValue(undefined);
    const out = await session.save();
    expect(out).toEqual({ saved: true, path: "C:/docs/a.md" });
    expect(mockWriteFile).toHaveBeenCalledWith("C:/docs/a.md", "正文\n", "lf");
    expect(session.dirty).toBe(false);
  });

  it("save 偏好 CRLF 时落盘内容归一 CRLF", async () => {
    const session = new DocumentSession();
    session.currentPath = "C:/docs/a.md";
    mockLoadSettings.mockResolvedValue({ defaultLineEnding: "crlf" });
    mockWriteFile.mockResolvedValue(undefined);
    const out = await session.save();
    expect(out).toEqual({ saved: true, path: "C:/docs/a.md" });
    expect(mockWriteFile).toHaveBeenCalledWith("C:/docs/a.md", "正文\r\n", "crlf");
  });

  it("save 未知异常返回 io-error 且提示通用消息", async () => {
    const session = new DocumentSession();
    session.dirty = true;
    session.currentPath = "C:/docs/a.md";
    mockWriteFile.mockRejectedValue(new Error("未知故障"));
    const out = await session.save();
    expect(out).toEqual({ saved: false, reason: "io-error", message: "写盘失败" });
    expect(session.dirty).toBe(true);
  });

  it("markSaved 未脏时不广播（幂等）", () => {
    const session = new DocumentSession();
    const dirtyLog: boolean[] = [];
    session.on({ onDirtyChange: (d) => dirtyLog.push(d) });
    session.markSaved();
    expect(session.dirty).toBe(false);
    expect(dirtyLog).toEqual([]);
  });

  it("openFolder 偏好持久化失败不阻断目录切换", async () => {
    const session = new DocumentSession();
    mockUpdateSettings.mockRejectedValue(new Error("store 写入失败"));
    await session.openFolder("C:/docs");
    expect(session.currentDir).toBe("C:/docs");
  });

  it("saveAs 偏好持久化失败仍完成保存", async () => {
    const session = new DocumentSession();
    session.dirty = true;
    mockUpdateSettings.mockRejectedValue(new Error("store 写入失败"));
    mockWriteFile.mockResolvedValue(undefined);
    const out = await session.saveAs("C:/docs/b.md");
    expect(out).toEqual({ saved: true, path: "C:/docs/b.md" });
    expect(session.currentPath).toBe("C:/docs/b.md");
  });

  it("最近文件记录失败静默不阻断打开（与 updateSettings 同构）", async () => {
    const session = new DocumentSession();
    const docs: unknown[] = [];
    session.on({ onDocumentChange: (d) => docs.push(d) });
    mockReadFile.mockResolvedValue({ content: "你好", encoding: "utf8", lineEnding: "lf" });
    mockRecord.mockRejectedValue(new Error("store 写入失败"));
    await session.openFile("C:/docs/a.md");
    // 记录失败被吞掉，文档打开链路不受影响
    expect(docs).toHaveLength(1);
    expect(session.currentPath).toBe("C:/docs/a.md");
    expect(mockRecord).toHaveBeenCalledWith("C:/docs/a.md");
  });

  it("saveAs 写盘失败不记录最近文件（列表不含未写盘路径）", async () => {
    const session = new DocumentSession();
    session.dirty = true;
    mockWriteFile.mockRejectedValue(new FileIoError("写入失败: 磁盘只读"));
    const out = await session.saveAs("C:/docs/b.md");
    expect(out).toEqual({ saved: false, reason: "io-error", message: expect.any(String) });
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it("save 进行中切换文档：放弃写盘不落错文件（B 修复）", async () => {
    const session = new DocumentSession();
    session.dirty = true;
    session.currentPath = "C:/docs/a.md";
    // 挂起 loadSettings：save 在 await 处等待（该窗口内文档可被切换）
    let resolveLoad!: (v: { defaultLineEnding: string }) => void;
    mockLoadSettings.mockImplementation(
      () => new Promise<{ defaultLineEnding: string }>((resolve) => (resolveLoad = resolve)),
    );
    const saving = session.save();
    // BUG-1 串行化后 save 经链式微任务启动：让位一个微任务使 doSave 进入 await loadSettings
    await Promise.resolve();
    // save 已进入 await loadSettings：此时打开 B（路径+版本变化、脏状态清除）
    session.currentPath = "C:/docs/b.md";
    session.dirty = false;
    session.docVersion += 1;
    resolveLoad({ defaultLineEnding: "lf" });
    const out = await saving;
    // 类型收窄断言：联合类型中 reason 仅存在于 saved=false 分支（vue-tsc 门禁）
    expect(out).toEqual({ saved: false, reason: "doc-switched", message: expect.any(String) });
    // 不得把 A 的内容写入 B
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it("writeFile 进行中 markDirty：写盘完成后脏标记保留（C 修复）", async () => {
    const session = new DocumentSession();
    session.dirty = true;
    session.currentPath = "C:/docs/a.md";
    // 挂起 writeFile：模拟大文档/慢盘写盘耗时
    let resolveWrite!: () => void;
    mockWriteFile.mockImplementation(
      () => new Promise<void>((resolve) => (resolveWrite = resolve)),
    );
    const saving = session.save();
    // 等待 save 推进到 writeFile 挂起（loadSettings().catch() 链需多个微任务，
    // 用宏任务确保其后执行），此后写盘进行中
    await new Promise((resolve) => setTimeout(resolve, 0));
    session.markDirty();
    resolveWrite();
    const out = await saving;
    // 旧内容已写盘成功，但新编辑未落盘 → 脏标记必须保留
    expect(out).toEqual({ saved: true, path: "C:/docs/a.md" });
    expect(session.dirty).toBe(true);
  });

  // —— 04 多标签改造（Task 8）：serialize 注入 + restore（后台标签保存正确性）——

  it("serialize 注入：保存内容来自注入器而非门面（04 后台标签保存正确性）", async () => {
    const session = new DocumentSession({ serialize: () => "注入的B内容" });
    session.on({});
    // 直接登记后台标签路径后保存：内容必须来自本实例注入器
    session.currentPath = "D:\\b.md";
    mockWriteFile.mockResolvedValue(undefined);
    await session.save();
    expect(mockWriteFile).toHaveBeenCalledWith(
      "D:\\b.md",
      expect.stringContaining("注入的B内容"),
      "lf",
    );
    // 注入器生效：门面序列化不得被调用（否则激活标签内容会写进后台文件）
    expect(mockGetMarkdown).not.toHaveBeenCalled();
  });

  it("restore：登记路径/目录/脏状态并广播，不读盘不写偏好（04 重开脏快照）", async () => {
    const session = new DocumentSession();
    const docs: Array<{ content: string; path?: string; name: string }> = [];
    session.on({ onDocumentChange: (d) => docs.push(d) });
    session.restore("D:\\a\\b.md", "快照内容", "b.md", true);
    expect(session.currentPath).toBe("D:\\a\\b.md");
    // 父目录联动侧栏（与 openFile 语义一致）
    expect(session.currentDir).toBe("D:\\a");
    expect(session.dirty).toBe(true);
    expect(session.docVersion).toBe(1);
    expect(docs).toEqual([{ content: "快照内容", path: "D:\\a\\b.md", name: "b.md" }]);
    // restore 只登记不读盘、不写偏好（重开快照路径不得触发 IO）
    expect(mockReadFile).not.toHaveBeenCalled();
    expect(mockUpdateSettings).not.toHaveBeenCalled();
  });

  it("restore 无路径时目录不登记、dirty 透传（LRU 未命名标签重建）", () => {
    const session = new DocumentSession();
    const docs: string[] = [];
    session.on({ onDocumentChange: (d) => docs.push(d.content) });
    session.restore(undefined, "未命名内容", "未命名", false);
    expect(session.currentPath).toBeUndefined();
    expect(session.currentDir).toBeUndefined();
    expect(session.dirty).toBe(false);
    expect(docs).toEqual(["未命名内容"]);
  });
});
