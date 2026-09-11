// 菜单命令路由表（12 窗口外壳 W2；spec §5 提供面 menuRouter + AC-M-3 单一执行路径）
//
// 职责：菜单项 id → 命令函数 的唯一映射（点击菜单项与窗口快捷键统一经 run 派发，
// 保证「同一命令函数」）。命令来源分域：
// - 编辑器域（id 前缀 "editor."）：01 菜单命令目录 runEditorMenuCommand（与 10
//   keyBinding 注入共用同源单一事实源，缺口 G 形态 b）；
// - 导出域（id 前缀 "export."）：09 getExportMenuEntries 产物的 run（菜单/快捷键
//   单一入口 runExport 绑定）；
// - 其余域（文件/编辑剪贴板/视图/主题/帮助）：装配层注入的各模块锁定接口回调
//   （MenuRouterDeps）。
// 核心域单测 100%（spec §4）：id 覆盖全表无孤儿（菜单树 × 路由表行为级核对见
// menu-router.spec）、未知 id 告警不崩溃。
import type { ExportMenuEntry } from "../export/export-commands";
import type { ThemeMode } from "../theme/theme-store";

/** 侧栏面板切换键（与 03 fileTree store PanelKey 的三面板子集对齐） */
export type SidebarPanelKey = "outline" | "list" | "tree";

/** 路由表依赖（装配层注入；全部为各模块锁定接口的薄回调） */
export interface MenuRouterDeps {
  /** 编辑器命令目录执行（01 runEditorMenuCommand；编辑器域菜单命令唯一入口） */
  runEditorCommand: (commandId: string) => boolean;
  /** 新建标签（04 createUntitled） */
  newTab: () => void;
  /** 打开文件（对话框选中/最近打开共用入口，App 层多标签链路） */
  openFile: (path: string) => void;
  /** 弹系统打开文件对话框（File → Open） */
  openFileDialog: () => void;
  /** 快速打开面板（Ctrl+P） */
  quickOpen: () => void;
  /** 清除最近文件列表（Open Recent → 清除列表；清除后由装配层触发菜单重建） */
  clearRecent: () => void;
  /** 重开最近关闭的文件（04 reopenClosed） */
  reopenClosed: () => void;
  /** 保存激活文档（无路径转另存，App 层会话链路） */
  save: () => void;
  /** 另存为（Save As） */
  saveAs: () => void;
  /** 偏好设置面板开合（10 togglePanel） */
  preference: () => void;
  /** 关闭激活标签（04 closeTab，脏标签走 C2 确认） */
  closeTab: () => void;
  /** 复制全文为 Markdown（01 getMarkdown → 剪贴板） */
  copyAsMarkdown: () => void;
  /** 粘贴为纯文本（剪贴板 → 01 insertMarkdown） */
  pasteAsPlainText: () => void;
  /** 开关查找面板（06 toggleFind） */
  toggleFind: () => void;
  /** 开关替换面板（06 toggleReplace） */
  toggleReplace: () => void;
  /** 查找下一个（06 navigateNext） */
  findNext: () => void;
  /** 查找上一个（06 navigatePrev） */
  findPrev: () => void;
  /** 切换侧栏开合（03 toggleSidebar） */
  toggleSidebar: () => void;
  /** 切换侧栏面板（03 switchPanel） */
  switchPanel: (key: SidebarPanelKey) => void;
  /** 全局搜索入口（03 showSearch） */
  globalSearch: () => void;
  /** 切换到下一个打开的文档（04 cycle） */
  switchDocNext: () => void;
  /** 源码模式双向切换（12 W4 source-mode 单例；AC-M-6~8） */
  toggleSourceMode: () => void;
  /** 专注模式双向切换（12 W5 view-modes 单例；AC-M-10，F8 共用同一命令） */
  toggleFocusMode: () => void;
  /** 打字机模式双向切换（12 W5 view-modes 单例；AC-M-11/12，F9 共用同一命令） */
  toggleTypewriterMode: () => void;
  /** 切换 DevTools（08 toggleDevtools） */
  toggleDevtools: () => void;
  /** 切换全屏并联动菜单栏显隐（12 W3 window-controls，AC-M-13） */
  toggleFullscreen: () => void;
  /** 缩放放大一档（12 W3，AC-M-14） */
  zoomIn: () => void;
  /** 缩放缩小一档（12 W3，AC-M-14） */
  zoomOut: () => void;
  /** 缩放恢复原始尺寸（12 W3，AC-M-14） */
  zoomReset: () => void;
  /** 切换窗口置顶（12 W3，AC-M-15 仅当前窗口） */
  toggleAlwaysOnTop: () => void;
  /** 新建窗口（12 W3，AC-M-16 空文档独立状态） */
  newWindow: () => void;
  /** 选择主题（08 selectTheme；mode = 菜单构建时的当前色系） */
  selectTheme: (mode: ThemeMode, name: string) => void;
  /** 打开主题文件夹（08 openThemeFolder） */
  openThemeFolder: () => void;
  /** 用户可见错误呈现（导出失败等；App 层会话通知通道） */
  notifyError: (message: string) => void;
}

