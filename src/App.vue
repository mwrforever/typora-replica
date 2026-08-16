<!-- App.vue
     应用根组件（02 阶段：启动装配 + 文档会话接线；12 窗口外壳模块将替换为完整窗口装配） -->
<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { getCurrentWindow } from "@tauri-apps/api/window";
import EditorPage from "./components/editor/EditorPage.vue";
import { useFileTreeStore } from "./features/file-tree/file-tree-store";
import OpenQuicklyPanel from "./features/open-quickly/OpenQuicklyPanel.vue";
import { buildQuickItems } from "./features/open-quickly/open-quickly";
import type { QuickItem } from "./features/open-quickly/fuzzy";
import { AutoSaveController } from "./services/auto-save";
import { DraftRecovery } from "./services/draft-recovery";
import { DocumentSession } from "./services/document-session";
import { editorManager } from "./services/editor-manager";
import { getCliArgs, probePathExists } from "./services/file-io";
import { resolveLaunch } from "./services/launch-behavior";
import { loadSettings } from "./services/settings";
import { registerAppShortcuts } from "./services/app-shortcuts";
import { saveAsDialog } from "./services/open-commands";
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
  const fileTree = useFileTreeStore();
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
  autoSave.stop();
  drafts.stop();
  editorManager.destroy();
});
</script>

<template>
  <EditorPage :initial-doc="initialDoc" :key="docKey" />
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
