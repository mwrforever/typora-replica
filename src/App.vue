<!-- App.vue
     应用根组件（02 装配：启动决策/文档会话/自动保存/快捷键；
     03 装配：右键菜单/拖入联动/启动目录联动（侧栏及其快捷键已迁 12 外壳 AppShell）；
     04 装配：多标签控制器——启动/打开/文件夹/保存改接激活会话；
     12 装配：布局骨架归 components/layout/AppShell.vue（侧栏容器/中央区/状态栏容器），
     本组件保留启动决策链与全局单例浮层（菜单/快速打开/查找替换/关闭确认/设置面板），
     并装配 12 W2 原生菜单（menuRouter 命令依赖注入 + Themes/Open Recent 动态重建
     + autoHideMenuBar Alt 切换）与 12 W3 窗口控制（全屏/缩放/置顶/新建窗口，
     菜单项与快捷键统一经 menuDeps/windowControls 同一命令函数单一执行） -->
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { getCurrentWindow } from "@tauri-apps/api/window";
import AppShell from "./components/layout/AppShell.vue";
import FileTreeMenu from "./features/file-tree/FileTreeMenu.vue";
import { useFileTreeStore } from "./features/file-tree/file-tree-store";
import { RecentLocations } from "./features/file-tree/recent-locations";
import { normalizePath } from "./features/file-tree/tree-utils";
import OpenQuicklyPanel from "./features/open-quickly/OpenQuicklyPanel.vue";
import { buildQuickItems } from "./features/open-quickly/open-quickly";
import type { QuickItem } from "./features/open-quickly/fuzzy";
import { DraftRecovery } from "./features/document/draft-recovery";
import { editorManager } from "./features/editor/editor-manager";
import { runEditorMenuCommand } from "./features/editor/keymaps";
import { registerImageFeature } from "./features/image/register";
import { registerThemeFeature } from "./features/theme/register";
import { useThemeStore } from "./features/theme/theme-store";
import { toggleDevtools, openThemeFolder } from "./services/theme-io";
import ConfirmCloseDialog from "./features/tabs/ConfirmCloseDialog.vue";
import { registerTabsShortcuts } from "./features/tabs/tabs-shortcuts";
import { useTabsController } from "./features/tabs/tabs-controller";
import FindReplacePanel from "./features/search/FindReplacePanel.vue";
import { navigateNext, navigatePrev } from "./features/search/find-controller";
import { registerSearchShortcuts } from "./features/search/search-shortcuts";
import { useSearchStore } from "./features/search/search-store";
import SettingsPanel from "./features/settings/SettingsPanel.vue";
import { registerSettingsShortcuts } from "./features/settings/settings-shortcuts";
import { useSettingsStore } from "./features/settings/settings-store";
import { applyKeyBindings } from "./features/settings/shortcut-binding";
import { useNativeMenu } from "./features/window-shell/use-native-menu";
import { useAutoHideMenu } from "./features/window-shell/use-auto-hide-menu";
import { createWindowControls } from "./features/window-shell/use-window-controls";
import { registerWindowShellShortcuts } from "./features/window-shell/window-shortcuts";
import type { MenuRouterDeps } from "./features/window-shell/menu-router";
import { setNativeMenuVisible } from "./services/menu-io";
import {
  createMainWindow,
  isMainWindow,
  isWindowFullscreen,
  setWebviewZoom,
  toggleAlwaysOnTop,
  toggleFullscreen,
} from "./services/window-io";
import { getCliArgs, probePathExists } from "./services/file-io";
import { resolveLaunch } from "./services/launch-behavior";
import {
  openFileDialog as openFileDialogCommand,
  openFolderDialog,
  saveAsDialog,
} from "./services/open-commands";
import { DEFAULT_SETTINGS } from "./services/settings";
import { registerAppShortcuts } from "./services/app-shortcuts";
import { RecentFiles } from "./services/recent-files";

/**
 * 多标签控制器（04：TabHost 挂载编排 + 每标签会话栈/自动保存；
 * 本文件所有会话消费改经 tabs.activeSession() 取激活标签会话）。
 * 控制器为模块级单例（useTabsController 与 TabHost 各调一次拿到同一实例）。
 */
const tabs = useTabsController();

