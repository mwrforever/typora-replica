// file-io：文件 IO 桥（Rust command 封装）单元测试（隔离 Tauri 运行时，100% 覆盖）
//
// 注：invoke 命令名以 spec §5 锁定契约为准——草稿三命令 save_draft/list_drafts/
// recover_draft；Rust 侧函数名带 _cmd 后缀，经 #[tauri::command(rename = ...)]
// 对齐契约名（见 task-8-report 修复记录）。
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
  probePathExists,
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

  it("saveDraft 走契约名 save_draft 并返回实际保存路径", async () => {
    mockInvoke.mockResolvedValue("C:/data/drafts/2026-08-15-笔记.md");
    const saved = await saveDraft("笔记.md", "内容");
    // 契约名（spec §5）：Rust 侧 save_draft_cmd 经 rename 注册为 save_draft
    expect(mockInvoke).toHaveBeenCalledWith("save_draft", {
      fileName: "笔记.md",
      content: "内容",
    });
    expect(saved).toBe("C:/data/drafts/2026-08-15-笔记.md");
  });

  it("listDrafts 走契约名 list_drafts 并返回草稿条目", async () => {
    mockInvoke.mockResolvedValue([{ path: "p", name: "2026-08-15-a.md", date: "2026-08-15" }]);
    const drafts = await listDrafts();
    expect(mockInvoke).toHaveBeenCalledWith("list_drafts");
    expect(drafts[0].date).toBe("2026-08-15");
  });

  it("recoverDraft 走契约名 recover_draft 并返回解码结果", async () => {
    mockInvoke.mockResolvedValue({ content: "草稿内容", encoding: "utf8", lineEnding: "crlf" });
    const out = await recoverDraft("2026-08-15-a.md");
    expect(mockInvoke).toHaveBeenCalledWith("recover_draft", { fileName: "2026-08-15-a.md" });
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

  it("probePathExists 目录存在（listDir 成功）返回 true", async () => {
    mockInvoke.mockResolvedValue([]);
    await expect(probePathExists("C:/docs")).resolves.toBe(true);
    // 探测以 listDir 为首选：目录与文件均视为存在（read_file 对目录必失败）
    expect(mockInvoke).toHaveBeenCalledWith("list_dir", {
      path: "C:/docs",
      extFilter: null,
    });
  });

  it("probePathExists 文件存在（listDir 失败后 readFile 兜底成功）返回 true", async () => {
    mockInvoke.mockRejectedValueOnce("目录不存在或不可访问: 系统找不到指定的路径");
    mockInvoke.mockResolvedValueOnce({ content: "x", encoding: "utf8", lineEnding: "lf" });
    await expect(probePathExists("C:/docs/a.md")).resolves.toBe(true);
    expect(mockInvoke).toHaveBeenNthCalledWith(1, "list_dir", {
      path: "C:/docs/a.md",
      extFilter: null,
    });
    expect(mockInvoke).toHaveBeenNthCalledWith(2, "read_file", { path: "C:/docs/a.md" });
  });

  it("probePathExists 路径不存在（listDir 与 readFile 均失败）返回 false", async () => {
    mockInvoke.mockRejectedValueOnce("目录不存在或不可访问: 系统找不到指定的路径");
    mockInvoke.mockRejectedValueOnce("读取文件失败: 系统找不到指定的文件");
    await expect(probePathExists("C:/gone")).resolves.toBe(false);
  });
});
