// 菜单命令路由表测试（AC-M-3 单一执行路径 + id 覆盖全表无孤儿；核心域 100%）
//
// 依赖回调以 vi.fn 夹具注入，逐域断言派发路径：精确表 / editor. 前缀 /
// export. 前缀（含条目缺失与失败上抛）/ themes.select. 前缀 / file.open-recent. 前缀 /
// 未知 id 告警不崩溃。
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExportMenuEntry } from "../export/export-commands";
import { createMenuRouter } from "./menu-router";
import type { MenuRouterDeps } from "./menu-router";
import { buildMenuTree } from "./menu-tree";
import type { MenuNode } from "../../services/menu-io";

/** 依赖夹具（全回调 vi.fn；单用例按需覆盖个别成员） */
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
    toggleSourceMode: vi.fn(),
    toggleDevtools: vi.fn(),
    toggleFullscreen: vi.fn(),
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
    zoomReset: vi.fn(),
    toggleAlwaysOnTop: vi.fn(),
    newWindow: vi.fn(),
    selectTheme: vi.fn(),
    openThemeFolder: vi.fn(),
    notifyError: vi.fn(),
  };
}

/** 导出条目夹具（成功/失败/禁用三形态） */
const exportEntries: ExportMenuEntry[] = [
  { id: "pdf", label: "导出为 PDF", enabled: true, run: vi.fn(() => Promise.resolve(undefined)) },
  {
    id: "html",
    label: "导出为 HTML",
    enabled: true,
    run: vi.fn(() => Promise.reject(new Error("管线失败"))),
  },
  {
    id: "export-with-previous",
    label: "使用上一次设置导出",
    enabled: true,
    run: vi.fn(() => Promise.resolve(undefined)),
  },
];

/** 基准输入（与菜单树测试同构的动态数据） */
const baseInput = { exportEntries, activeMode: "dark" as const };

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createMenuRouter 精确表域", () => {
  it("文件/视图/应用域 id 派发到对应依赖回调", () => {
    const deps = makeDeps();
    const router = createMenuRouter(deps, baseInput);
    router.run("file.new");
    expect(deps.newTab).toHaveBeenCalledOnce();
    router.run("file.new-tab");
    expect(deps.newTab).toHaveBeenCalledTimes(2);
    router.run("file.new-window");
    expect(deps.newWindow).toHaveBeenCalledOnce();
    router.run("file.open");
    expect(deps.openFileDialog).toHaveBeenCalledOnce();
    router.run("file.open-quickly");
    expect(deps.quickOpen).toHaveBeenCalledOnce();
    router.run("file.clear-recent");
    expect(deps.clearRecent).toHaveBeenCalledOnce();
    router.run("file.reopen-closed");
    expect(deps.reopenClosed).toHaveBeenCalledOnce();
    router.run("file.save");
    expect(deps.save).toHaveBeenCalledOnce();
    router.run("file.save-as");
    expect(deps.saveAs).toHaveBeenCalledOnce();
    router.run("file.preference");
    expect(deps.preference).toHaveBeenCalledOnce();
    router.run("file.close");
    expect(deps.closeTab).toHaveBeenCalledOnce();
    router.run("app.copy-as-markdown");
    expect(deps.copyAsMarkdown).toHaveBeenCalledOnce();
    router.run("app.paste-as-plain-text");
    expect(deps.pasteAsPlainText).toHaveBeenCalledOnce();
    router.run("app.toggle-find");
    expect(deps.toggleFind).toHaveBeenCalledOnce();
    router.run("app.toggle-replace");
    expect(deps.toggleReplace).toHaveBeenCalledOnce();
    router.run("app.find-next");
    expect(deps.findNext).toHaveBeenCalledOnce();
    router.run("app.find-prev");
    expect(deps.findPrev).toHaveBeenCalledOnce();
    router.run("view.toggle-sidebar");
    expect(deps.toggleSidebar).toHaveBeenCalledOnce();
    router.run("view.panel-outline");
    expect(deps.switchPanel).toHaveBeenCalledWith("outline");
    router.run("view.panel-list");
    expect(deps.switchPanel).toHaveBeenCalledWith("list");
    router.run("view.panel-tree");
    expect(deps.switchPanel).toHaveBeenCalledWith("tree");
    router.run("view.global-search");
    expect(deps.globalSearch).toHaveBeenCalledOnce();
    router.run("view.switch-doc");
    expect(deps.switchDocNext).toHaveBeenCalledOnce();
    // 源码模式（12 W4）：菜单 action 与 Ctrl+/ 快捷键共用同一 toggle 命令
    router.run("view.source-mode");
    expect(deps.toggleSourceMode).toHaveBeenCalledOnce();
    router.run("view.toggle-devtools");
    expect(deps.toggleDevtools).toHaveBeenCalledOnce();
    router.run("themes.open-folder");
    expect(deps.openThemeFolder).toHaveBeenCalledOnce();
  });
});