/**
 * C2 关闭确认挂起请求（弹窗显隐/标题驱动）。controller 为非响应式普通对象，
 * 模板不会自动解包嵌套 ref → 此处顶层 computed 解包，模板侧直接消费且 v-if 可收窄。
 */
const closeRequest = computed(() => tabs.closeRequest.value);

/**
 * 草稿备份（04 聚合，D1 裁决落地：心跳/退出备份覆盖全部脏标签）。
 * 提供器惰性取快照：备份执行时点过滤 store 脏标签，per-tab 经 getContext
 * 序列化（挂载实例含 FM 回写；未挂载 contentSnapshot 兜底）。
 * 心跳订阅仍为门面流（任意标签编辑唤醒 → 5s 后遍历全部脏标签）。
 */
const drafts = new DraftRecovery(() =>
  tabs.store.tabs
    .filter((t) => t.dirty)
    .map((t) => {
      const ctx = tabs.getContext(t.id); // per-tab 序列化闭包（Task 14）
      return {
        path: t.path,
        content: ctx ? ctx.serialize() : (t.contentSnapshot ?? ""),
      };
    }),
);

/** Ctrl+P 面板开关 */
const quickOpenVisible = ref(false);
/** 面板候选（打开时构建） */
const quickOpenItems = ref<QuickItem[]>([]);

/** 文件树侧栏状态（03：目录数据/展开集合——启动联动与右键菜单消费；显隐/面板切换归 12 外壳） */
const fileTree = useFileTreeStore();

/** 右键菜单状态（fixed 定位坐标与目标路径；FileTreeMenu 浮层消费） */
const menu = ref({ visible: false, x: 0, y: 0, targetPath: "" });

/** 搜索面板状态（06：Ctrl+F/H 开关、F3/Shift+F3 导航、ESC 关闭回焦） */
const searchStore = useSearchStore();

/** 偏好设置面板状态（10：Ctrl+, 开合；触发入口统一走 menuDeps.preference） */
const settingsStore = useSettingsStore();

/** 主题状态（08：Themes 菜单主题列表/切换命令依赖） */
const themeStore = useThemeStore();

/**
 * 打开文件夹（AC-F9-1）：空串走系统对话框选目录；随后激活标签会话 openFolder
 * 登记目录（lastFolder 偏好持久化）+ fileTree.loadDir 拉取侧栏数据 +
 * RecentLocations 记录最近位置。最近位置记录失败不阻断主流程
 * （store 持久化异常静默吞掉）。会话未挂载（optional chain 落空）时仅侧栏
 * 联动，目录登记缺失为 P1 已知边缘（实例上缴前调用场景）。
 */
async function handleOpenFolder(path: string): Promise<void> {
  if (!path) {
    const picked = await openFolderDialog();
    if (!picked) return;
    path = picked;
  }
  await tabs.activeSession()?.openFolder(path);
  await fileTree.loadDir(path);
  await new RecentLocations().record(path).catch(() => undefined);
}

/**
 * 打开文件（F1-2 父目录加载）：controller.openFile 走多标签链路——同路径
 * 去重激活既有标签（created=false 不联动）；新标签内容就绪后以文件父目录
 * 为基准同步侧栏数据源（打开时一次性联动，切标签不重载侧栏）。
 * 打开成功刷新 File → Open Recent 子菜单（最近文件列表变化 → 重建）。
 */
async function handleOpenFile(path: string): Promise<void> {
  const created = await tabs.openFile(path, basenameOf(path));
  if (created) {
    const dir = dirnameOf(path);
    if (dir) await fileTree.loadDir(dir);
    await menuHandle?.refreshRecent();
  }
}

/**
 * 右键菜单「打开」动作（F4）：文件 → handleOpenFile；目录 → 展开/折叠。
 * entries 比较前经公共 normalizePath 归一（分隔符 + Windows verbatim 前缀，
 * I-1：Rust 侧 entry.path 带 \\?\ 前缀，剥离后目录判断才能命中）。
 * 展开键取 entry.name——Rust 侧 name 即根相对 / 分隔路径（= 树节点 relPath），
 * 与 store.toggleExpand/expandedPaths 的 relPath 契约一致；03 阶段目录打开
 * 简化为展开语义（12 窗口外壳可扩展为进入目录）。
 */
