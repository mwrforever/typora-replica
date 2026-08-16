<!-- 文件树右键菜单（03 文件树，F4 十二项）
     打开/新建文件/新建文件夹/重命名/Duplicate/删除（回收站）/复制路径/
     在资源管理器中显示/搜索/最近位置 + 新窗口打开与撤销文件操作（延后 disabled）。
     新建与重命名走内联输入：Enter 确认、Esc 取消、非法字符提示（AC-F4-1/5）。
     定位：fixed 坐标（右键事件 clientX/Y 透传），visible 由父组件（SidebarPanel）控制。 -->
<script setup lang="ts">
import { nextTick, ref } from "vue";
import {
  createDir,
  createFile,
  deleteToTrash,
  duplicatePath,
  renamePath,
} from "../../services/file-io";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { duplicateTargetName, isInvalidFileName } from "./tree-utils";
import { useFileTreeStore } from "./file-tree-store";

const props = defineProps<{
  /** 菜单可见性（父组件定位渲染） */
  visible: boolean;
  /** 菜单位置 X（fixed 坐标） */
  x: number;
  /** 菜单位置 Y（fixed 坐标） */
  y: number;
  /** 右键目标：文件/目录完整路径；空串 = 空白处（根目录上下文） */
  targetPath: string;
}>();

const emit = defineEmits<{
  close: [];
  refresh: [];
  open: [path: string];
}>();

const store = useFileTreeStore();

/** 当前激活的内联输入模式：new-file / new-dir / rename / none */
const inlineMode = ref<"new-file" | "new-dir" | "rename" | "none">("none");
/** 内联输入值 */
const inlineValue = ref("");
/** 内联输入错误提示 */
const inlineError = ref("");
/** 内联输入引用（挂载聚焦） */
const inlineInput = ref<HTMLInputElement | null>(null);

/** 路径最后分隔符下标（/ 或 \\，兼容 Windows；无分隔符返回 -1） */
function lastSepIndex(path: string): number {
  return Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
}

/** 目标路径的父目录（含尾分隔符；无分隔符返回空串） */
function parentDirOf(path: string): string {
  const sep = lastSepIndex(path);
  return sep === -1 ? "" : path.slice(0, sep + 1);
}

/**
 * 新建目标目录（new-file/new-dir 内联输入用）
 * 规则：右键目标是既有文件 → 取其父目录；是目录/未知路径 → 目录自身；
 * 空串（空白处根菜单）→ store.currentDir 兜底。
 */
function resolveNewDir(): string {
  const base = props.targetPath || store.currentDir || "";
  if (!base) return "";
  // 仅已知文件需要父目录；未知路径按目录处理（新建目标 = 目标目录自身）
  const entry = store.entries.find((e) => e.path === props.targetPath);
  if (entry && !entry.isDir) return parentDirOf(base);
  return base.replace(/[/\\]+$/, "") + "/";
}

/** 菜单项动作（10 个可执行动作；新窗口/撤销为延后 disabled 项） */
function action(kind: string): void {
  switch (kind) {
    case "open": {
      // 打开动作透传：文件 → App.vue 调 session.openFile；目录 → 展开/进入
      emit("open", props.targetPath);
      emit("close");
      break;
    }
    case "new-file": {
      inlineMode.value = "new-file";
      inlineValue.value = "";
      inlineError.value = "";
      void nextTick(() => inlineInput.value?.focus());
      break;
    }
    case "new-dir": {
      inlineMode.value = "new-dir";
      inlineValue.value = "";
      inlineError.value = "";
      void nextTick(() => inlineInput.value?.focus());
      break;
    }
    case "rename": {
      inlineMode.value = "rename";
      // 预填当前名称（末级路径段），用户直接改新名
      inlineValue.value = props.targetPath.split(/[/\\]/).pop() ?? "";
      inlineError.value = "";
      void nextTick(() => inlineInput.value?.focus());
      break;
    }
    case "duplicate": {
      emit("close");
      void runDuplicate();
      break;
    }
    case "delete": {
      emit("close");
      void runDelete();
      break;
    }
    case "copy-path": {
      void navigator.clipboard.writeText(props.targetPath);
      emit("close");
      break;
    }
    case "reveal": {
      void revealItemInDir(props.targetPath);
      emit("close");
      break;
    }
    case "search": {
      store.showSearch();
      emit("close");
      break;
    }
    case "recent": {
      store.switchPanel("recent");
      emit("close");
      break;
    }
  }
}

/** Duplicate：目标名 = {原名} copy.{ext}，冲突 -1（AC-F4-2/6） */
async function runDuplicate(): Promise<void> {
  const dir = parentDirOf(props.targetPath);
  const name = props.targetPath.slice(dir.length);
  const target = duplicateTargetName(name, collectSiblingNames());
  try {
    await duplicatePath(props.targetPath, `${dir}${target}`);
  } catch {
    /* 错误提示由父组件统一 onNotice（Rust 中文消息透传） */
  }
  emit("refresh");
}

