// 最近位置服务单元测试（03 文件树，F9）
//
// 覆盖：去重置顶保留固定项（上限 10）/ 已固定条目再次记录置顶且 pinned 保留 /
// remove 删除指定条目（AC-F9-2/3/4）。store 插件以内存 Map 桩模拟持久化。
import { describe, expect, it, vi } from "vitest";
import { RecentLocations, MAX_RECENT_LOCATIONS } from "./recent-locations";
import { load } from "@tauri-apps/plugin-store";

vi.mock("@tauri-apps/plugin-store", () => ({ load: vi.fn() }));

/** 内存 store 桩（键值 Map，返回 data 供用例预置损坏存量） */
function mockStore(): {
  data: Map<string, unknown>;
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
} {
  const data = new Map<string, unknown>();
  const get = vi.fn(async (k: string) => data.get(k) ?? null);
  const set = vi.fn(async (k: string, v: unknown) => {
    data.set(k, v);
  });
  vi.mocked(load).mockResolvedValue({ get, set } as never);
  return { data, get, set };
}

describe("RecentLocations", () => {
  it("record 去重置顶并保留固定项（上限 10）", async () => {
    mockStore();
    const svc = new RecentLocations();
    for (let i = 1; i <= 12; i++) await svc.record(`C:/dir${i}`);
    const list = await svc.list();
    expect(list).toHaveLength(MAX_RECENT_LOCATIONS);
    expect(list[0].path).toBe("C:/dir12"); // 最近在前
    expect(list.some((l) => l.path === "C:/dir1")).toBe(false); // 最旧被挤出
  });

  it("record 已固定条目置顶且 pinned 保留", async () => {
    mockStore();
    const svc = new RecentLocations();
    await svc.record("C:/a");
    await svc.togglePin("C:/a");
    await svc.record("C:/b");
    await svc.record("C:/a"); // 再次打开：置顶且仍固定
    const list = await svc.list();
    expect(list[0]).toMatchObject({ path: "C:/a", pinned: true });
  });

  it("remove 删除指定条目（AC-F9-3）", async () => {
    mockStore();
    const svc = new RecentLocations();
    await svc.record("C:/a");
    await svc.remove("C:/a");
    expect(await svc.list()).toEqual([]);
  });

  it("togglePin 仅翻转目标条目（其余条目原样保留）", async () => {
    mockStore();
    const svc = new RecentLocations();
    await svc.record("C:/a");
    await svc.record("C:/b");
    await svc.togglePin("C:/b");
    const list = await svc.list();
    expect(list.find((l) => l.path === "C:/b")?.pinned).toBe(true);
    expect(list.find((l) => l.path === "C:/a")?.pinned).toBe(false);
  });

  it("存量键为非法类型时回落空列表（损坏存量不崩溃）", async () => {
    const { data } = mockStore();
    data.set("recentLocations", "corrupted");
    const svc = new RecentLocations();
    expect(await svc.list()).toEqual([]);
    // 损坏存量回落空列表后仍可正常记录
    await svc.record("C:/a");
    expect(await svc.list()).toHaveLength(1);
  });
});
