// recent-files：最近文件（store 插件持久化）单元测试（隔离 Tauri 运行时，100% 覆盖）
import { beforeEach, describe, expect, it, vi } from "vitest";

// mock store 插件：内存 Map 模拟持久化。
// 注意：memory 必须经 vi.hoisted 创建——vi.mock 工厂在模块导入阶段（spec 顶层
// const 求值之前）即被调用，若引用普通顶层 const 会触发 TDZ 错误（vitest 已知约束）
const memory = vi.hoisted(() => new Map<string, unknown>());
vi.mock("@tauri-apps/plugin-store", () => ({
  load: vi.fn(async () => ({
    get: async (key: string) => memory.get(key),
    set: async (key: string, value: unknown) => {
      memory.set(key, value);
    },
  })),
}));

import { RecentFiles, MAX_RECENT } from "./recent-files";

describe("最近文件（F13）", () => {
  beforeEach(() => {
    memory.clear();
  });

  it("记录新文件后置顶（AC-F13-1）", async () => {
    const rf = new RecentFiles();
    await rf.record("C:/a.md");
    await rf.record("C:/b.md");
    const list = await rf.list();
    expect(list[0].path).toBe("C:/b.md");
    expect(list).toHaveLength(2);
  });

  it("重复记录去重并置顶（不膨胀）", async () => {
    const rf = new RecentFiles();
    await rf.record("C:/a.md");
    await rf.record("C:/b.md");
    await rf.record("C:/a.md");
    const list = await rf.list();
    expect(list).toHaveLength(2);
    expect(list[0].path).toBe("C:/a.md");
  });

  it("连续打开 12 个只保留 10 条（AC-F13-2）", async () => {
    const rf = new RecentFiles();
    for (let i = 1; i <= 12; i++) await rf.record(`C:/f${i}.md`);
    const list = await rf.list();
    expect(list).toHaveLength(MAX_RECENT);
    expect(list[0].path).toBe("C:/f12.md");
    expect(list[9].path).toBe("C:/f3.md"); // f1/f2 被挤出
  });

  it("clear 清除非固定项、固定项保留（AC-F13-3）", async () => {
    const rf = new RecentFiles();
    await rf.record("C:/a.md");
    await rf.record("C:/b.md");
    await rf.togglePin("C:/b.md");
    await rf.clear();
    const list = await rf.list();
    expect(list).toHaveLength(1);
    expect(list[0].path).toBe("C:/b.md");
    expect(list[0].pinned).toBe(true);
  });

  it("remove 移除条目（打开失败时调用，AC-F13-4）", async () => {
    const rf = new RecentFiles();
    await rf.record("C:/a.md");
    await rf.record("C:/b.md");
    await rf.remove("C:/a.md");
    const list = await rf.list();
    expect(list.map((f) => f.path)).toEqual(["C:/b.md"]);
  });

  it("重复记录已固定项时固定标记保留（不因再次打开丢失 pinned）", async () => {
    const rf = new RecentFiles();
    await rf.record("C:/a.md");
    await rf.togglePin("C:/a.md");
    await rf.record("C:/a.md");
    const list = await rf.list();
    expect(list).toHaveLength(1);
    expect(list[0].path).toBe("C:/a.md");
    expect(list[0].pinned).toBe(true);
  });

  it("存量键为非法类型时回落空列表（损坏存量不崩溃）", async () => {
    memory.set("recentFiles", "corrupted");
    const rf = new RecentFiles();
    expect(await rf.list()).toEqual([]);
    // 损坏存量回落空列表后仍可正常记录
    await rf.record("C:/a.md");
    expect(await rf.list()).toHaveLength(1);
  });
});
