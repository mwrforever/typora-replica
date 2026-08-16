<!-- App.vue
     应用根组件（02 装配：启动决策/文档会话/自动保存/快捷键；
     03 装配：侧栏/右键菜单/快捷键/拖入插链接/启动目录联动；
     布局为 03 阶段临时形态（编辑器 + 左侧栏），12 窗口外壳替换为完整窗口装配） -->
<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { getCurrentWindow } from "@tauri-apps/api/window";
import EditorPage from "./components/editor/EditorPage.vue";
import FileTreeMenu from "./features/file-tree/FileTreeMenu.vue";
import SidebarPanel from "./features/file-tree/SidebarPanel.vue";
import { registerFileTreeShortcuts } from "./features/file-tree/file-tree-shortcuts";
import { useFileTreeStore } from "./features/file-tree/file-tree-store";
import { RecentLocations } from "./features/file-tree/recent-locations";
import { relativeLinkPath } from "./features/file-tree/tree-utils";
import OpenQuicklyPanel from "./features/open-quickly/OpenQuicklyPanel.vue";
import { buildQuickItems } from "./features/open-quickly/open-quickly";
import type { QuickItem } from "./features/open-quickly/fuzzy";
import { AutoSaveController } from "./services/auto-save";
import { DraftRecovery } from "./services/draft-recovery";
import { DocumentSession } from "./services/document-session";
import { editorManager } from "./services/editor-manager";
import { getCliArgs, probePathExists } from "./services/file-io";
import { resolveLaunch } from "./services/launch-behavior";
import { openFolderDialog, saveAsDialog } from "./services/open-commands";
import { loadSettings } from "./services/settings";
import { registerAppShortcuts } from "./services/app-shortcuts";
import { RecentFiles } from "./services/recent-files";

/** 编辑器初始文档（随会话事件更新；docKey 强制重建编辑器实例） */
const initialDoc = ref("");
const docKey = ref(0);

/** 文档会话（单例；事件接线 UI 层） */
const session = new DocumentSession();
session.on({
  onDocumentChange: (doc) => {
    initialDoc.value = doc.content;
    docKey.value += 1;
  },
  onNotice: (notice) => {
    if (notice.level === "error") console.error("[MarkWell]", notice.message);
    else console.info("[MarkWell]", notice.message);
  },
});

/** 自动保存：停笔 1s ∪ 定时 5min（偏好开关联动） */
const autoSave = new AutoSaveController({
  session,
  getSettings: loadSettings,
  subscribeMarkdown: (cb) => editorManager.subscribeMarkdownUpdated(cb),
});

/** 草稿：5s 心跳 + 退出备份 */
const drafts = new DraftRecovery(session);

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
 * 打开文件夹（AC-F9-1）：空串走系统对话框选目录；随后 session.openFolder 切换
 * 文档目录 + fileTree.loadDir 拉取侧栏数据 + RecentLocations 记录最近位置。
 * 最近位置记录失败不阻断主流程（store 持久化异常静默吞掉）。
 */
async function handleOpenFolder(path: string): Promise<void> {
  if (!path) {
    const picked = await openFolderDialog();
    if (!picked) return;
    path = picked;
  }
  await session.openFolder(path);
  await fileTree.loadDir(path);
  await new RecentLocations().record(path).catch(() => undefined);
}

/**
 * 打开文件（F1-2 父目录加载）：session.openFile 走 02 文档链路；
 * 随后以 session.currentDir 为基准同步侧栏数据源（打开文件所在目录进入侧栏）。
 */
async function handleOpenFile(path: string): Promise<void> {
  await session.openFile(path);
  if (session.currentDir) await fileTree.loadDir(session.currentDir);
}

/**
 * 路径分隔符归一：反斜杠 → 正斜杠。
 * entries.path 为 Rust 反斜杠形态，菜单 targetPath 来自树节点（正斜杠），
 * 比较前必须归一（与 FileTreeMenu 的 C-2 教训同款），否则 Windows 下目录
 * 「打开」动作恒落入文件分支。
 */
function normalizePath(path: string): string {
  return path.replace(/\\/g, "/");
}