function handleMenuOpen(path: string): void {
  const entry = fileTree.entries.find((e) => normalizePath(e.path) === path);
  if (entry?.isDir) {
    fileTree.toggleExpand(entry.name);
  } else if (path) {
    void handleOpenFile(path);
  }
}

/** 08 主题装配注销句柄（onMounted 赋值；undefined=尚未装配，宪法 A.1.2.3 用 undefined） */
let cleanupThemeFeature: (() => void) | undefined;

/**
 * 窗口控制状态机（12 W3：全屏/缩放/置顶/新窗口的命令编排；IPC 面接 services/window-io）。
 * 菜单 action 与窗口快捷键共用本控制器方法（AC-M-3 单一执行路径）；菜单栏显隐联动
 * 经 applyMenuVisible 转 autoHideMenuBar 状态机（onMounted 装配，optional chain 防御
 * 装配前调用）。
 */
const windowControls = createWindowControls({
  toggleFullscreenIpc: toggleFullscreen,
  readFullscreenIpc: isWindowFullscreen,
  toggleAlwaysOnTopIpc: toggleAlwaysOnTop,
  setZoomIpc: setWebviewZoom,
  createWindowIpc: () => createMainWindow(),
  applyMenuVisible: (visible) => autoHideHandle?.applyVisible(visible),
});

/**
 * 菜单命令路由依赖（12 menuRouter 单一命令函数来源；窗口快捷键回调与菜单 action
 * 共用同一批函数引用——AC-M-3 单一执行路径）。
 * 命令覆盖：文件域（新建/打开/保存）、编辑域（剪贴板/查找）、视图域（侧栏/搜索/
 * DevTools）、主题域（切换/打开目录）；编辑器域命令统一经 runEditorMenuCommand
 * 走 01 命令目录（与 keyBinding 注入同源）。
 */
const menuDeps: MenuRouterDeps = {
  runEditorCommand: (commandId) => runEditorMenuCommand(commandId, () => editorManager.getEditor()),
  newTab: () => tabs.createUntitled(),
  openFile: (path) => void handleOpenFile(path),
  openFileDialog: () => {
    void openFileDialogCommand().then((picked) => {
      if (picked) void handleOpenFile(picked);
    });
  },
  quickOpen: () => {
    // 构建候选：激活标签当前目录 .md ∪ 最近文件（固定项保留）
    void (async () => {
      const recent = await new RecentFiles().list().catch(() => []);
      quickOpenItems.value = await buildQuickItems(tabs.activeSession()?.currentDir, recent);
      quickOpenVisible.value = true;
    })();
  },
  clearRecent: () => {
    void new RecentFiles()
      .clear()
      .then(() => menuHandle?.refreshRecent())
      .catch((e: unknown) => console.error("[MarkWell] 清除最近文件列表失败", e));
  },
  reopenClosed: () => tabs.reopenClosed(),
  save: () => {
    // 有路径直存；未命名标签转另存为对话框（既有 Ctrl+S 语义，菜单 Save 同路径）
    const session = tabs.activeSession();
    if (session?.currentPath) void session.save();
    else menuDeps.saveAs();
  },
  saveAs: () => {
    void saveAsDialog().then((target) => {
      if (target) void tabs.activeSession()?.saveAs(target);
    });
  },
  preference: () => settingsStore.togglePanel(),
  closeTab: () => {
    const active = tabs.store.activeTab;
    if (active) tabs.closeTab(active.id);
  },
  copyAsMarkdown: () => {
    void navigator.clipboard
      .writeText(editorManager.getMarkdown())
      .catch((e: unknown) => console.error("[MarkWell] 复制为 Markdown 失败", e));
  },
  pasteAsPlainText: () => {
    void navigator.clipboard
      .readText()
      .then((text) => {
        if (text !== "") editorManager.insertMarkdown(text);
      })
      .catch((e: unknown) => console.error("[MarkWell] 粘贴为纯文本失败（剪贴板不可读）", e));
  },
  toggleFind: () => {
    // 面板可见时 Ctrl+F 归面板内搜索（SettingsPanel 接管聚焦其搜索框）
    if (settingsStore.visible) return;
    searchStore.toggleFind();
  },
  toggleReplace: () => searchStore.toggleReplace(),
  findNext: () => navigateNext(),
  findPrev: () => navigatePrev(),
  toggleSidebar: () => fileTree.toggleSidebar(),
  switchPanel: (key) => fileTree.switchPanel(key),
  globalSearch: () => fileTree.showSearch(),
  switchDocNext: () => tabs.cycle(1),
  toggleDevtools: () => {
    // 开合结果无需消费；失败（构建不支持/IPC 异常）仅记录不打断交互
    void toggleDevtools().catch((e: unknown) => {
      console.error("[MarkWell] DevTools 切换失败", e);
    });
  },
  // 12 W3 窗口控制（AC-M-13~16）：与快捷键共用 windowControls 同一命令方法
  toggleFullscreen: () => windowControls.toggleFullscreen(),
  zoomIn: () => windowControls.zoomIn(),
  zoomOut: () => windowControls.zoomOut(),
  zoomReset: () => windowControls.zoomReset(),
  toggleAlwaysOnTop: () => windowControls.toggleAlwaysOnTop(),
  newWindow: () => windowControls.newWindow(),
  selectTheme: (mode, name) => void themeStore.selectTheme(mode, name),
  openThemeFolder: () => {
    void openThemeFolder().catch((e: unknown) => {
      console.error("[MarkWell] 打开主题文件夹失败", e);
    });
  },
  notifyError: (message) => {
    // 会话通知优先（既有通知通道）；无激活会话回落控制台留痕
    const session = tabs.activeSession();
    if (session) session.notify({ level: "error", message });
    else console.error(`[MarkWell] ${message}`);
  },
};

