// 原生菜单装配 composable 测试（AC-M-1/3/4 运行时链路 + 动态重建 + 最近文件刷新）
//
// mock 边界：services/menu-io（捕获挂载树与 onAction）与 services/recent-files
// （受控最近列表）；store 层（settings/theme/export）走真实实例（active pinia），
// 动态重建经真实响应式链路触发。
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { DEFAULT_ADVANCED_SETTINGS } from "../../services/advanced-settings";

const mocks = vi.hoisted(() => ({
  setWindowMenu: vi.fn<(...args: unknown[]) => Promise<void>>(() => Promise.resolve()),
  recentLists: [[] as Array<{ path: string; pinned: boolean; openedAt: number }>],
  recentFails: false,
}));

vi.mock("../../services/menu-io", () => ({
  setWindowMenu: mocks.setWindowMenu,
}));

vi.mock("../../services/recent-files", () => ({
  RecentFiles: class {
    list() {
      // 受控失败形态：store 插件读取异常路径（回落空列表，不阻断装配）
      if (mocks.recentFails) return Promise.reject(new Error("store 读取失败"));
      return Promise.resolve(mocks.recentLists.at(-1)!);
    }
  },
}));

import { useExportStore } from "../export/export-store";
import { useSettingsStore } from "../settings/settings-store";
import { useThemeStore } from "../theme/theme-store";
import { useNativeMenu } from "./use-native-menu";
import type { MenuRouterDeps } from "./menu-router";
import type { MenuNode } from "../../services/menu-io";

/** 路由依赖夹具（全回调 vi.fn） */
function makeDeps(): MenuRouterDeps {
  return {
    runEditorCommand: vi.fn(() => true),
    newTab: vi.fn(),
    openFile: vi.fn(),
    openFileDialog: vi.fn(),
    quickOpen: vi.fn(),
    clearRecent: vi.fn(),
    reopenClosed: vi.fn(),
    save: vi.fn(),
    saveAs: vi.fn(),
    preference: vi.fn(),
    closeTab: vi.fn(),
    copyAsMarkdown: vi.fn(),
    pasteAsPlainText: vi.fn(),
    toggleFind: vi.fn(),
    toggleReplace: vi.fn(),
    findNext: vi.fn(),
    findPrev: vi.fn(),
    toggleSidebar: vi.fn(),
    switchPanel: vi.fn(),
    globalSearch: vi.fn(),
    switchDocNext: vi.fn(),
    toggleDevtools: vi.fn(),
    selectTheme: vi.fn(),
    openThemeFolder: vi.fn(),
    notifyError: vi.fn(),
  };
}

/** 等待挂载次数达标（初始装配与重建均为异步链路） */
async function waitForMountCount(count: number): Promise<void> {
  await vi.waitFor(() => {
    expect(mocks.setWindowMenu.mock.calls.length).toBeGreaterThanOrEqual(count);
  });
}

/** 取某次挂载的菜单树与 onAction（快照读取） */
function mountCall(index: number): { nodes: MenuNode[]; onAction: (id: string) => void } {
  const call = mocks.setWindowMenu.mock.calls[index] as unknown as [
    readonly MenuNode[],
    (id: string) => void,
  ];
  const [nodes, onAction] = call;
  return { nodes: nodes as MenuNode[], onAction };
}

/** 顶层子菜单 label 列表（AC-M-1 断言用） */
function topLabels(nodes: MenuNode[]): string[] {
  return nodes.map((n) => (n.kind === "submenu" ? n.label : n.kind));
}

/** 按 id 递归查找菜单项 label（结构化断言，避免 JSON 转义干扰） */
function labelOf(nodes: MenuNode[], id: string): string | undefined {
  for (const node of nodes) {
    if (node.kind === "submenu") {
      const found = labelOf(node.items, id);
      if (found !== undefined) return found;
    } else if (node.kind === "item" && node.id === id) {
      return node.label;
    }
  }
  return undefined;
}