describe("createMenuRouter 前缀域", () => {
  it("editor. 前缀转 01 命令目录执行（命令名剥前缀透传）", () => {
    const deps = makeDeps();
    const router = createMenuRouter(deps, baseInput);
    router.run("editor.Heading 1");
    expect(deps.runEditorCommand).toHaveBeenCalledWith("Heading 1");
  });

  it("编辑器命令不适用上下文（目录执行 false）时告警留痕不崩溃", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const deps = makeDeps();
    deps.runEditorCommand = vi.fn(() => false);
    const router = createMenuRouter(deps, baseInput);
    router.run("editor.Indent");
    expect(deps.runEditorCommand).toHaveBeenCalledWith("Indent");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Indent"));
  });

  it("export. 前缀按条目 id 派发条目 run", () => {
    const router = createMenuRouter(makeDeps(), baseInput);
    router.run("export.pdf");
    expect(exportEntries[0]!.run).toHaveBeenCalledOnce();
    router.run("export.export-with-previous");
    expect(exportEntries[2]!.run).toHaveBeenCalledOnce();
  });

  it("导出管线失败经 notifyError 呈现（不静默、不崩溃）", async () => {
    const deps = makeDeps();
    const router = createMenuRouter(deps, baseInput);
    router.run("export.html");
    await vi.waitFor(() => {
      expect(deps.notifyError).toHaveBeenCalledWith(expect.stringContaining("管线失败"));
    });
  });

  it("导出条目缺失（菜单重建滞后窗口期）告警忽略", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const router = createMenuRouter(makeDeps(), { exportEntries: [], activeMode: "dark" });
    router.run("export.pdf");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("导出菜单条目不存在"));
  });

  it("themes.select. 前缀以菜单构建时色系派发主题切换", () => {
    const deps = makeDeps();
    const router = createMenuRouter(deps, baseInput);
    router.run("themes.select.github-dark");
    expect(deps.selectTheme).toHaveBeenCalledWith("dark", "github-dark");
  });

  it("file.open-recent. 前缀携路径派发打开文件", () => {
    const deps = makeDeps();
    const router = createMenuRouter(deps, baseInput);
    router.run("file.open-recent.D:\\docs\\a.md");
    expect(deps.openFile).toHaveBeenCalledWith("D:\\docs\\a.md");
  });

  it("未知 id 告警忽略不崩溃（禁用项误触/版本漂移防御）", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const deps = makeDeps();
    const router = createMenuRouter(deps, baseInput);
    // 禁用占位项（W5 专注模式）误触走未知 id 告警路径
    router.run("view.focus-mode");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("view.focus-mode"));
    expect(deps.notifyError).not.toHaveBeenCalled();
  });
});

describe("createMenuRouter 窗口控制域（12 W3：AC-M-13~16 单一执行路径）", () => {
  it("全屏/缩放三键/置顶/新建窗口 id 派发到 window-controls 命令回调", () => {
    const deps = makeDeps();
    const router = createMenuRouter(deps, baseInput);
    router.run("view.fullscreen");
    expect(deps.toggleFullscreen).toHaveBeenCalledOnce();
    router.run("view.zoom-in");
    expect(deps.zoomIn).toHaveBeenCalledOnce();
    router.run("view.zoom-out");
    expect(deps.zoomOut).toHaveBeenCalledOnce();
    router.run("view.zoom-actual");
    expect(deps.zoomReset).toHaveBeenCalledOnce();
    router.run("view.always-on-top");
    expect(deps.toggleAlwaysOnTop).toHaveBeenCalledOnce();
    router.run("file.new-window");
    expect(deps.newWindow).toHaveBeenCalledOnce();
  });
});

describe("id 覆盖全表无孤儿（AC-M-3 配套：真实菜单树 × 路由表行为级核对）", () => {
  /** 递归收集可执行（enabled）项 id（预定义项/分隔线无 id 不参与核对） */
  function collectEnabledIds(nodes: readonly MenuNode[]): string[] {
    return nodes.flatMap((node) => {
      if (node.kind === "submenu") return collectEnabledIds(node.items);
      if (node.kind === "item" || node.kind === "check-item") {
        return node.enabled ? [node.id] : [];
      }
      return [];
    });
  }

  it("真实七菜单树全部可执行项派发时命中至少一路命令回调（无孤儿）", () => {
    // 树与路由以同输入构建（与 use-native-menu 装配同构），逐 id 派发并以
    // 命中回调判定可路由——导出域命中条目 run、其余域命中 deps 回调；
    // 任何漂移（树有路由无 / 路由有树无）在此暴露
    const makeExportEntries = (): ExportMenuEntry[] => [
      { id: "pdf", label: "PDF", enabled: true, run: vi.fn(() => Promise.resolve(undefined)) },
      {
        id: "export-with-previous",
        label: "使用上一次设置导出",
        enabled: true,
        run: vi.fn(() => Promise.resolve(undefined)),
      },
    ];
    const themes = [
      { name: "github-dark", fileName: "github-dark.css", label: "Github Dark", hasUserCss: true },
    ];
    const recentPaths = ["D:\\docs\\a.md"];
    const tree = buildMenuTree({
      exportEntries: makeExportEntries(),
      activeThemeName: "github-dark",
      activeMode: "dark",
      themes,
      recentPaths,
      shortcutEntries: [],
    });
    const ids = collectEnabledIds(tree);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      const deps = makeDeps();
      const entries = makeExportEntries();
      const router = createMenuRouter(deps, { exportEntries: entries, activeMode: "dark" });
      router.run(id);
      const depHit = Object.values(
        deps as unknown as Record<string, ReturnType<typeof vi.fn>>,
      ).some((fn) => fn.mock.calls.length > 0);
      const entryHit = entries.some(
        (entry) => (entry.run as ReturnType<typeof vi.fn>).mock.calls.length > 0,
      );
      expect(`${id}: ${depHit || entryHit}`).toBe(`${id}: true`);
    }
  });
});