/**
 * 标签快捷键（04：Ctrl+N 新建 / Ctrl+W 关闭 / Ctrl+Tab 轮换 / Ctrl+Shift+T 重开）。
 * 回调与菜单 action 共用 menuDeps 命令函数（Ctrl+Tab 双向轮换无菜单对偶，保留直呼）。
 */
const cleanupTabsShortcuts = registerTabsShortcuts({
  onNewTab: menuDeps.newTab,
  onCloseTab: menuDeps.closeTab,
  onCycle: (dir) => tabs.cycle(dir),
  onReopenClosed: menuDeps.reopenClosed,
});

/** 搜索快捷键（06）：回调与菜单共用 menuDeps（ESC 关闭无菜单对偶，保留守卫直呼） */
const cleanupSearchShortcuts = registerSearchShortcuts({
  onToggleFind: menuDeps.toggleFind,
  onToggleReplace: menuDeps.toggleReplace,
  onNext: menuDeps.findNext,
  onPrev: menuDeps.findPrev,
  // 可见性守卫在本处：不可见时 ESC 不抢焦点（latex 公式浮层的 ESC 归其自身处理）
  onClose: () => {
    if (!searchStore.visible) return;
    searchStore.close();
    editorManager.getView()?.focus();
  },
});

/** 面板开合快捷键（Ctrl+,；与菜单「偏好设置」同一命令函数） */
const cleanupSettingsShortcuts = registerSettingsShortcuts({
  onTogglePanel: menuDeps.preference,
});

/** 窗口级快捷键：Ctrl+S 保存、Ctrl+P 快速打开（与菜单项同一命令函数） */
const cleanupShortcuts = registerAppShortcuts({
  onSave: menuDeps.save,
  onQuickOpen: menuDeps.quickOpen,
});

/** 窗口外壳快捷键（12 W2）：Ctrl+O 打开 / Ctrl+Shift+S 另存为；
 * 12 W3：F11 全屏 / Ctrl+Shift+0/=/- 缩放三键 / Ctrl+Shift+N 新建窗口（菜单对偶注册） */
const cleanupWindowShellShortcuts = registerWindowShellShortcuts({
  onOpenFile: menuDeps.openFileDialog,
  onSaveAs: menuDeps.saveAs,
  onToggleFullscreen: menuDeps.toggleFullscreen,
  onZoomIn: menuDeps.zoomIn,
  onZoomOut: menuDeps.zoomOut,
  onZoomReset: menuDeps.zoomReset,
  onNewWindow: menuDeps.newWindow,
});

