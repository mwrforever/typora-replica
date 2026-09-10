// 菜单树构建纯函数测试（AC-M-1 七菜单 / AC-M-2 label 快捷键文本 / 动态子菜单数据）
//
// 纯函数直呼：动态数据（快捷键条目/导出条目/主题/最近文件）以夹具注入；
// 夹具形状与 settings/export/theme services 的真实契约 1:1。
import { describe, expect, it } from "vitest";
import type { ExportMenuEntry } from "../export/export-commands";
import type { MenuShortcutEntry } from "../settings/shortcut-binding";
import type { ThemeMeta } from "../../services/theme-io";
import { buildMenuTree, composeMenuLabel } from "./menu-tree";
import type { MenuNode } from "../../services/menu-io";

/** 快捷键条目夹具（catalog 形态：默认 + keyBinding 覆盖两种来源） */
const shortcutEntries: MenuShortcutEntry[] = [
  { commandId: "Heading 1", label: "标题 1", domain: "editor", combo: "Ctrl+1", source: "default" },
  { commandId: "Paragraph", label: "段落", domain: "editor", combo: "Ctrl+0", source: "default" },
  {
    commandId: "Code Fences",
    label: "代码块",
    domain: "editor",
    combo: "Ctrl+Shift+K",
    source: "default",
  },
  {
    commandId: "Inline Code",
    label: "行内代码",
    domain: "editor",
    combo: "Ctrl+Shift+`",
    source: "default",
  },
  // keyBinding 自定义覆盖形态（Bold 被用户改绑）
  { commandId: "Bold", label: "加粗", domain: "editor", combo: "Ctrl+Shift+B", source: "custom" },
  { commandId: "Italic", label: "斜体", domain: "editor", combo: "Ctrl+I", source: "default" },
  {
    commandId: "New Tab",
    label: "新建标签页",
    domain: "window",
    combo: "Ctrl+N",
    source: "default",
  },
  {
    commandId: "Close Tab",
    label: "关闭标签页",
    domain: "window",
    combo: "Ctrl+W",
    source: "default",
  },
  {
    commandId: "Toggle Sidebar",
    label: "切换侧栏",
    domain: "window",
    combo: "Ctrl+Shift+L",
    source: "default",
  },
  { commandId: "Always on Top", label: "窗口置顶", domain: "window", combo: "", source: "default" },
];

/** 导出条目夹具（格式项 + 占位禁用项 + 尾随两固定项，X7 契约形态） */
const exportEntries: ExportMenuEntry[] = [
  { id: "pdf", label: "导出为 PDF", enabled: true, run: () => Promise.resolve(undefined) },
  {
    id: "custom-x5",
    label: "自定义命令（占位）",
    enabled: false,
    run: () => Promise.resolve(undefined),
  },
  {
    id: "export-with-previous",
    label: "使用上一次设置导出",
    enabled: true,
    run: () => Promise.resolve(undefined),
  },
  {
    id: "overwrite-with-previous",
    label: "导出并覆盖上一次的导出文件",
    enabled: true,
    run: () => Promise.resolve(undefined),
  },
];

/** 主题列表夹具（ThemeMeta 形态：Rust 命名规则产物） */
const themes: ThemeMeta[] = [
  {
    name: "markwell-light",
    fileName: "markwell-light.css",
    label: "Markwell Light",
    hasUserCss: false,
  },
  { name: "github-dark", fileName: "github-dark.css", label: "Github Dark", hasUserCss: true },
];

/** 基准输入（多数用例基于此微调） */
const baseInput = {
  shortcutEntries,
  exportEntries,
  themes,
  activeThemeName: "github-dark",
  activeMode: "dark" as const,
  recentPaths: ["D:\\docs\\a.md", "D:\\docs\\b.md"],
};

/** 展平菜单树（保留层级路径；核对 id/禁用态用） */
function flatten(nodes: readonly MenuNode[], path = ""): Array<{ node: MenuNode; path: string }> {
  return nodes.flatMap((node) => {
    const here = path === "" ? node.kind : `${path}/${node.kind}`;
    if (node.kind === "submenu") return [{ node, path: here }, ...flatten(node.items, here)];
    return [{ node, path: here }];
  });
}

