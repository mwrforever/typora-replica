<!-- App.vue
     应用根组件（02 装配：启动决策/文档会话/自动保存/快捷键；
     03 装配：侧栏/右键菜单/快捷键/拖入插链接/启动目录联动；
     04 装配：多标签控制器——TabHost 挂载、启动/打开/文件夹/保存改接激活会话；
     布局为 03 阶段临时形态（编辑器 + 左侧栏），12 窗口外壳替换为完整窗口装配） -->
<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { getCurrentWindow } from "@tauri-apps/api/window";
import FileTreeMenu from "./features/file-tree/FileTreeMenu.vue";
import SidebarPanel from "./features/file-tree/SidebarPanel.vue";
import { registerFileTreeShortcuts } from "./features/file-tree/file-tree-shortcuts";
import { useFileTreeStore } from "./features/file-tree/file-tree-store";
import { RecentLocations } from "./features/file-tree/recent-locations";
import { normalizePath, relativeLinkPath } from "./features/file-tree/tree-utils";
import OpenQuicklyPanel from "./features/open-quickly/OpenQuicklyPanel.vue";
import { buildQuickItems } from "./features/open-quickly/open-quickly";
import type { QuickItem } from "./features/open-quickly/fuzzy";
import { DraftRecovery } from "./features/document/draft-recovery";
import type { DocumentSession } from "./features/document/document-session";
import { editorManager } from "./features/editor/editor-manager";
import TabHost from "./features/tabs/TabHost.vue";
import TabBar from "./features/tabs/TabBar.vue";
import { registerTabsShortcuts } from "./features/tabs/tabs-shortcuts";
import { useTabsController } from "./features/tabs/tabs-controller";
import { getCliArgs, probePathExists } from "./services/file-io";
import { resolveLaunch } from "./services/launch-behavior";
import { openFolderDialog, saveAsDialog } from "./services/open-commands";
import { loadSettings } from "./services/settings";
import { registerAppShortcuts } from "./services/app-shortcuts";
import { RecentFiles } from "./services/recent-files";

/**
 * 多标签控制器（04：TabHost 挂载编排 + 每标签会话栈/自动保存；
 * 本文件所有会话消费改经 tabs.activeSession() 取激活标签会话）。
 * 控制器为模块级单例（useTabsController 与 TabHost 各调一次拿到同一实例）。
 */
const tabs = useTabsController();

/**
 * 草稿备份（P1 门面订阅：仅激活标签编辑触发心跳；dirty/currentPath 委托
 * 激活会话，Task 14 聚合改造）。DraftRecovery 构造签名要求 DocumentSession，
 * 此处以 getter 委托对象桥接——备份执行时点才解析激活会话，避免持有过期引用。
 */
const drafts = new DraftRecovery({
  get dirty(): boolean {
    return tabs.activeSession()?.dirty ?? false;
  },
  get currentPath(): string | undefined {
    return tabs.activeSession()?.currentPath;
  },
} as unknown as DocumentSession);

/** Ctrl+P 面板开关 */
const quickOpenVisible = ref(false);
/** 面板候选（打开时构建） */
const quickOpenItems = ref<QuickItem[]>([]);

/** 文件树侧栏状态（03：可见性/面板/树数据/展开集合，Pinia 单例） */
const fileTree = useFileTreeStore();

/** 右键菜单状态（fixed 定位坐标与目标路径；FileTreeMenu 浮层消费） */
const menu = ref({ visible: false, x: 0, y: 0, targetPath: "" });

/** 侧栏快捷键（03：Ctrl+Shift+L 侧栏开关、Ctrl+Shift+1/2/3 面板切换、Ctrl+Shift+F 搜索；12 可接管） */
const cleanupFileTreeShortcuts = registerFileTreeShortcuts({
  toggleSidebar: () => fileTree.toggleSidebar(),
  switchPanel: (key) => fileTree.switchPanel(key),
  showSearch: () => fileTree.showSearch(),
});

/**
 * 标签快捷键（04：Ctrl+N 新建 / Ctrl+W 关闭 / Ctrl+Tab 轮换 / Ctrl+Shift+T 重开；
 * 12 窗口外壳可整体接管）。Ctrl+W 关闭激活标签（P1 直关，脏确认分支 Task 13 接）。
 */
