<!-- App.vue
     应用根组件（02 阶段：启动装配 + 文档会话接线；12 窗口外壳模块将替换为完整窗口装配） -->
<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { getCurrentWindow } from "@tauri-apps/api/window";
import EditorPage from "./components/editor/EditorPage.vue";
import { AutoSaveController } from "./services/auto-save";
import { DraftRecovery } from "./services/draft-recovery";
import { DocumentSession } from "./services/document-session";
import { editorManager } from "./services/editor-manager";
import { getCliArgs, readFile } from "./services/file-io";
import { resolveLaunch } from "./services/launch-behavior";
import { loadSettings } from "./services/settings";
import { registerAppShortcuts } from "./services/app-shortcuts";
import { saveAsDialog } from "./services/open-commands";

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
    // Ctrl+P 面板（Task 17 接线；当前为占位入口，Task 17 替换为面板打开）
    console.info("[MarkWell] Open Quickly 面板（Task 17 接入）");
  },
});

onMounted(async () => {
  // 启动链路：cli 参数 + 偏好 → 决策 → 加载文档（失败回退新建，提示不崩溃）
  const [cli, settings] = await Promise.all([getCliArgs(), loadSettings()]);
  const exists = async (p: string) => {
    try {
      await readFile(p);
      return true;
    } catch {
      return false;
    }
  };
  const decision = await resolveLaunch(cli, settings, exists);
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
      // F14-2：恢复上次文件与文件夹——文件夹先加载为侧栏目录
      if (settings.launch.lastFolder) await session.openFolder(settings.launch.lastFolder);
      await session.openFile(decision.path);
      break;
  }
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
</template>
