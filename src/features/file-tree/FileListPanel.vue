<!-- 文件列表面板（03 文件树，F2 列表视图）
     扁平文件列表：遍历 store.entries 过滤非目录（isDir=false），
     点击 emit open-file（选中 + 打开，与 FileTreePanel 行为一致）。 -->
<script setup lang="ts">
import { computed } from "vue";
import { useFileTreeStore } from "./file-tree-store";

const store = useFileTreeStore();

/** 事件：打开文件（上层处理文档打开） */
const emit = defineEmits<{
  "open-file": [path: string];
}>();

/** 扁平文件列表（仅文件，不含目录；entries 已由 Rust 侧过滤白名单/隐藏） */
const files = computed(() => store.entries.filter((entry) => !entry.isDir));

/** 点击文件：选中 + 打开 */
function onOpenFile(path: string): void {
  store.select(path);
  emit("open-file", path);
}
</script>

<template>
  <div class="file-list">
    <p v-if="files.length === 0" class="file-list__empty">文件夹为空或没有受支持的文本文件</p>
    <button
      v-for="entry in files"
      :key="entry.path"
      class="file-list__item"
      @click="onOpenFile(entry.path)"
    >
      {{ entry.name }}
    </button>
  </div>
</template>

<style scoped>
/* 文件列表面板样式（03 阶段朴素定位；08 主题模块按设计令牌精修） */
.file-list {
  display: flex;
  flex-direction: column;
}

.file-list__item {
  padding: 6px 14px;
  border: none;
  background: none;
  text-align: left;
  font-size: 13px;
  color: var(--markwell-text, #333);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: pointer;
}

.file-list__item:hover {
  background: var(--markwell-accent-weak, #e8f1ff);
}

.file-list__empty {
  padding: 16px;
  text-align: center;
  font-size: 13px;
  color: var(--markwell-text-dim, #888);
}
</style>