const cleanupTabsShortcuts = registerTabsShortcuts({
  onNewTab: () => tabs.createUntitled(),
  onCloseTab: () => {
    const active = tabs.store.activeTab;
    if (active) tabs.closeTab(active.id);
  },
  onCycle: (dir) => tabs.cycle(dir),
  onReopenClosed: () => tabs.reopenClosed(),
});

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
 */
async function handleOpenFile(path: string): Promise<void> {
  const created = await tabs.openFile(path, basenameOf(path));
  if (created) {
    const dir = dirnameOf(path);
    if (dir) await fileTree.loadDir(dir);
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

/**
 * 编辑器宿主容器 drop：文件树拖入插链接（F7，AC-F7-1/2/3 文件与文件夹均支持）
 *
 * 仅接受树内条目（application/x-markwell-path 由 FileTreeItem dragstart 写入，
 * 携带完整路径）；名称取末级，相对路径含扩展名经 relativeLinkPath 计算，
 * 插入 `[名称](相对路径)` 到光标处。相对基准为激活标签会话当前目录
 * （无激活会话/目录时忽略）。dragover 阻止默认行为以允许 drop。
 */
function onEditorDrop(event: DragEvent): void {
  const session = tabs.activeSession();
  const path = event.dataTransfer?.getData("application/x-markwell-path");
  if (!path || !session?.currentDir) return;
  event.preventDefault();
  const name = path.split(/[/\\]/).pop() ?? path;
  const rel = relativeLinkPath(path, session.currentDir);
  editorManager.insertMarkdown(`[${name}](${rel})`);
}

/** 窗口级快捷键（12 窗口外壳可接管）：Ctrl+S 保存/另存、Ctrl+P 快速打开 */
const cleanupShortcuts = registerAppShortcuts({
  onSave: () => {
    const session = tabs.activeSession();
    if (session?.currentPath) void session.save();
    else
      void (async () => {
        const target = await saveAsDialog();
        if (target) void tabs.activeSession()?.saveAs(target);
      })();
  },
  onQuickOpen: () => {
    // 构建候选：激活标签当前目录 .md ∪ 最近文件（固定项保留）
    void (async () => {
      const recent = await new RecentFiles().list().catch(() => []);
      quickOpenItems.value = await buildQuickItems(tabs.activeSession()?.currentDir, recent);
      quickOpenVisible.value = true;
    })();
  },
});

onMounted(async () => {
  // 启动链路：cli 参数 + 偏好 → 决策 → 多标签装配（失败回退新建，提示不崩溃）
  const [cli, settings] = await Promise.all([getCliArgs(), loadSettings()]);
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
  cleanupShortcuts();
  cleanupFileTreeShortcuts();
  cleanupTabsShortcuts();
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
  <!-- 03 阶段临时布局：左侧栏 + 编辑器并排（12 窗口外壳替换为完整窗口装配） -->
  <div class="app-shell">
    <SidebarPanel
      @open-file="handleOpenFile"
      @open-folder="handleOpenFolder"
      @request-menu="(p) => (menu = { visible: true, x: p.x, y: p.y, targetPath: p.path })"
      @create-file="
        menu = { visible: true, x: 0, y: 0, targetPath: tabs.activeSession()?.currentDir ?? '' }
      "
    />
    <!-- 编辑器宿主容器：dragover 阻止默认允许 drop，drop 消费文件树拖拽插链接（F7） -->
    <div class="editor-host" @dragover.prevent @drop="onEditorDrop">
      <!-- 标签条（04）：渲染/激活/关闭/脏标记；close 直关（P1，脏分支 Task 13） -->
      <TabBar
        :tabs="tabs.store.tabs"
        :active-tab-id="tabs.store.activeTabId"
        @activate="tabs.activate"
        @close="(id) => tabs.closeTab(id)"
      />
      <!-- 宿主主体：flex:1 占满剩余高度（TabBar 高度固定在上方） -->
      <div class="editor-host__body">
        <TabHost />
      </div>
    </div>
  </div>
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
</template>

<style scoped>
/* 03 阶段临时布局：侧栏（左 260px）+ 编辑器（右弹性填充）并排（12 窗口外壳替换） */
.app-shell {
  display: flex;
  height: 100vh;
}

/* 04：编辑器宿主改纵向 flex——标签条固定高度，宿主主体弹性占满剩余空间 */
.editor-host {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.editor-host__body {
  flex: 1;
  min-height: 0;
}
</style>
