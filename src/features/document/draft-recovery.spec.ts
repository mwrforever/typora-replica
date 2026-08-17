// 草稿备份与恢复测试（02 文档管理，F31；Task 14 04 聚合改造）
//
// 覆盖：命名提取（首标题→首非空行→清洗截断）、心跳 5s 防抖写草稿、
// 提供器空列表跳过、空内容不产生草稿、退出备份、列表透传、恢复读内容、
// 04 聚合：多脏标签各自备份 / 全空白跳过 / 未命名首句命名 / 单标签失败不阻断其余。
// 使用 fake timers 驱动心跳定时器；file-io 以 mock 隔离。
// 构造为「脏标签快照提供器」形态（D1 裁决：备份聚合全部脏标签，
// 脏过滤/内容序列化由装配方提供器负责，本模块只管遍历写盘）。
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const mockSaveDraft = vi.fn();
const mockListDrafts = vi.fn();
const mockRecoverDraft = vi.fn();
const mockSubscribe = vi.fn();

vi.mock("../../services/file-io", () => ({
  saveDraft: (...a: unknown[]) => mockSaveDraft(...a),
  listDrafts: (...a: unknown[]) => mockListDrafts(...a),
  recoverDraft: (...a: unknown[]) => mockRecoverDraft(...a),
}));

import { DraftRecovery, extractDraftName, HEARTBEAT_MS } from "./draft-recovery";