/** Alt 切换状态机句柄（onMounted 赋值；undefined=尚未装配——全屏联动经 optional chain 防御） */
let autoHideHandle: ReturnType<typeof useAutoHideMenu> | undefined;

/**
 * 原生菜单装配句柄（onMounted 赋值；undefined=尚未装配，optional chain 防御——
 * handleOpenFile 在装配前打开文件（启动链路）时刷新为空操作）
 */
let menuHandle: ReturnType<typeof useNativeMenu> | undefined;

/** Alt 切换状态机注销句柄（onMounted 赋值；undefined=尚未装配） */
let cleanupAutoHideMenu: (() => void) | undefined;

onMounted(async () => {
  // 07 图片功能装配（幂等，仅启动调一次）：onUpload 真实实现注入 01 注册表 +
  // 设置快照预加载/失效订阅。先于启动决策执行，保证首标签挂载前注册表就绪
  registerImageFeature();
  // 08 主题装配（cleanup 含色系退订与防抖定时器清理）
  cleanupThemeFeature = registerThemeFeature();
  // 10 设置快捷键：双层设置装载必须先于启动决策——conf.user.json 的 keyBinding 注入
  // （applyKeyBindings）要赶在首标签编辑器 create() 之前（applyEditorKeymaps 在 config
  // 阶段消费注册表）。装载失败不阻断（store 内部已回退默认值）
  await settingsStore.load();
  // keyBinding 注入（AC-C1-2 重启生效 / AC-C1-3 自定义优先 / AC-C1-4 非法告警忽略）
  applyKeyBindings(settingsStore.advanced?.keyBinding ?? {});
  // 12 W2 原生菜单装配（须在设置装载后：菜单 label 依赖 keyBinding 合并结果）；
  // 装配失败已在 composable 内告警降级，不阻断启动链路
  menuHandle = useNativeMenu({ deps: menuDeps });
  // autoHideMenuBar（AC-M-5）：消费既有设置键门控 Alt 单按切换（false 不响应）
  const autoHide = useAutoHideMenu({
    isEnabled: () => settingsStore.advanced?.autoHideMenuBar === true,
    setMenuVisible: setNativeMenuVisible,
  });
  autoHideHandle = autoHide;
  cleanupAutoHideMenu = autoHide.cleanup;
  // 12 W3 启动对齐（AC-M-17）：window-state 恢复的全屏态同步菜单栏隐藏——
  // 「进入全屏即隐菜单」语义必须覆盖重启恢复路径；须在 Alt 状态机装配后执行
  void windowControls.syncFullscreenAtStartup();
  // 启动链路（仅主窗口）：cli 参数 + 偏好 → 决策 → 多标签装配（失败回退新建，
  // 提示不崩溃）。12 W3 次窗口（New Window 创建，AC-M-16）不复制主窗口启动决策
  //——cli 参数/重启恢复偏好属主窗口启动语义，次窗口恒新建空文档标签（独立标签状态）。
  // 偏好复用 settingsStore 已装载的 GUI 快照（避免二次读盘；undefined 防御回落默认）
  if (isMainWindow()) {
    const cli = await getCliArgs();
    const settings = settingsStore.gui ?? DEFAULT_SETTINGS;
    // 路径存在性探测（I-1 修复）：listDir 优先——readFile 对目录必失败，
    // 旧内联 readFile 探测令文件夹存在性恒 false（AC-F14-1/2 失效根因）
    const decision = await resolveLaunch(cli, settings, probePathExists);
    switch (decision.action) {
      case "new":
        tabs.createUntitled();
        break;
      case "open-folder":
        // 02 语义（openFolder + newDocument）：空文档标签 + 目录登记/侧栏联动
        tabs.createUntitled();
        await handleOpenFolder(decision.path);
        break;
      case "open-file":
        // F14-2：restore-both 恢复上次文件夹为侧栏目录（目录先入侧栏再打开文件，
        // 不再被文件父目录覆盖）；纯 --reopen-file 走 handleOpenFile——F1-2 语义
        // 父目录进侧栏（内部已含 created 才 loadDir 联动，不重复加载）。
        // Q 修复：--reopen-file 不恢复文件夹，避免陈旧 lastFolder 置顶污染最近文件列表
        if (decision.restoreFolder && settings.launch.lastFolder) {
          await handleOpenFolder(settings.launch.lastFolder);
          await tabs.openFile(decision.path, basenameOf(decision.path));
        } else {
          await handleOpenFile(decision.path);
        }
        break;
    }
    // 启动提示（回退新建原因等）：会话可能尚未挂载（实例上缴前无激活会话），
    // optional chain 安全投递——挂载前丢弃可接受（P1 控制台通知口径）
    if (decision.notice) tabs.activeSession()?.notify({ level: "info", message: decision.notice });
  } else {
    tabs.createUntitled();
  }
  // 草稿心跳：门面 markdownUpdated 流（仅激活标签编辑触发，P1 语义）
  drafts.start((cb) => editorManager.subscribeMarkdownUpdated(cb));
  drafts.setupExitBackup(async (onCloseHandler) => {
    // 正常退出：先备份未保存内容再放行关闭（12 窗口外壳可替换关闭流程）
    await getCurrentWindow().onCloseRequested(async (event) => {
      event.preventDefault();
      await onCloseHandler();
      await getCurrentWindow().destroy();
    });
  });
});