/** 按菜单 id 查找节点 */
function findById(nodes: readonly MenuNode[], id: string): MenuNode | undefined {
  return flatten(nodes).find(({ node }) => "id" in node && node.id === id)?.node;
}

describe("composeMenuLabel（AC-M-2 label 快捷键文本合成）", () => {
  it("有组合串时以 \\t 分隔拼接", () => {
    expect(composeMenuLabel("加粗", "Ctrl+B")).toBe("加粗\tCtrl+B");
  });

  it("无组合串（undefined/空串）不拼快捷键段", () => {
    expect(composeMenuLabel("窗口置顶", undefined)).toBe("窗口置顶");
    expect(composeMenuLabel("窗口置顶", "")).toBe("窗口置顶");
  });
});

describe("buildMenuTree（AC-M-1 七菜单结构）", () => {
  it("顶层恰为 文件/编辑/段落/格式/视图/主题/帮助 七菜单（AC-M-1）", () => {
    const tree = buildMenuTree(baseInput);
    expect(tree.map((n) => (n.kind === "submenu" ? n.label : n.kind))).toEqual([
      "文件",
      "编辑",
      "段落",
      "格式",
      "视图",
      "主题",
      "帮助",
    ]);
    expect(tree.every((n) => n.kind === "submenu")).toBe(true);
  });

  it("全树无重复 id（Tauri 菜单项 id 唯一约束）", () => {
    const tree = buildMenuTree(baseInput);
    const ids = flatten(tree)
      .map(({ node }) => ("id" in node ? node.id : undefined))
      .filter((id): id is string => id !== undefined);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("File 菜单（00 spec §11.1）", () => {
  it("Save/Save As/Open 等硬编码项携带注册组合串（AC-M-2）", () => {
    const tree = buildMenuTree(baseInput);
    const save = findById(tree, "file.save");
    expect(save && save.kind === "item" ? save.label : undefined).toBe("保存\tCtrl+S");
    const saveAs = findById(tree, "file.save-as");
    expect(saveAs && saveAs.kind === "item" ? saveAs.label : undefined).toBe(
      "另存为\tCtrl+Shift+S",
    );
    const open = findById(tree, "file.open");
    expect(open && open.kind === "item" ? open.label : undefined).toBe("打开\tCtrl+O");
    const reopen = findById(tree, "file.reopen-closed");
    expect(reopen && reopen.kind === "item" ? reopen.label : undefined).toBe(
      "重新打开关闭的文件\tCtrl+Shift+T",
    );
  });

  it("catalog 命令项 label/组合串走实时条目（keyBinding 覆盖同步生效）", () => {
    const tree = buildMenuTree(baseInput);
    // Close Tab 为 catalog 窗口域命令：label 与组合串取条目实时值
    const close = findById(tree, "file.close");
    expect(close && close.kind === "item" ? close.label : undefined).toBe("关闭标签页\tCtrl+W");
  });

  it("新建标签页不拼组合段（00 spec §11.1 New Tab Win 无快捷键），新建窗口携 W3 注册组合", () => {
    const tree = buildMenuTree(baseInput);
    const newTab = findById(tree, "file.new-tab");
    expect(newTab && newTab.kind === "item" ? newTab.label : undefined).toBe("新建标签页");
    const newWindow = findById(tree, "file.new-window");
    expect(newWindow && newWindow.kind === "item" ? newWindow.label : undefined).toBe(
      "新建窗口\tCtrl+Shift+N",
    );
    expect(newWindow && newWindow.kind === "item" ? newWindow.enabled : undefined).toBe(true);
  });

  it("Export 子菜单实时渲染导出项：禁用占位透传 + 固定项前插分隔线", () => {
    const tree = buildMenuTree(baseInput);
    const exportMenu = findById(tree, "file.export");
    expect(exportMenu && exportMenu.kind === "submenu" ? exportMenu.items : undefined).toEqual([
      { kind: "item", id: "export.pdf", label: "导出为 PDF", enabled: true },
      { kind: "item", id: "export.custom-x5", label: "自定义命令（占位）", enabled: false },
      { kind: "separator" },
      {
        kind: "item",
        id: "export.export-with-previous",
        label: "使用上一次设置导出",
        enabled: true,
      },
      {
        kind: "item",
        id: "export.overwrite-with-previous",
        label: "导出并覆盖上一次的导出文件",
        enabled: true,
      },
    ]);
  });

  it("Open Recent 子菜单：最近文件逐项 + 清除项（路径入 id 供路由）", () => {
    const tree = buildMenuTree(baseInput);
    const recent = findById(tree, "file.open-recent");
    if (!(recent && recent.kind === "submenu")) {
      expect.unreachable("最近打开子菜单必须存在");
      return;
    }
    expect(recent.items).toEqual([
      {
        kind: "item",
        id: "file.open-recent.D:\\docs\\a.md",
        label: "D:\\docs\\a.md",
        enabled: true,
      },
      {
        kind: "item",
        id: "file.open-recent.D:\\docs\\b.md",
        label: "D:\\docs\\b.md",
        enabled: true,
      },
      { kind: "separator" },
      { kind: "item", id: "file.clear-recent", label: "清除列表", enabled: true },
    ]);
  });

  it("Print 为明确禁用态（无打印实现面，用户裁决首版禁用）", () => {
    const tree = buildMenuTree(baseInput);
    const print = findById(tree, "file.print");
    expect(print && print.kind === "item" ? print.enabled : undefined).toBe(false);
  });

  it("最近列表为空时 Open Recent 仅剩清除项（无分隔线残留）", () => {
    const tree = buildMenuTree({ ...baseInput, recentPaths: [] });
    const recent = findById(tree, "file.open-recent");
    if (!(recent && recent.kind === "submenu")) {
      expect.unreachable("最近打开子菜单必须存在");
      return;
    }
    expect(recent.items).toEqual([
      { kind: "item", id: "file.clear-recent", label: "清除列表", enabled: true },
    ]);
  });
});

describe("Edit/Paragraph/Format 菜单（00 spec §11.2-11.4）", () => {
  it("编辑器域可执行项 id 与 01 命令目录键 1:1（editor.<目录键> 契约）", async () => {
    const tree = buildMenuTree(baseInput);
    const { listBindableEditorCommands } = await import("../editor/keymaps");
    const catalog = new Set(listBindableEditorCommands());
    const editorIds = flatten(tree)
      .map(({ node }) => node)
      .filter((node) => node.kind === "item" && node.enabled && node.id.startsWith("editor."))
      .map((node) => (node.kind === "item" ? node.id : ""));
    expect(editorIds.length).toBeGreaterThan(0);
    for (const id of editorIds) {
      expect(catalog.has(id.slice("editor.".length))).toBe(true);
    }
  });

  it("剪贴板/查找跳转为原生预定义项或路由项（无 id 依赖原生行为）", () => {
    const tree = buildMenuTree(baseInput);
    const edit = findById(tree, "menu.edit");
    if (!(edit && edit.kind === "submenu")) {
      expect.unreachable("编辑子菜单必须存在");
      return;
    }
    expect(edit.items).toEqual(
      expect.arrayContaining([
        { kind: "predefined", item: "Cut", label: "剪切" },
        { kind: "predefined", item: "Copy", label: "复制" },
        { kind: "predefined", item: "Paste", label: "粘贴" },
        { kind: "predefined", item: "SelectAll", label: "全选" },
      ]),
    );
  });

  it("无实现面项为明确禁用态（下划线/超链接/图片/清除格式/数学块/拼写检查/专注/打字机）", () => {
    const tree = buildMenuTree(baseInput);
    for (const id of [
      "editor.Underline",
      "editor.Hyperlink",
      "editor.Image",
      "editor.Clear Format",
      "editor.Math Block",
      "edit.spell-check",
      "edit.select-line",
      // 专注/打字机属 W5 工作包，先以禁用态占位
      "view.focus-mode",
      "view.typewriter-mode",
    ]) {
      const node = findById(tree, id);
      expect(node && node.kind === "item" ? node.enabled : undefined).toBe(false);
    }
  });

  it("12 W4 源码模式项为可执行态且携真实注册组合（Ctrl+/ 随 W4 注册）", () => {
    const tree = buildMenuTree(baseInput);
    const node = findById(tree, "view.source-mode");
    expect(node && node.kind === "item" ? node.enabled : undefined).toBe(true);
    expect(node && node.kind === "item" ? node.label : undefined).toBe("源码模式	Ctrl+/");
  });

  it("12 W3 窗口控制项为可执行态且携真实注册组合（全屏/缩放三键/置顶）", () => {
    const tree = buildMenuTree(baseInput);
    const expected: Record<string, string> = {
      "view.fullscreen": "切换全屏\tF11",
      "view.zoom-actual": "原始尺寸\tCtrl+Shift+0",
      "view.zoom-in": "放大\tCtrl+Shift+=",
      "view.zoom-out": "缩小\tCtrl+Shift+-",
    };
    for (const [id, label] of Object.entries(expected)) {
      const node = findById(tree, id);
      expect(node && node.kind === "item" ? node.enabled : undefined).toBe(true);
      expect(node && node.kind === "item" ? node.label : undefined).toBe(label);
    }
    // 置顶无默认快捷键（00 spec §2.3）：可执行且不拼组合段
    const onTop = findById(tree, "view.always-on-top");
    expect(onTop && onTop.kind === "item" ? onTop.enabled : undefined).toBe(true);
    expect(onTop && onTop.kind === "item" ? onTop.label : undefined).toBe("窗口置顶");
  });

  it("未注册组合的可执行项不拼虚假快捷键段（表格/删除线/引用/列表/缩进出例外核对）", () => {
    const tree = buildMenuTree(baseInput);
    for (const id of ["editor.Table", "editor.Strike", "editor.Quote", "editor.Ordered List"]) {
      const node = findById(tree, id);
      if (!(node && node.kind === "item")) {
        expect.unreachable(`${id} 必须存在`);
        return;
      }
      expect(node.enabled).toBe(true);
      expect(node.label.includes("\t")).toBe(false);
    }
    // 缩进/取消缩进的 Ctrl+[/] 已注册，允许携带组合段
    const indent = findById(tree, "editor.Indent");
    expect(indent && indent.kind === "item" ? indent.label : undefined).toBe("增加缩进\tCtrl+[");
  });
});

describe("Themes/View 菜单（00 spec §11.5/11.6 动态子菜单）", () => {
  it("主题逐项可勾选且勾选态对齐激活主题（AC-M-4 数据源）", () => {
    const tree = buildMenuTree(baseInput);
    const themesMenu = findById(tree, "menu.themes");
    if (!(themesMenu && themesMenu.kind === "submenu")) {
      expect.unreachable("主题子菜单必须存在");
      return;
    }
    expect(themesMenu.items).toEqual([
      {
        kind: "check-item",
        id: "themes.select.markwell-light",
        label: "Markwell Light",
        enabled: true,
        checked: false,
      },
      {
        kind: "check-item",
        id: "themes.select.github-dark",
        label: "Github Dark",
        enabled: true,
        checked: true,
      },
      { kind: "separator" },
      { kind: "item", id: "themes.open-folder", label: "打开主题文件夹", enabled: true },
    ]);
  });

  it("主题列表为空时仅剩打开主题文件夹项（无分隔线残留）", () => {
    const tree = buildMenuTree({ ...baseInput, themes: [] });
    const themesMenu = findById(tree, "menu.themes");
    if (!(themesMenu && themesMenu.kind === "submenu")) {
      expect.unreachable("主题子菜单必须存在");
      return;
    }
    expect(themesMenu.items).toEqual([
      { kind: "item", id: "themes.open-folder", label: "打开主题文件夹", enabled: true },
    ]);
  });

  it("视图菜单可执行项携带注册组合串（侧栏/面板/搜索/切换文档/DevTools）", () => {
    const tree = buildMenuTree(baseInput);
    const expectLabel = (id: string, label: string): void => {
      const node = findById(tree, id);
      expect(node && node.kind === "item" ? node.label : undefined).toBe(label);
    };
    expectLabel("view.toggle-sidebar", "切换侧栏\tCtrl+Shift+L");
    expectLabel("view.panel-outline", "大纲\tCtrl+Shift+1");
    expectLabel("view.panel-tree", "文件树\tCtrl+Shift+3");
    expectLabel("view.global-search", "全局搜索\tCtrl+Shift+F");
    expectLabel("view.switch-doc", "切换打开的文档\tCtrl+Tab");
    expectLabel("view.toggle-devtools", "开发者工具\tShift+F12");
  });
});
