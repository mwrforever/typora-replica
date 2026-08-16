<!-- 文件树面板（03 文件树，F3 渲染）
     数据全部来自 fileTreeStore（Rust 已完成白名单/隐藏/排序）；
     目录默认折叠，点击展开（AC-F3 渲染层）。 -->
<script setup lang="ts">
import FileTreeItem from "./FileTreeItem.vue";
import { useFileTreeStore } from "./file-tree-store";

const store = useFileTreeStore();

/** 事件：打开文件 / 打开文件夹 / 请求右键菜单（SidebarPanel 统一渲染菜单） */
const emit = defineEmits<{
  "open-file": [path: string];
  "open-folder": [path: string];
  "request-menu": [payload: { path: string; x: number; y: number }];
}>();

/** 点击目录：展开/折叠（展开状态在 store，键 = relPath） */
function onToggleDir(relPath: string): void {
  store.toggleExpand(relPath);
}

/** 点击文件：选中 + 打开 */
function onOpenFile(path: string): void {
  store.select(path);
  emit("open-file", path);
}

/** 右键空白区域：记录坐标请求根目录菜单（子节点右键已自带 path，见 onItemRequestMenu） */
function onContextMenu(event: MouseEvent, path?: string): void {
  event.preventDefault();
  emit("request-menu", { path: path ?? "", x: event.clientX, y: event.clientY });
}

/** 子节点右键请求：payload 已含 path 与坐标，原样透传（F3 契约） */
function onItemRequestMenu(payload: { path: string; x: number; y: number }): void {
  emit("request-menu", payload);
}
</script>

<template>
  <div class="file-tree" @contextmenu="onContextMenu($event)">
    <p v-if="store.tree.length === 0" class="file-tree__empty">文件夹为空或没有受支持的文本文件</p>
    <FileTreeItem
      v-for="node in store.tree"
      :key="node.path"
      :node="node"
      :depth="0"
      @toggle-dir="onToggleDir"
      @open-file="onOpenFile"
      @request-menu="onItemRequestMenu"
    />
  </div>
</template>