describe("草稿备份与恢复（F31）", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockSaveDraft.mockReset().mockResolvedValue("C:/drafts/2026-08-15-x.md");
    mockListDrafts.mockReset().mockResolvedValue([]);
    mockRecoverDraft.mockReset().mockResolvedValue({
      content: "恢复内容",
      encoding: "utf8",
      lineEnding: "lf",
    });
    mockSubscribe.mockReset().mockReturnValue(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("extractDraftName：首标题优先（AC-F31-2）", () => {
    expect(extractDraftName("# 我的标题\n正文")).toBe("我的标题");
    expect(extractDraftName("## 二级标题")).toBe("二级标题");
    expect(extractDraftName("普通首行\n第二行")).toBe("普通首行");
    expect(extractDraftName("\n\n正文在第三行")).toBe("正文在第三行");
    expect(extractDraftName("")).toBe("未命名");
    expect(extractDraftName('a/b\\c:*?"<>|'.repeat(10))).toHaveLength(30);
  });

  it("心跳：编辑后 5s 写草稿（与自动保存开关无关）", async () => {
    const d = new DraftRecovery(() => [{ path: "C:/a.md", content: "草稿内容" }]);
    d.start(mockSubscribe);
    const emitted = mockSubscribe.mock.calls[0]?.[0] as (md: string) => void;
    emitted?.("内容");
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
    expect(mockSaveDraft).toHaveBeenCalledWith("a.md", "草稿内容");
    d.stop();
  });

  it("心跳防抖：持续编辑重置 5s 窗口，末次编辑后仅写一次", async () => {
    const d = new DraftRecovery(() => [{ path: "C:/a.md", content: "草稿内容" }]);
    d.start(mockSubscribe);
    const emitted = mockSubscribe.mock.calls[0]?.[0] as (md: string) => void;
    emitted?.("第一次编辑");
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS - 1);
    emitted?.("持续编辑"); // 窗口内再编辑：清空旧心跳定时器并重排（防抖语义）
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS - 1);
    expect(mockSaveDraft).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2);
    expect(mockSaveDraft).toHaveBeenCalledTimes(1);
    expect(mockSaveDraft).toHaveBeenCalledWith("a.md", "草稿内容");
    d.stop();
  });

  it("setupExitBackup 幂等：重复挂载只注册一次", () => {
    const d = new DraftRecovery(() => [{ path: "C:/a.md", content: "草稿内容" }]);
    let registerCount = 0;
    const registrar = () => {
      registerCount += 1;
    };
    d.setupExitBackup(registrar);
    d.setupExitBackup(registrar); // 重复挂载为 no-op（防多装配叠加备份）
    expect(registerCount).toBe(1);
  });

  it("备份失败静默降级：saveDraft 拒绝不抛错（不打断编辑）", async () => {
    mockSaveDraft.mockRejectedValue(new Error("磁盘错误"));
    const d = new DraftRecovery(() => [{ path: "C:/a.md", content: "草稿内容" }]);
    await expect(d.backupIfNeeded()).resolves.toBeUndefined();
    expect(mockSaveDraft).toHaveBeenCalledWith("a.md", "草稿内容");
  });

  it("备份文件名：路径无分隔符时整体作为文件名", async () => {
    const d = new DraftRecovery(() => [{ path: "a.md", content: "草稿内容" }]);
    await d.backupIfNeeded();
    expect(mockSaveDraft).toHaveBeenCalledWith("a.md", "草稿内容");
  });

  it("无脏标签（提供器返回空列表）跳过备份", async () => {
    const d = new DraftRecovery(() => []);
    await d.backupIfNeeded();
    expect(mockSaveDraft).not.toHaveBeenCalled();
  });

  it("空内容不产生草稿（AC-F31-5）", async () => {
    const d = new DraftRecovery(() => [{ path: "C:/a.md", content: "\n\n" }]);
    await d.backupIfNeeded();
    expect(mockSaveDraft).not.toHaveBeenCalled();
  });

  it("未命名文档以首标题命名备份（AC-F31-2）", async () => {
    const d = new DraftRecovery(() => [{ content: "# 未存标题\n正文" }]);
    await d.backupIfNeeded();
    expect(mockSaveDraft).toHaveBeenCalledWith("未存标题", "# 未存标题\n正文");
  });

  it("setupExitBackup：退出回调触发备份（正常退出也留，AC-F31-4）", async () => {
    const d = new DraftRecovery(() => [{ path: "C:/a.md", content: "草稿内容" }]);
    let handler: (() => Promise<void>) | undefined;
    d.setupExitBackup((h) => {
      handler = h;
    });
    await handler!();
    expect(mockSaveDraft).toHaveBeenCalledWith("a.md", "草稿内容");
  });

  it("聚合：多个脏标签各自备份，全空白跳过、未命名按首句命名（04 多标签）", async () => {
    const d = new DraftRecovery(() => [
      { path: "D:\\a\\b.md", content: "B 内容" },
      { path: "D:\\a\\c.md", content: "C 内容" },
      { content: "Untitled 标题内容" },
      { path: "D:\\a\\d.md", content: "   " }, // 全空白跳过（AC-F31-5）
    ]);
    await d.backupIfNeeded();
    expect(mockSaveDraft).toHaveBeenCalledTimes(3);
    expect(mockSaveDraft).toHaveBeenCalledWith("b.md", "B 内容");
    expect(mockSaveDraft).toHaveBeenCalledWith("c.md", "C 内容");
    // 未命名 → 首标题/首句命名
    expect(mockSaveDraft.mock.calls[2][0]).toBe("Untitled 标题内容");
  });

  it("聚合：单标签写失败不阻断其余备份", async () => {
    mockSaveDraft
      .mockRejectedValueOnce(new Error("磁盘错误"))
      .mockResolvedValue("C:/drafts/2026-08-15-x.md");
    const d = new DraftRecovery(() => [
      { path: "D:\\a\\bad.md", content: "失败内容" },
      { path: "D:\\a\\ok.md", content: "成功内容" },
    ]);
    await expect(d.backupIfNeeded()).resolves.toBeUndefined();
    expect(mockSaveDraft).toHaveBeenCalledTimes(2);
    expect(mockSaveDraft).toHaveBeenCalledWith("ok.md", "成功内容");
  });

  it("listRecoverable 透传草稿列表（AC-F31-3）", async () => {
    const drafts = [{ path: "C:/d/2026-08-15-x.md", name: "2026-08-15-x.md", date: "2026-08-15" }];
    mockListDrafts.mockResolvedValue(drafts);
    const d = new DraftRecovery(() => []);
    expect(await d.listRecoverable()).toEqual(drafts);
  });

  it("recover 读草稿内容（打开由调用方 session.openFile 执行）", async () => {
    const d = new DraftRecovery(() => []);
    expect(await d.recover("2026-08-15-x.md")).toBe("恢复内容");
    expect(mockRecoverDraft).toHaveBeenCalledWith("2026-08-15-x.md");
  });
});
