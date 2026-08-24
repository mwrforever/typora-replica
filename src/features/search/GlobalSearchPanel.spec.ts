// 全局搜索面板组件用例：global-reveal mock（定位链路已独立覆盖），store 真实 Pinia
import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";

const h = vi.hoisted(() => ({ revealGlobalMatch: vi.fn() }));
vi.mock("./global-reveal", () => ({
  revealGlobalMatch: (...a: unknown[]) => h.revealGlobalMatch(...a),
}));

import GlobalSearchPanel from "./GlobalSearchPanel.vue";
import { useSearchStore, type GlobalFileResult } from "./search-store";
import { useFileTreeStore } from "../file-tree/file-tree-store";

const GROUPS: GlobalFileResult[] = [
  {
    filePath: "C:/ws/a.md",
    fileName: "a.md",
    encoding: undefined,
    matches: [
      { lineNumber: 1, lineText: "目标一行", firstMatchIndex: 0 },
      { lineNumber: 5, lineText: "目标二行", firstMatchIndex: 1 },
    ],
  },
  {
    filePath: "C:/ws/legacy.txt",
    fileName: "legacy.txt",
    encoding: "gbk",
    matches: [{ lineNumber: 9, lineText: "gbk 目标", firstMatchIndex: 2 }],
  },
];

beforeEach(() => setActivePinia(createPinia()));

describe("GlobalSearchPanel", () => {
  it("空态三态：未开文件夹/搜索中/无结果", async () => {
    const wrapper = mount(GlobalSearchPanel);
    expect(wrapper.text()).toContain("打开文件夹后可搜索");
    const fileTree = useFileTreeStore();
    fileTree.currentDir = "C:/ws";
    const store = useSearchStore();
    store.globalSearching = true;
    await flushPromises();
    expect(wrapper.text()).toContain("搜索中");
    store.globalSearching = false;
    await flushPromises();
    expect(wrapper.text()).toContain("无匹配结果");
    wrapper.unmount();
  });

  it("结果分组渲染：多匹配默认折叠、单匹配展开、GBK 编码标注可见（AC-F26-1/5）", async () => {
    useFileTreeStore().currentDir = "C:/ws";
    const store = useSearchStore();
    store.globalResults = GROUPS;
    const wrapper = mount(GlobalSearchPanel);
    // 文件头恒渲染 + 计数
    expect(wrapper.find("[data-global-file='a.md']").exists()).toBe(true);
    expect(wrapper.find("[data-global-file='legacy.txt']").text()).toContain("gbk");
    // 多匹配文件默认折叠：其匹配行不可见
    expect(wrapper.find("[data-global-item='1']").exists()).toBe(false);
    // 单匹配文件直接展开
    expect(wrapper.find("[data-global-item='9']").exists()).toBe(true);
    wrapper.unmount();
  });

  it("点击文件头切换折叠；点击结果行透传 (filePath, fileName, firstMatchIndex)", async () => {
    useFileTreeStore().currentDir = "C:/ws";
    const store = useSearchStore();
    store.globalResults = GROUPS;
    const wrapper = mount(GlobalSearchPanel);
    await wrapper.find("[data-global-file='a.md']").trigger("click"); // 展开
    expect(store.expandedFiles.has("C:/ws/a.md")).toBe(true);
    expect(wrapper.find("[data-global-item='1']").exists()).toBe(true);
    await wrapper.find("[data-global-item='5']").trigger("click");
    expect(h.revealGlobalMatch).toHaveBeenCalledWith("C:/ws/a.md", "a.md", 1); // 该行首个命中序号
    wrapper.unmount();
  });

  it("截断提示条按 truncated 标志出现（AC-F26-3）", async () => {
    useFileTreeStore().currentDir = "C:/ws";
    const store = useSearchStore();
    store.globalResults = GROUPS;
    store.globalTruncated = true;
    const wrapper = mount(GlobalSearchPanel);
    expect(wrapper.find("[data-global-truncated]").exists()).toBe(true);
    wrapper.unmount();
  });
});
