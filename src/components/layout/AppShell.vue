<!-- AppShell（12 窗口外壳 W1）：应用装配骨架
     三区布局 = 侧栏容器（装配 03 SidebarPanel：v-show 开合 + 宽度拖拽持久化 AC-M-23）
     + 中央区（04 TabBar 标签条 + TabHost 标签宿主；drop 消费文件树拖入插链接 F7）
     + 状态栏容器（11 StatusBar，文档流占位）。
     职责边界：面板开合/当前面板的领域状态归 03 fileTree store（外壳只消费不复制）；
     侧栏快捷键注册自 App.vue 迁入（AC-M-22，注册器仍为 03 既有服务——组合键单一事实源）；
     侧栏宽度偏好经 10 设置 layout 组持久化（AC-M-23，跨重启恢复）；
     侧栏/中央区业务事件经 emits 上抛 App 层（打开文件/文件夹、右键菜单、新建）。 -->
<script setup lang="ts">
import { onBeforeUnmount } from "vue";
import SidebarPanel from "../../features/file-tree/SidebarPanel.vue";
import { registerFileTreeShortcuts } from "../../features/file-tree/file-tree-shortcuts";
import { useFileTreeStore } from "../../features/file-tree/file-tree-store";
import { relativeLinkPath } from "../../features/file-tree/tree-utils";
import TabBar from "../../features/tabs/TabBar.vue";
import TabHost from "../../features/tabs/TabHost.vue";
import { useTabsController } from "../../features/tabs/tabs-controller";
import SourceModeLayer from "../../features/window-shell/SourceModeLayer.vue";
import { useSourceMode } from "../../features/window-shell/source-mode";
import StatusBar from "../../features/status-bar/StatusBar.vue";
import { editorManager } from "../../features/editor/editor-manager";
import { useSettingsStore } from "../../features/settings/settings-store";
import { useSidebarLayout } from "../../features/window-shell/use-sidebar-layout";

const emit = defineEmits<{
  /** 侧栏请求打开文件（03 面板 → App 层多标签链路） */
  "open-file": [path: string];
  /** 侧栏请求打开文件夹（空串 = 弹系统选目录对话框，App 层处理） */
  "open-folder": [path: string];
  /** 侧栏请求右键菜单（坐标 + 目标路径；菜单浮层归 App 层装配） */
  "request-menu": [payload: { path: string; x: number; y: number }];
  /** 侧栏新建文件按钮（App 层以当前目录弹菜单） */
  "create-file": [];
}>();

/** 文件树侧栏状态（03：可见性/面板/树数据——外壳只消费，不复制状态） */
const fileTree = useFileTreeStore();
/** 偏好设置快照（10：侧栏宽度持久化来源与写回通道） */
const settings = useSettingsStore();
/** 多标签控制器（04 模块级单例，与 App.vue/TabHost 同实例） */
const tabs = useTabsController();

// 源码模式（12 W4）：active 驱动中央区 v-show 互斥显隐——Crepe（TabHost 内各标签
// 实例）与 CodeMirror（SourceModeLayer 内单活跃标签实例）双实例保活，切换零销毁；
// 切换命令经单例 toggle（App.vue 菜单/Ctrl+/ 与本层同源）。Top 注释见 SourceModeLayer。
const { active: sourceModeActive } = useSourceMode();

// 侧栏快捷键（AC-M-22）：Ctrl+Shift+L 开合、Ctrl+Shift+1/2/3 面板切换、Ctrl+Shift+F 搜索。
// 注册器为 03 既有服务（组合键与 catalog「Toggle Sidebar = Ctrl+Shift+L」一致，单一事实源）；
// 三回调语义自 App.vue 原样迁入（消费 03 store，行为零变化），注销随外壳卸载。
const cleanupFileTreeShortcuts = registerFileTreeShortcuts({
  toggleSidebar: () => fileTree.toggleSidebar(),
  switchPanel: (key) => fileTree.switchPanel(key),
  showSearch: () => fileTree.showSearch(),
});

