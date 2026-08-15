import { describe, expect, it, vi } from "vitest";

const mockListDir = vi.fn();
vi.mock("../../services/file-io", () => ({
  listDir: (...a: unknown[]) => mockListDir(...a),
}));

import { buildQuickItems } from "./open-quickly";

describe("Open Quickly 数据源（F11-2）", () => {
  it("当前目录 .md 文件 + 最近文件合并去重", async () => {
    mockListDir.mockResolvedValue([
      { path: "C:/docs/a.md", name: "a.md", isDir: false, ext: "md" },
      { path: "C:/docs/notes/b.md", name: "notes/b.md", isDir: false, ext: "md" },
      { path: "C:/docs/notes", name: "notes", isDir: true, ext: "" },
    ]);
    const recent = [{ path: "C:/docs/a.md", pinned: true, openedAt: 1 }];
    const items = await buildQuickItems("C:/docs", recent);
    expect(items.map((i) => i.path)).toEqual([
      "C:/docs/a.md", // 最近文件（固定）在前
      "C:/docs/notes/b.md",
    ]);
    // 去重后仅一条 a.md（保留 pinned 标记）
    expect(items.filter((i) => i.path === "C:/docs/a.md")).toHaveLength(1);
    expect(items[0].pinned).toBe(true);
  });

  it("无当前目录时仅返回最近文件", async () => {
    mockListDir.mockReset();
    const recent = [{ path: "C:/x.md", pinned: false, openedAt: 1 }];
    const items = await buildQuickItems(undefined, recent);
    expect(items.map((i) => i.path)).toEqual(["C:/x.md"]);
  });

  it("listDir 失败时降级为仅最近文件（不崩溃）", async () => {
    mockListDir.mockRejectedValue(new Error("boom"));
    const recent = [{ path: "C:/x.md", pinned: false, openedAt: 1 }];
    const items = await buildQuickItems("C:/docs", recent);
    expect(items.map((i) => i.path)).toEqual(["C:/x.md"]);
  });

  it("最近文件内部去重 + 无分隔符文件名保留原样", async () => {
    mockListDir.mockReset();
    const recent = [
      { path: "x.md", pinned: false, openedAt: 2 },
      { path: "x.md", pinned: false, openedAt: 1 },
    ];
    const items = await buildQuickItems(undefined, recent);
    // 重复路径仅保留首条，label 取路径原名（无分隔符）
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ path: "x.md", label: "x.md", pinned: false });
  });
});
