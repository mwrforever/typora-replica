<!-- 递归树节点（03 文件树）：展开/选中/拖拽（F7 数据源）/右键
     数据来自 fileTreeStore（展开/选中状态统一管理，键 = relPath/完整路径）；
     自引用渲染子节点（SFC 按文件名隐式自引用），事件逐层透传父级。 -->
<script setup lang="ts">
import { computed } from "vue";
import type { TreeNode } from "./tree-utils";
import { useFileTreeStore } from "./file-tree-store";

const props = defineProps<{
  /** 当前节点 */
  node: TreeNode;
  /** 递归深度（样式缩进） */
  depth: number;
}>();

const emit = defineEmits<{
  "toggle-dir": [relPath: string];
  "open-file": [path: string];
  "request-menu": [payload: { path: string; x: number; y: number }];
}>();

const store = useFileTreeStore();

/** 展开态（store 统一管理，键 = TreeNode.relPath） */
const expanded = computed(() => store.expandedPaths.has(props.node.relPath));

/** 选中态（打开文件后高亮，键 = 完整路径） */
const selected = computed(() => store.selectedPath === props.node.path);

/** 拖拽载荷：完整路径 + 相对链接文本（F7 拖入插链接数据源） */
function onDragStart(event: DragEvent): void {
  event.dataTransfer?.setData("text/plain", props.node.path);
  event.dataTransfer?.setData("application/x-markwell-path", props.node.path);
}
</script>

<template>
  <div>
    <div
      class="file-tree-item"
      :class="{
        'file-tree-item--dir': node.isDir,
        'file-tree-item--file': !node.isDir,
        'file-tree-item--expanded': expanded,
        'file-tree-item--selected': selected,
      }"
      :style="{ paddingLeft: `${8 + depth * 14}px` }"
      draggable="true"
      @click="node.isDir ? emit('toggle-dir', node.relPath) : emit('open-file', node.path)"
      @contextmenu.prevent.stop="
        emit('request-menu', { path: node.path, x: $event.clientX, y: $event.clientY })
      "
      @dragstart="onDragStart"
    >
      <span v-if="node.isDir" class="file-tree-item__arrow">{{ expanded ? "▾" : "▸" }}</span>
      <span class="file-tree-item__name">{{ node.name }}</span>
    </div>
    <div v-if="node.isDir && expanded" class="file-tree-item__children">
      <FileTreeItem
        v-for="child in node.children"
        :key="child.relPath"
        :node="child"
        :depth="depth + 1"
        @toggle-dir="emit('toggle-dir', $event)"
        @open-file="emit('open-file', $event)"
        @request-menu="emit('request-menu', $event)"
      />
    </div>
  </div>
</template>
