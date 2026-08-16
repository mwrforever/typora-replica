// file-io：文件 IO 桥（Rust command 封装）单元测试（隔离 Tauri 运行时，100% 覆盖）
//
// 注：invoke 命令名以 spec §5 锁定契约为准——草稿三命令 save_draft/list_drafts/
// recover_draft；Rust 侧函数名带 _cmd 后缀，经 #[tauri::command(rename = ...)]
// 对齐契约名（见 task-8-report 修复记录）。
import { beforeEach, describe, expect, it, vi } from "vitest";

// 统一 mock invoke：每个用例可覆写行为（jsdom 无 Tauri 运行时，invoke 不可用）。
// 03 起同时 mock Channel：watchDir 封装在实现侧执行 new Channel()，工厂若只给 invoke，
// 构造器会取到 undefined 抛错；桩类提供可赋值的 onmessage 字段即可满足事件投递语义
//（类型断言走真实 core.d.ts 声明，与运行时桩互不影响）。
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  Channel: class Channel<T> {
    onmessage: ((ev: T) => void) | null = null;
  },
}));

import { Channel, invoke } from "@tauri-apps/api/core";
import {
  readFile,
  writeFile,
  listDir,
  saveDraft,
  listDrafts,
  recoverDraft,
  getCliArgs,
  probePathExists,
  createFile,
  createDir,
  renamePath,
  duplicatePath,
  deleteToTrash,
  listDirDetailed,
  watchDir,
  unwatchDir,
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

// 沿用既有 mock invoke 模式（文件顶部 vi.mock 已存在则复用）。
// 注：vitest 的 beforeEach 按 describe 作用域生效，上层 describe 的 reset 不覆盖本块，
// 若不在此重置，watchDir 用例写入的 mockImplementation 会泄漏到后续用例导致断言串扰
describe("03 文件树封装", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it("listDirDetailed 透传 opts 且返回条目", async () => {
    vi.mocked(invoke).mockResolvedValue([
      { path: "C:/a.md", name: "a.md", isDir: false, ext: "md", mtime: 1, ctime: 1 },
    ]);
    const out = await listDirDetailed("C:/dir", {
      extFilters: ["md"],
      hideHidden: true,
      sortBy: "mtime",
      direction: "desc",
      groupFolderFirst: true,
    });
    expect(invoke).toHaveBeenCalledWith("list_dir", {
      path: "C:/dir",
      extFilter: null,
      opts: {
        extFilters: ["md"],
        hideHidden: true,
        sortBy: "mtime",
        direction: "desc",
        groupFolderFirst: true,
      },
    });
    expect(out[0].name).toBe("a.md");
  });

  it("watchDir 创建 Channel 并投递批量事件（Rust 合并窗口契约）", async () => {
    let handler: ((ev: unknown) => void) | undefined;
    // args 声明为 unknown：tauri 的 InvokeArgs 联合含 Uint8Array/ArrayBuffer 等非 Record 形态，
    // 直接标 Record<string, unknown> 在 strict 下不可赋值给 invoke 形参（TS2345），收窄后取 channel
    vi.mocked(invoke).mockImplementation(async (cmd: string, args?: unknown) => {
      expect(cmd).toBe("watch_dir");
      handler = (args as { channel: Channel<unknown> }).channel.onmessage;
      return undefined;
    });
    const events: string[] = [];
    await watchDir("C:/dir", (evs) => events.push(...evs.map((ev) => ev.kind)));
    (handler as (ev: { kind: string; path: string }[]) => void)([
      { kind: "create", path: "C:/dir/x.md" },
      { kind: "modify", path: "C:/dir/y.md" },
    ]);
    expect(events).toEqual(["create", "modify"]);
  });

  it("unwatchDir 透传路径调用 unwatch_dir（停止旧目录监视）", async () => {
    mockInvoke.mockResolvedValue(undefined);
    await unwatchDir("C:/dir");
    expect(mockInvoke).toHaveBeenCalledWith("unwatch_dir", { path: "C:/dir" });
  });

  it("五命令封装调用对应 command", async () => {
    await createFile("C:/a.md");
    expect(invoke).toHaveBeenCalledWith("create_file", { path: "C:/a.md" });
    await createDir("C:/d");
    expect(invoke).toHaveBeenCalledWith("create_dir", { path: "C:/d" });
    await renamePath("C:/a.md", "C:/b.md");
    expect(invoke).toHaveBeenCalledWith("rename_path", { from: "C:/a.md", to: "C:/b.md" });
    await duplicatePath("C:/a.md", "C:/a copy.md");
    expect(invoke).toHaveBeenCalledWith("duplicate_path", { from: "C:/a.md", to: "C:/a copy.md" });
    await deleteToTrash("C:/a.md");
    expect(invoke).toHaveBeenCalledWith("delete_to_trash", { path: "C:/a.md" });
  });
});