// 侧栏宽度拖拽（AC-M-23）：拖拽实时改宽，松开且实际变化时经 10 设置 layout 组持久化；
// 持久化失败静默（下次启动回落存量/默认值，不阻断交互）
const { width, startDrag } = useSidebarLayout({
  storedWidth: () => settings.merged.layout.sidebarWidth,
  onPersist: (sidebarWidth) => {
    void settings.updateGui({ layout: { sidebarWidth } }).catch(() => undefined);
  },
});

onBeforeUnmount(() => {
  cleanupFileTreeShortcuts();
});

/**
 * 中央区容器 drop：文件树拖入插链接（F7，AC-F7-1/2/3；语义自 App.vue 原样迁入）。
 * 仅接受树内条目（application/x-markwell-path），相对路径插入 `[名称](相对路径)`
 * 到光标处；相对基准为激活标签会话当前目录（无激活会话/目录时忽略）。
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
</script>

<template>
  <div class="app-shell">
    <div class="app-shell__main">
      <!-- 侧栏容器：显隐经外壳 v-show 控制（宽度由拖拽状态机驱动）；
           03 SidebarPanel 根部自带 v-if 的现状保持（双通道差异见 PR 披露清单） -->
      <div
        v-show="fileTree.sidebarVisible"
        class="app-shell__sidebar"
        :style="{ width: `${width}px` }"
        data-testid="sidebar-container"
      >
        <SidebarPanel
          @open-file="(p) => emit('open-file', p)"
          @open-folder="(p) => emit('open-folder', p)"
          @request-menu="(p) => emit('request-menu', p)"
          @create-file="emit('create-file')"
        />
      </div>
      <!-- 宽度拖拽手柄：仅侧栏可见时可拖（隐藏态无手柄防误触） -->
      <div
        v-show="fileTree.sidebarVisible"
        class="app-shell__sidebar-resize"
        role="separator"
        aria-orientation="vertical"
        aria-label="调整侧栏宽度"
        @mousedown="startDrag"
      ></div>
      <!-- 中央区：标签条 + 标签宿主（04）；dragover 阻止默认允许 drop（F7 插链接） -->
      <div class="app-shell__center" @dragover.prevent @drop="onEditorDrop">
        <TabBar
          :tabs="tabs.store.tabs"
          :active-tab-id="tabs.store.activeTabId"
          @activate="tabs.activate"
          @close="(id) => tabs.closeTab(id)"
        />
        <!-- 宿主主体：flex:1 占满剩余高度（TabBar 高度固定在上方）。
             源码模式互斥显隐：WYSIWYG 态显示 TabHost，源码态显示 CodeMirror 层
             （v-show 保活两侧实例——保留 undo 与光标，AC-M-6/7/8） -->
        <div v-show="!sourceModeActive" class="app-shell__center-body">
          <TabHost />
        </div>
        <div v-show="sourceModeActive" class="app-shell__center-body">
          <SourceModeLayer />
        </div>
      </div>
    </div>
    <!-- 状态栏容器（11）：文档流占位（原 App.vue fixed 浮层随迁移改为常规布局） -->
    <StatusBar />
  </div>
</template>

<style scoped>
/* 应用外壳：纵向 flex——主区（侧栏+中央）弹性占满，状态栏文档流置底 */
.app-shell {
  display: flex;
  flex-direction: column;
  height: 100vh;
}

/* 主区：侧栏与中央区横向并排 */
.app-shell__main {
  display: flex;
  flex: 1;
  min-height: 0;
}

/* 侧栏容器：宽度由拖拽状态机内联驱动（180~480px 收敛），防中央区挤压 */
.app-shell__sidebar {
  flex-shrink: 0;
  min-width: 0;
  overflow: hidden;
}

/* 宽度拖拽手柄：贴侧栏右缘细条，hover 显形提示可拖 */
.app-shell__sidebar-resize {
  flex-shrink: 0;
  width: 5px;
  cursor: col-resize;
  background: transparent;
}

.app-shell__sidebar-resize:hover {
  background: var(--markwell-border, #ddd);
}

/* 中央区：纵向 flex——标签条固定高度，宿主主体弹性占满剩余空间 */
.app-shell__center {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.app-shell__center-body {
  flex: 1;
  min-height: 0;
}
</style>