/** 同目录既有名称（Duplicate 冲突判断；基于 entries 完整路径） */
function collectSiblingNames(): string[] {
  const dir = parentDirOf(props.targetPath).replace(/[/\\]$/, "");
  return store.entries
    .filter((e) => {
      const es = lastSepIndex(e.path);
      return es === -1 ? dir === "" : e.path.slice(0, es) === dir;
    })
    .map((e) => e.name);
}

/** 删除到回收站（AC-F4-3；trash crate 保证非永久删除） */
async function runDelete(): Promise<void> {
  try {
    await deleteToTrash(props.targetPath);
  } catch {
    /* 错误提示父组件统一处理 */
  }
  emit("refresh");
}

/** 内联输入确认：新建/重命名提交（Enter） */
async function confirmInline(): Promise<void> {
  const value = inlineValue.value.trim();
  if (isInvalidFileName(value)) {
    inlineError.value = "文件名含非法字符或为空";
    return;
  }
  // 重命名恒取父目录；新建取目标目录（文件→父目录/目录→自身/空串→currentDir）
  const dir = inlineMode.value === "rename" ? parentDirOf(props.targetPath) : resolveNewDir();
  try {
    if (inlineMode.value === "new-file") await createFile(`${dir}${value}`);
    else if (inlineMode.value === "new-dir") await createDir(`${dir}${value}`);
    else if (inlineMode.value === "rename") await renamePath(props.targetPath, `${dir}${value}`);
  } catch {
    inlineError.value = "创建/重命名失败（目标可能已存在）";
    return;
  }
  inlineMode.value = "none";
  emit("refresh");
  emit("close");
}

/** 内联输入取消（Esc） */
function cancelInline(): void {
  inlineMode.value = "none";
}
</script>

<template>
  <div v-if="visible" class="file-tree-menu" :style="{ left: `${x}px`, top: `${y}px` }">
    <button class="file-tree-menu__item" data-menu="open" @click="action('open')">打开</button>
    <button class="file-tree-menu__item" data-menu="new-window" disabled title="12 窗口外壳实现">
      新窗口打开
    </button>
    <button class="file-tree-menu__item" data-menu="new-file" @click="action('new-file')">
      新建文件
    </button>
    <button class="file-tree-menu__item" data-menu="new-dir" @click="action('new-dir')">
      新建文件夹
    </button>
    <button
      class="file-tree-menu__item"
      data-menu="rename"
      :disabled="!targetPath"
      @click="action('rename')"
    >
      重命名
    </button>
    <button
      class="file-tree-menu__item"
      data-menu="duplicate"
      :disabled="!targetPath"
      @click="action('duplicate')"
    >
      Duplicate
    </button>
    <button
      class="file-tree-menu__item"
      data-menu="delete"
      :disabled="!targetPath"
      @click="action('delete')"
    >
      删除（回收站）
    </button>
    <button class="file-tree-menu__item" data-menu="undo" disabled title="08 延后">
      撤销文件操作
    </button>
    <button
      class="file-tree-menu__item"
      data-menu="copy-path"
      :disabled="!targetPath"
      @click="action('copy-path')"
    >
      复制路径
    </button>
    <button
      class="file-tree-menu__item"
      data-menu="reveal"
      :disabled="!targetPath"
      @click="action('reveal')"
    >
      在资源管理器中显示
    </button>
    <button class="file-tree-menu__item" data-menu="search" @click="action('search')">搜索</button>
    <button class="file-tree-menu__item" data-menu="recent" @click="action('recent')">
      最近位置
    </button>

    <div v-if="inlineMode !== 'none'" class="file-tree-menu__inline" @click.stop>
      <input
        ref="inlineInput"
        v-model="inlineValue"
        :placeholder="inlineMode === 'rename' ? '新名称' : '文件名'"
        @keydown.enter="confirmInline"
        @keydown.esc="cancelInline"
      />
      <p v-if="inlineError" class="file-tree-menu__error">{{ inlineError }}</p>
    </div>
  </div>
</template>

<style scoped>
/* 右键菜单样式（03 阶段朴素定位；08 主题模块按设计令牌精修） */
.file-tree-menu {
  position: fixed;
  z-index: 1000;
  min-width: 180px;
  padding: 4px;
  background: var(--markwell-bg, #fff);
  border: 1px solid var(--markwell-border, #ddd);
  border-radius: 6px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.18);
}

.file-tree-menu__item {
  display: block;
  width: 100%;
  padding: 6px 12px;
  border: none;
  background: none;
  text-align: left;
  font-size: 13px;
  color: var(--markwell-text, #333);
  cursor: pointer;
  white-space: nowrap;
}

.file-tree-menu__item:hover:not(:disabled) {
  background: var(--markwell-accent-weak, #e8f1ff);
}

.file-tree-menu__item:disabled {
  color: var(--markwell-text-dim, #999);
  cursor: default;
}

.file-tree-menu__inline {
  padding: 6px 12px;
}

.file-tree-menu__inline input {
  width: 100%;
  box-sizing: border-box;
  padding: 4px 6px;
  font-size: 13px;
  border: 1px solid var(--markwell-border, #ddd);
  border-radius: 4px;
}

.file-tree-menu__error {
  margin: 4px 0 0;
  font-size: 12px;
  color: #c62828;
}
</style>
