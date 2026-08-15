// file-io：文件 IO 桥（Rust command 封装）单元测试（隔离 Tauri 运行时，100% 覆盖）
//
// 注：invoke 命令名以 Rust 侧实际注册名为准——save_draft/list_drafts/recover_draft
// 在 src-tauri 中的 #[tauri::command] 函数名带 _cmd 后缀，invoke 名即为 save_draft_cmd /
// list_drafts_cmd / recover_draft_cmd（与 brief 假设的 save_draft 等不同，见 task-8-report）。
import { beforeEach, describe, expect, it, vi } from "vitest";

// 统一 mock invoke：每个用例可覆写行为（jsdom 无 Tauri 运行时，invoke 不可用）
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import {
  readFile,
  writeFile,
  listDir,
  saveDraft,
  listDrafts,
  recoverDraft,
  getCliArgs,
  FileIoError,
} from "./file-io";

const mockInvoke = vi.mocked(invoke);

describe("file-io 桥（Rust command 封装）", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it("readFile 透传路径并返回探测结果", async () => {
    mockInvoke.mockResolvedValue({ content: "你好", encoding: "utf8", lineEnding: "lf" });
    const out = await readFile("C:/docs/a.md");
    expect(mockInvoke).toHaveBeenCalledWith("read_file", { path: "C:/docs/a.md" });
    expect(out.content).toBe("你好");
    expect(out.encoding).toBe("utf8");
  });

  it("writeFile 组装 opts 参数（camelCase）", async () => {
    mockInvoke.mockResolvedValue(undefined);
    await writeFile("a.md", "内容", "crlf");
    expect(mockInvoke).toHaveBeenCalledWith("write_file", {
      path: "a.md",
      content: "内容",
      opts: { lineEnding: "crlf" },
    });
  });

  it("listDir 无过滤时传 null（Rust Option）", async () => {
    mockInvoke.mockResolvedValue([]);
    await listDir("C:/docs");
    expect(mockInvoke).toHaveBeenCalledWith("list_dir", { path: "C:/docs", extFilter: null });
  });

  it("listDir 带扩展名过滤时透传（非 null 分支）", async () => {
    mockInvoke.mockResolvedValue([]);
    await listDir("C:/docs", "md");
    expect(mockInvoke).toHaveBeenCalledWith("list_dir", { path: "C:/docs", extFilter: "md" });
  });

  it("saveDraft 走注册名 save_draft_cmd 并返回实际保存路径", async () => {
    mockInvoke.mockResolvedValue("C:/data/drafts/2026-08-15-笔记.md");
    const saved = await saveDraft("笔记.md", "内容");
    // 命令名与 brief 假设（save_draft）不同：Rust 函数名即注册名，带 _cmd 后缀
    expect(mockInvoke).toHaveBeenCalledWith("save_draft_cmd", {
      fileName: "笔记.md",
      content: "内容",
    });
    expect(saved).toBe("C:/data/drafts/2026-08-15-笔记.md");
  });

  it("listDrafts 走注册名 list_drafts_cmd 并返回草稿条目", async () => {
    mockInvoke.mockResolvedValue([{ path: "p", name: "2026-08-15-a.md", date: "2026-08-15" }]);
    const drafts = await listDrafts();
    expect(mockInvoke).toHaveBeenCalledWith("list_drafts_cmd");
    expect(drafts[0].date).toBe("2026-08-15");
  });

  it("recoverDraft 走注册名 recover_draft_cmd 并返回解码结果", async () => {
    mockInvoke.mockResolvedValue({ content: "草稿内容", encoding: "utf8", lineEnding: "crlf" });
    const out = await recoverDraft("2026-08-15-a.md");
    expect(mockInvoke).toHaveBeenCalledWith("recover_draft_cmd", { fileName: "2026-08-15-a.md" });
    expect(out.lineEnding).toBe("crlf");
  });

  it("getCliArgs 返回结构化参数", async () => {
    mockInvoke.mockResolvedValue({ new: true, reopenFile: "a.md" });
    const args = await getCliArgs();
    expect(args.new).toBe(true);
    expect(args.reopenFile).toBe("a.md");
  });

  it("invoke 拒绝字符串错误时抛 FileIoError（中文消息透传）", async () => {
    mockInvoke.mockRejectedValue("读取文件失败: 拒绝访问");
    await expect(readFile("x")).rejects.toThrow(FileIoError);
    await expect(readFile("x")).rejects.toThrow("读取文件失败");
  });

  it("invoke 拒绝 Error 实例时取 message 包装为 FileIoError", async () => {
    mockInvoke.mockRejectedValue(new Error("写文件失败: 磁盘只读"));
    await expect(writeFile("x", "y", "lf")).rejects.toThrow(FileIoError);
    await expect(writeFile("x", "y", "lf")).rejects.toThrow("写文件失败");
  });

  it("invoke 拒绝非字符串/非 Error 时给通用中文消息", async () => {
    mockInvoke.mockRejectedValue({ code: 1 });
    await expect(listDrafts()).rejects.toThrow(FileIoError);
    await expect(listDrafts()).rejects.toThrow("未知文件 IO 错误");
  });
});