onBeforeUnmount(() => {
  // 08 主题装配注销（含系统色系退订与防抖定时器清理；未装配时 optional chain 落空）
  cleanupThemeFeature?.();
  // 12 W2 菜单订阅退订 + Alt 切换监听移除（detached 订阅自持取消，B.2.4）
  menuHandle?.cleanup();
  cleanupAutoHideMenu?.();
  cleanupShortcuts();
  cleanupWindowShellShortcuts();
  cleanupTabsShortcuts();
  cleanupSearchShortcuts();
  cleanupSettingsShortcuts();
  drafts.stop();
  // 门面销毁由 04 集成层负责（被动挂载不自动 destroy；应用卸载即终态）
  editorManager.destroy();
});

/** 取路径父目录（末尾分隔符去除；无分隔符返回 undefined——与 document-session 同构，不扩其导出面） */
function dirnameOf(path: string): string | undefined {
  const idx = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return idx === -1 ? undefined : path.slice(0, idx);
}

/** 取路径文件名（与 document-session/open-quickly 同构） */
function basenameOf(path: string): string {
  const idx = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return idx === -1 ? path : path.slice(idx + 1);
}
</script>

<template>
  <!-- 12 窗口外壳：三区布局装配（侧栏容器/中央区/状态栏容器）；
       业务事件上抛本层处理（打开文件/文件夹、右键菜单、新建） -->
  <AppShell
    @open-file="handleOpenFile"
    @open-folder="handleOpenFolder"
    @request-menu="(p) => (menu = { visible: true, x: p.x, y: p.y, targetPath: p.path })"
    @create-file="
      menu = { visible: true, x: 0, y: 0, targetPath: tabs.activeSession()?.currentDir ?? '' }
    "
  />
  <!-- 文件树右键菜单浮层（fixed 定位；状态由 App 层 menu ref 持有，v-if 控制渲染） -->
  <FileTreeMenu
    v-if="menu.visible"
    :visible="menu.visible"
    :x="menu.x"
    :y="menu.y"
    :target-path="menu.targetPath"
    @close="menu.visible = false"
    @refresh="fileTree.refresh"
    @open="handleMenuOpen"
    @notice="(msg) => console.error('[MarkWell]', msg)"
  />
  <OpenQuicklyPanel
    v-if="quickOpenVisible"
    :items="quickOpenItems"
    @select="
      (path) => {
        quickOpenVisible = false;
        void handleOpenFile(path);
      }
    "
    @close="quickOpenVisible = false"
  />
  <!-- 查找/替换浮层（06）：常驻挂载（内部 v-if 控显隐），装配订阅随组件存活 -->
  <FindReplacePanel />
  <!-- C2 关闭确认（04）：脏标签关闭挂起时弹出；三按钮分派保存/不保存/取消 -->
  <ConfirmCloseDialog
    v-if="closeRequest"
    :title="closeRequest.title"
    @save="tabs.confirmCloseSave"
    @discard="tabs.confirmCloseDiscard"
    @cancel="tabs.cancelClose"
  />
  <!-- 偏好设置面板浮层（10）：显隐由 settingsStore.visible 驱动，内部自管开合 -->
  <SettingsPanel />
</template>