/** 路由表构建输入（与菜单树同源动态数据） */
export interface MenuRouterInput {
  /** 导出菜单条目（getExportMenuEntries 实时产物；run 为命令绑定） */
  exportEntries: readonly ExportMenuEntry[];
  /** 菜单构建时的当前色系（Themes 勾选项 selectTheme 模式入参） */
  activeMode: ThemeMode;
}

/** 菜单命令路由表（AC-M-3：菜单项与快捷键共用 run 派发） */
export interface MenuRouter {
  /** 按菜单项 id 派发命令；未知 id 告警忽略不崩溃（幂等防御） */
  run: (id: string) => void;
}

/**
 * 窗口域 keyBinding 命令映射（catalog commandId → 命令函数；10#1 执行通路）。
 *
 * 与 createMenuRouter 精确表相邻同源维护：值取同一批 MenuRouterDeps 回调，与菜单
 * action 共用同一命令函数（AC-M-3），防「菜单执行」与「快捷键执行」两表漂移。
 * 键集 = shortcut-catalog 中 domain=window 的命令名（conf.user.json keyBinding 键面）；
 * 目录外命令在注册侧告警跳过（window-keybinding-shortcuts 消费时校验）。
 */
export const WINDOW_KEYBINDING_COMMANDS: Readonly<Record<string, (deps: MenuRouterDeps) => void>> =
  {
    "Always on Top": (deps) => deps.toggleAlwaysOnTop(),
    "Toggle Sidebar": (deps) => deps.toggleSidebar(),
    "New Tab": (deps) => deps.newTab(),
    "Close Tab": (deps) => deps.closeTab(),
  };

/**
 * 执行窗口域 keyBinding 命令（映射表查表派发；AC-M-3 与菜单 action 同一函数）
 * @param commandId 快捷键命令名（conf.user.json keyBinding 键面）
 * @param deps 装配层命令回调集（App 层 menuDeps）
 */
export function runWindowKeybindingCommand(commandId: string, deps: MenuRouterDeps): void {
  const command = WINDOW_KEYBINDING_COMMANDS[commandId];
  if (command === undefined) {
    // 注册侧已按本表过滤，此处为防御分支（表收缩/调用面误用）——告警留痕不崩溃
    console.warn(`[MarkWell] 未知的窗口快捷键命令: ${commandId}`);
    return;
  }
  command(deps);
}

/** 编辑器域命令 id 前缀（"editor.<命令名>" → runEditorMenuCommand("<命令名>")） */
const EDITOR_PREFIX = "editor.";

/** 导出域命令 id 前缀（"export.<条目id>" → 条目 run） */
const EXPORT_PREFIX = "export.";

/** 主题选择 id 前缀（"themes.select.<主题名>" → selectTheme(activeMode, name)） */
const THEME_PREFIX = "themes.select.";

/** 最近文件打开 id 前缀（"file.open-recent.<路径>" → openFile(path)） */
const RECENT_PREFIX = "file.open-recent.";

/**
 * 剥离 id 前缀取载荷（未命中前缀返回 undefined）
 * @param id 菜单项 id
 * @param prefix 前缀（含分隔点）
 */
function stripPrefix(id: string, prefix: string): string | undefined {
  return id.startsWith(prefix) ? id.slice(prefix.length) : undefined;
}

/**
 * 构建菜单命令路由表（与 buildMenuTree 同输入源，保证 id 覆盖全表无孤儿）
 *
 * 前缀域（editor./export./themes.select./file.open-recent.）按前缀规则解析，
 * 其余 id 精确查表。
 *
 * @param deps 装配层注入的模块回调
 * @param input 动态数据（导出条目/当前色系；与菜单树构建同源）
 * @returns 路由表（run/has/ids）
 */
