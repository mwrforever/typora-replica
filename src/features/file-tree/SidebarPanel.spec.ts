// 侧栏容器组件测试（03 文件树，F2 三面板切换）
//
// 覆盖：三面板切换渲染对应面板（默认文件树）/ 侧栏隐藏时不渲染面板 /
// ⋯ 菜单手动刷新触发 store.refresh / recent 面板渲染与菜单入口。
// 数据与刷新均走 store（file-io 已 mock）；store 插件 mock 供最近位置面板
// onMounted 读取列表（内存 Map 桩）。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import SidebarPanel from "./SidebarPanel.vue";
import { useFileTreeStore } from "./file-tree-store";

// mock 服务层：面板组件不触达 invoke
vi.mock("../../services/file-io", () => ({
  listDirDetailed: vi.fn().mockResolvedValue([]),
  watchDir: vi.fn().mockResolvedValue(undefined),
}));

// mock store 插件：内存 Map 模拟持久化（vi.hoisted 规避 vi.mock 工厂 TDZ 约束，
// 与 services/recent-files.spec.ts 同款模式）
const memory = vi.hoisted(() => new Map<string, unknown>());
vi.mock("@tauri-apps/plugin-store", () => ({
  load: vi.fn(async () => ({
    get: async (key: string) => memory.get(key),
    set: async (key: string, value: unknown) => {
      memory.set(key, value);
    },
  })),
}));

describe("SidebarPanel", () => {
  beforeEach(() => setActivePinia(createPinia()));

  it("三面板切换渲染对应面板（默认文件树）", async () => {
    const store = useFileTreeStore();
    const wrapper = mount(SidebarPanel);
    expect(wrapper.find(".sidebar-panel__file-tree").exists()).toBe(true);
    store.switchPanel("list");
    await wrapper.vm.$nextTick();
    expect(wrapper.find(".sidebar-panel__file-list").exists()).toBe(true);
    store.switchPanel("outline");
    await wrapper.vm.$nextTick();
    expect(wrapper.find(".sidebar-panel__outline").exists()).toBe(true);
  });

  it("侧栏隐藏时不渲染面板", () => {
    const store = useFileTreeStore();
    store.toggleSidebar();
    const wrapper = mount(SidebarPanel);
    expect(wrapper.find(".sidebar-panel__body").exists()).toBe(false);
  });

  it("⋯ 菜单手动刷新触发 store.refresh", async () => {
    const store = useFileTreeStore();
    const refreshSpy = vi.spyOn(store, "refresh").mockResolvedValue(undefined);
    const wrapper = mount(SidebarPanel);
    await wrapper.find('[title="更多操作"]').trigger("click");
    const refreshButton = wrapper
      .findAll(".sidebar-panel__more button")
      .find((button) => button.text() === "手动刷新");
    expect(refreshButton).toBeDefined();
    await refreshButton!.trigger("click");
    expect(refreshSpy).toHaveBeenCalledTimes(1);
  });

  it("activePanel 为 recent 时渲染最近位置面板", async () => {
    const store = useFileTreeStore();
    const wrapper = mount(SidebarPanel);
    store.switchPanel("recent");
    await wrapper.vm.$nextTick();
    expect(wrapper.find(".sidebar-panel__recent").exists()).toBe(true);
  });

  it("⋯ 菜单「最近位置」入口切入 recent 面板", async () => {
    const store = useFileTreeStore();
    const wrapper = mount(SidebarPanel);
    await wrapper.find('[title="更多操作"]').trigger("click");
    const recentButton = wrapper
      .findAll(".sidebar-panel__more button")
      .find((button) => button.text() === "最近位置");
    expect(recentButton).toBeDefined();
    await recentButton!.trigger("click");
    expect(store.activePanel).toBe("recent");
    await wrapper.vm.$nextTick();
    expect(wrapper.find(".sidebar-panel__recent").exists()).toBe(true);
  });
});