/**
 * 右键菜单「打开」动作（F4）：文件 → handleOpenFile；目录 → 展开/折叠。
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
 * 插入 `[名称](相对路径)` 到光标处。dragover 阻止默认行为以允许 drop。
 */
function onEditorDrop(event: DragEvent): void {
  const path = event.dataTransfer?.getData("application/x-markwell-path");
  if (!path || !session.currentDir) return;
  event.preventDefault();
  const name = path.split(/[/\\]/).pop() ?? path;
  const rel = relativeLinkPath(path, session.currentDir);
  editorManager.insertMarkdown(`[${name}](${rel})`);
}

/** 窗口级快捷键（12 窗口外壳可接管）：Ctrl+S 保存/另存、Ctrl+P 快速打开 */
const cleanupShortcuts = registerAppShortcuts({
  onSave: () => {
    if (session.currentPath) void session.save();
    else
      void (async () => {
        const target = await saveAsDialog();
        if (target) void session.saveAs(target);
      })();
  },
  onQuickOpen: () => {
    // 构建候选：当前目录 .md ∪ 最近文件（固定项保留）
    void (async () => {
      const recent = await new RecentFiles().list().catch(() => []);
      quickOpenItems.value = await buildQuickItems(session.currentDir, recent);
      quickOpenVisible.value = true;
    })();
  },
});

onMounted(async () => {
  // 启动链路：cli 参数 + 偏好 → 决策 → 加载文档（失败回退新建，提示不崩溃）
  const [cli, settings] = await Promise.all([getCliArgs(), loadSettings()]);
  // 路径存在性探测（I-1 修复）：listDir 优先——readFile 对目录必失败，
  // 旧内联 readFile 探测令文件夹存在性恒 false（AC-F14-1/2 失效根因）
  const decision = await resolveLaunch(cli, settings, probePathExists);
  if (decision.notice) session.notify({ level: "info", message: decision.notice });
  switch (decision.action) {
    case "new":
      session.newDocument();
      break;
    case "open-folder":
      await session.openFolder(decision.path);
      session.newDocument();
      break;
    case "open-file":
      // F14-2：restore-both 恢复上次文件夹为侧栏目录；--reopen-file 不恢复
      // 文件夹（Q 修复：避免陈旧 lastFolder 置顶污染最近文件列表）
      if (decision.restoreFolder && settings.launch.lastFolder) {
        await session.openFolder(settings.launch.lastFolder);
      }
      await session.openFile(decision.path);
      break;
  }
  // 启动决策落地后（open-folder/open-file 分支），同步 fileTreeStore.loadDir(session.currentDir)
  // ——侧栏数据源与文档目录一致（session.openFolder/openFile 只登记 currentDir，
  // 树数据由 store 独立拉取并订阅 watchDir 自动刷新；12 窗口外壳可替换此接线）
  if (session.currentDir) await fileTree.loadDir(session.currentDir);
  autoSave.start();
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
  autoSave.stop();
  drafts.stop();
  editorManager.destroy();
});
</script>

<template>
  <!-- 03 阶段临时布局：左侧栏 + 编辑器并排（12 窗口外壳替换为完整窗口装配） -->
  <div class="app-shell">
    <SidebarPanel
      @open-file="handleOpenFile"
      @open-folder="handleOpenFolder"
      @request-menu="(p) => (menu = { visible: true, x: p.x, y: p.y, targetPath: p.path })"
      @create-file="menu = { visible: true, x: 0, y: 0, targetPath: session.currentDir ?? '' }"
    />
    <!-- 编辑器宿主容器：dragover 阻止默认允许 drop，drop 消费文件树拖拽插链接（F7） -->
    <div class="editor-host" @dragover.prevent @drop="onEditorDrop">
      <EditorPage :initial-doc="initialDoc" :key="docKey" />
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
  />
  <OpenQuicklyPanel
    v-if="quickOpenVisible"
    :items="quickOpenItems"
    @select="
      (path) => {
        quickOpenVisible = false;
        void session.openFile(path);
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

.editor-host {
  flex: 1;
  min-width: 0;
}
</style>
