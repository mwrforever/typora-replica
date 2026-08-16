// 侧栏容器组件测试（03 文件树，F2 三面板切换）
//
// 覆盖：三面板切换渲染对应面板（默认文件树）/ 侧栏隐藏时不渲染面板 /
// ⋯ 菜单手动刷新触发 store.refresh。数据与刷新均走 store（file-io 已 mock）。
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
});
