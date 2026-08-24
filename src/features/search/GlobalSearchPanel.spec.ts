// 全局搜索面板组件用例：global-reveal / search-service 全量 mock（定位链路已
// 独立覆盖；service 沿 FindReplacePanel.spec hoisted 桩惯例防真实 invoke），store 走真实 Pinia
import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";

// vi.mock 工厂被提升到 import 之前求值，共享桩状态收拢进 hoisted 容器
const h = vi.hoisted(() => ({
  revealGlobalMatch: vi.fn(),
  startGlobalSearch: vi.fn(),
  cancelGlobalSearch: vi.fn(),
}));
vi.mock("./global-reveal", () => ({
  revealGlobalMatch: (...a: unknown[]) => h.revealGlobalMatch(...a),
}));
vi.mock("../../services/search-service", () => ({
  startGlobalSearch: (...a: unknown[]) => h.startGlobalSearch(...a),
  cancelGlobalSearch: (...a: unknown[]) => h.cancelGlobalSearch(...a),
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

// 桩跨用例共享：每例清零调用记录 + 新建 Pinia，保证次数断言只计本例行为
beforeEach(() => {
  setActivePinia(createPinia());
  h.revealGlobalMatch.mockClear();
  h.startGlobalSearch.mockClear();
  h.cancelGlobalSearch.mockClear();
});

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

  it("三开关点击即时重跑：翻转后立即发起全局重扫；空查询仅翻转不发起", async () => {
    useFileTreeStore().currentDir = "C:/ws";
    const store = useSearchStore();
    store.globalResults = GROUPS; // 预置旧口径结果，重扫后应被新查询清空重建
    store.globalQuery = "目标";
    const wrapper = mount(GlobalSearchPanel);
    await wrapper.find("[data-global-case]").trigger("click");
    expect(store.globalCaseSensitive).toBe(true);
    expect(h.startGlobalSearch).toHaveBeenCalledOnce();
    // 重扫快照携带翻转后的开关口径（root/查询词/三开关/Channel 批量回调）
    expect(h.startGlobalSearch).toHaveBeenCalledWith(
      "C:/ws",
      "目标",
      { caseSensitive: true, wholeWord: false, regexp: false },
      expect.anything(),
    );
    await wrapper.find("[data-global-word]").trigger("click");
    await wrapper.find("[data-global-regexp]").trigger("click");
    expect(store.globalWholeWord && store.globalRegexp).toBe(true);
    expect(h.startGlobalSearch).toHaveBeenCalledTimes(3); // 每次点击即时重跑
    // 空查询：开关只翻转状态，不发起无谓扫描
    h.startGlobalSearch.mockClear();
    store.globalQuery = "";
    await wrapper.find("[data-global-case]").trigger("click");
    expect(h.startGlobalSearch).not.toHaveBeenCalled();
    wrapper.unmount();
  });
});