export function createMenuRouter(deps: MenuRouterDeps, input: MenuRouterInput): MenuRouter {
  const table: Map<string, () => void> = new Map<string, () => void>(
    Object.entries({
      "file.new": () => deps.newTab(),
      "file.new-tab": () => deps.newTab(),
      "file.new-window": () => deps.newWindow(),
      "file.open": () => deps.openFileDialog(),
      "file.open-quickly": () => deps.quickOpen(),
      "file.clear-recent": () => deps.clearRecent(),
      "file.reopen-closed": () => deps.reopenClosed(),
      "file.save": () => deps.save(),
      "file.save-as": () => deps.saveAs(),
      "file.preference": () => deps.preference(),
      "file.close": () => deps.closeTab(),
      "app.copy-as-markdown": () => deps.copyAsMarkdown(),
      "app.paste-as-plain-text": () => deps.pasteAsPlainText(),
      "app.toggle-find": () => deps.toggleFind(),
      "app.toggle-replace": () => deps.toggleReplace(),
      "app.find-next": () => deps.findNext(),
      "app.find-prev": () => deps.findPrev(),
      "view.toggle-sidebar": () => deps.toggleSidebar(),
      "view.panel-outline": () => deps.switchPanel("outline"),
      "view.panel-list": () => deps.switchPanel("list"),
      "view.panel-tree": () => deps.switchPanel("tree"),
      "view.global-search": () => deps.globalSearch(),
      "view.switch-doc": () => deps.switchDocNext(),
      // 源码模式（12 W4）：菜单 action 与 Ctrl+/ 快捷键共用同一 toggle 命令
      "view.source-mode": () => deps.toggleSourceMode(),
      // 专注/打字机模式（12 W5）：菜单 action 与 F8/F9 快捷键共用同一 toggle 命令
      "view.focus-mode": () => deps.toggleFocusMode(),
      "view.typewriter-mode": () => deps.toggleTypewriterMode(),
      "view.toggle-devtools": () => deps.toggleDevtools(),
      "view.fullscreen": () => deps.toggleFullscreen(),
      "view.zoom-in": () => deps.zoomIn(),
      "view.zoom-out": () => deps.zoomOut(),
      "view.zoom-actual": () => deps.zoomReset(),
      "view.always-on-top": () => deps.toggleAlwaysOnTop(),
      "themes.open-folder": () => deps.openThemeFolder(),
    } satisfies Record<string, () => void>),
  );

  return {
    run: (id: string): void => {
      const exact = table.get(id);
      if (exact !== undefined) {
        exact();
        return;
      }
      const editorCommandId = stripPrefix(id, EDITOR_PREFIX);
      if (editorCommandId !== undefined) {
        // 目录外命令返回 false：菜单可达但编辑器未就绪/不适用上下文，告警留痕
        if (!deps.runEditorCommand(editorCommandId)) {
          console.warn(
            `[MarkWell] 编辑器菜单命令未执行: ${editorCommandId}（目录外或上下文不适用）`,
          );
        }
        return;
      }
      const exportEntryId = stripPrefix(id, EXPORT_PREFIX);
      if (exportEntryId !== undefined) {
        const entry = input.exportEntries.find((e) => e.id === exportEntryId);
        if (entry === undefined) {
          console.warn(`[MarkWell] 导出菜单条目不存在: ${exportEntryId}（菜单重建滞后）`);
          return;
        }
        // 管线失败上抛（ExportError）：经装配层通知通道呈现，不静默
        entry
          .run()
          .catch((e: unknown) => deps.notifyError(`导出「${entry.label}」失败: ${String(e)}`));
        return;
      }
      const themeName = stripPrefix(id, THEME_PREFIX);
      if (themeName !== undefined) {
        deps.selectTheme(input.activeMode, themeName);
        return;
      }
      const recentPath = stripPrefix(id, RECENT_PREFIX);
      if (recentPath !== undefined) {
        deps.openFile(recentPath);
        return;
      }
      // 禁用项/未知 id：正常交互不可达，告警留痕不崩溃
      console.warn(`[MarkWell] 未知的菜单命令 id: ${id}`);
    },
  };
}