/** 按 id 递归查找勾选菜单项节点（Themes 勾选态断言用） */
function findCheckItem(
  nodes: MenuNode[],
  id: string,
): Extract<MenuNode, { kind: "check-item" }> | undefined {
  for (const node of nodes) {
    if (node.kind === "submenu") {
      const found = findCheckItem(node.items, id);
      if (found) return found;
    } else if (node.kind === "check-item" && node.id === id) {
      return node;
    }
  }
  return undefined;
}

describe("useNativeMenu（原生菜单装配运行时链路）", () => {
  let deps: MenuRouterDeps;
  let cleanups: Array<() => void>;

  beforeEach(() => {
    setActivePinia(createPinia());
    deps = makeDeps();
    cleanups = [];
    mocks.setWindowMenu.mockClear();
    mocks.setWindowMenu.mockImplementation(() => Promise.resolve());
    mocks.recentLists = [[{ path: "D:\\a.md", pinned: false, openedAt: 1 }]];
    mocks.recentFails = false;
  });

  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  it("装配后挂载七菜单（AC-M-1）且菜单点击经路由派发到依赖回调（AC-M-3）", async () => {
    const theme = useThemeStore();
    theme.themes = [
      {
        name: "markwell-light",
        fileName: "markwell-light.css",
        label: "Markwell Light",
        hasUserCss: false,
      },
    ];
    theme.lightTheme = "markwell-light";
    theme.darkTheme = "github-dark";
    cleanups.push(useNativeMenu({ deps }).cleanup);
    await waitForMountCount(1);
    // AC-M-1：七菜单顶层结构
    expect(topLabels(mountCall(0).nodes)).toEqual([
      "文件",
      "编辑",
      "段落",
      "格式",
      "视图",
      "主题",
      "帮助",
    ]);
    // AC-M-3：onAction → 路由 → 同一命令回调（菜单点击执行路径）
    mountCall(0).onAction("file.save");
    expect(deps.save).toHaveBeenCalledOnce();
    mountCall(0).onAction("editor.Bold");
    expect(deps.runEditorCommand).toHaveBeenCalledWith("Bold");
  });

  it("主题列表变化触发整树重建且新主题入树（AC-M-4）", async () => {
    const theme = useThemeStore();
    theme.themes = [
      {
        name: "markwell-light",
        fileName: "markwell-light.css",
        label: "Markwell Light",
        hasUserCss: false,
      },
    ];
    theme.lightTheme = "markwell-light";
    theme.darkTheme = "github-dark";
    cleanups.push(useNativeMenu({ deps }).cleanup);
    await waitForMountCount(1);
    // 模拟主题目录热刷新：新主题安装后 store 列表更新（themes ref 替换）
    theme.themes = [
      {
        name: "markwell-light",
        fileName: "markwell-light.css",
        label: "Markwell Light",
        hasUserCss: false,
      },
      { name: "github-dark", fileName: "github-dark.css", label: "Github Dark", hasUserCss: true },
    ];
    await waitForMountCount(2);
    expect(JSON.stringify(mountCall(1).nodes)).toContain("themes.select.github-dark");
  });

  it("keyBinding 覆盖变化触发重建且 label 更新（菜单快捷键实时文本）", async () => {
    const settings = useSettingsStore();
    settings.advanced = { ...DEFAULT_ADVANCED_SETTINGS, keyBinding: { Bold: "Ctrl+Shift+B" } };
    cleanups.push(useNativeMenu({ deps }).cleanup);
    await waitForMountCount(1);
    // 首次挂载 label 已带自定义组合
    expect(labelOf(mountCall(0).nodes, "editor.Bold")).toBe("加粗\tCtrl+Shift+B");
    // 运行期改绑 → menuShortcutEntries 重算 → 重建
    settings.advanced = { ...DEFAULT_ADVANCED_SETTINGS, keyBinding: { Bold: "Ctrl+J" } };
    await waitForMountCount(2);
    expect(labelOf(mountCall(1).nodes, "editor.Bold")).toBe("加粗\tCtrl+J");
  });

  it("导出项变化触发 Export 子菜单重建（X7 实时性）", async () => {
    const exportStore = useExportStore();
    cleanups.push(useNativeMenu({ deps }).cleanup);
    await waitForMountCount(1);
    exportStore.addItem("自定义命令");
    await waitForMountCount(2);
    expect(JSON.stringify(mountCall(1).nodes)).toContain("自定义命令");
  });

  it("refreshRecent 重拉最近文件并重建（打开文件后调用）", async () => {
    const handle = useNativeMenu({ deps });
    cleanups.push(handle.cleanup);
    await waitForMountCount(1);
    expect(labelOf(mountCall(0).nodes, "file.open-recent.D:\\a.md")).toBe("D:\\a.md");
    mocks.recentLists.push([
      { path: "D:\\a.md", pinned: false, openedAt: 1 },
      { path: "D:\\b.md", pinned: false, openedAt: 2 },
    ]);
    await handle.refreshRecent();
    await vi.waitFor(() => {
      expect(mocks.setWindowMenu.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
    const last = mountCall(mocks.setWindowMenu.mock.calls.length - 1);
    expect(labelOf(last.nodes, "file.open-recent.D:\\b.md")).toBe("D:\\b.md");
  });

  it("cleanup 后动态变化不再触发重建（detached 订阅自持取消）", async () => {
    const theme = useThemeStore();
    theme.themes = [];
    const handle = useNativeMenu({ deps });
    cleanups.push(handle.cleanup);
    await waitForMountCount(1);
    handle.cleanup();
    theme.themes = [{ name: "x", fileName: "x.css", label: "X", hasUserCss: false }];
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mocks.setWindowMenu.mock.calls.length).toBe(1);
  });

  it("挂载失败告警收敛不崩溃，后续重建仍可恢复菜单", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.setWindowMenu.mockRejectedValueOnce(new Error("IPC 失败"));
    const theme = useThemeStore();
    theme.themes = [];
    const handle = useNativeMenu({ deps });
    cleanups.push(handle.cleanup);
    await vi.waitFor(() => {
      expect(error).toHaveBeenCalledWith(expect.stringContaining("原生菜单"), expect.any(Error));
    });
    // 主题变化触发重建：第二次挂载成功（mock 已恢复 resolve 实现）
    theme.themes = [{ name: "x", fileName: "x.css", label: "X", hasUserCss: false }];
    await vi.waitFor(() => {
      expect(mocks.setWindowMenu.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  it("最近文件读取失败回落空列表不阻断装配（refreshRecent 同口径）", async () => {
    mocks.recentFails = true;
    const handle = useNativeMenu({ deps });
    cleanups.push(handle.cleanup);
    await waitForMountCount(1);
    // 空列表形态：Open Recent 子菜单仍存在（仅清除项）
    expect(labelOf(mountCall(0).nodes, "file.clear-recent")).toBe("清除列表");
    await handle.refreshRecent();
    expect(mocks.setWindowMenu.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("暗色系统色系下主题勾选与切换模式取 dark 侧（系统色系联动）", async () => {
    const theme = useThemeStore();
    theme.themes = [
      { name: "github-dark", fileName: "github-dark.css", label: "Github Dark", hasUserCss: true },
    ];
    theme.lightTheme = "markwell-light";
    theme.darkTheme = "github-dark";
    theme.systemDark = true;
    cleanups.push(useNativeMenu({ deps }).cleanup);
    await waitForMountCount(1);
    // 激活主题按 dark 模式解析 → 勾选 github-dark
    const item = findCheckItem(mountCall(0).nodes, "themes.select.github-dark");
    expect(item && item.kind === "check-item" ? item.checked : undefined).toBe(true);
  });
});
