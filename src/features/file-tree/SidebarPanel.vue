<!-- 侧栏容器（03 文件树，F2 三面板切换）
     面板：文件树/文件列表/大纲（占位，05 填充）；
     底部工具条：+ 新建文件（emit create-file）、⋯ 菜单（刷新/打开文件夹/最近位置/搜索/排序）。 -->
<script setup lang="ts">
import { ref } from "vue";
import FileListPanel from "./FileListPanel.vue";
import FileTreePanel from "./FileTreePanel.vue";
import OutlinePanel from "./OutlinePanel.vue";
import RecentLocationsPanel from "./RecentLocationsPanel.vue";
import { useFileTreeStore, type PanelKey } from "./file-tree-store";
import { createSearchEntry } from "./search-entry";

const store = useFileTreeStore();

/** 面板切换按钮组（F2：三面板） */
const panels: Array<{ key: PanelKey; label: string }> = [
  { key: "outline", label: "大纲" },
  { key: "list", label: "列表" },
  { key: "tree", label: "文件" },
];

/** 底部 ⋯ 菜单开关 */
const moreOpen = ref(false);

/** 搜索框输入值（03 阶段仅占位收集，搜索逻辑归 06 模块消费） */
const searchQuery = ref("");
/** 搜索入口处理器（P3-7：AC-F12-1 侧栏搜索框 UI 落地，事件透传给 06） */
const searchEntry = createSearchEntry();

/** 输入变化：透传查询事件（06 消费） */
function onSearchInput(event: Event): void {
  searchQuery.value = (event.target as HTMLInputElement).value;
  searchEntry.handleInput(searchQuery.value);
}

/** 提交（Enter）：透传当前查询（06 消费） */
function onSearchSubmit(): void {
  searchEntry.handleSubmit(searchQuery.value);
}

const emit = defineEmits<{
  "open-file": [path: string];
  "open-folder": [path: string];
  "create-file": [];
  "request-menu": [payload: { path: string; x: number; y: number }];
}>();

/** ⋯ 菜单动作（Refresh 走 store；其余 emit 上层处理） */
function onRefresh(): void {
  moreOpen.value = false;
  void store.refresh();
}

function onSearch(): void {
  moreOpen.value = false;
  store.showSearch();
}

/** ⋯ 菜单「最近位置」：切入 recent 面板（F9 入口，右键菜单同款 action） */
function onRecent(): void {
  moreOpen.value = false;
  store.switchPanel("recent");
}

function onSort(by: "alpha" | "natural" | "mtime" | "ctime"): void {
  moreOpen.value = false;
  store.setSort(by);
}
</script>

<template>
  <aside class="sidebar-panel" v-if="store.sidebarVisible">
    <div v-if="store.searchVisible" class="sidebar-panel__search">
      <input
        v-model="searchQuery"
        class="sidebar-panel__search-input"
        placeholder="搜索当前目录…"
        data-search-input
        @input="onSearchInput"
        @keydown.enter="onSearchSubmit"
      />
      <button
        class="sidebar-panel__search-close"
        title="关闭搜索框"
        data-search-close
        @click="store.hideSearch()"
      >
        ×
      </button>
    </div>
    <div class="sidebar-panel__tabs">
      <button
        v-for="p in panels"
        :key="p.key"
        class="sidebar-panel__tab"
        :class="{ 'sidebar-panel__tab--active': store.activePanel === p.key }"
        @click="store.switchPanel(p.key)"
      >
        {{ p.label }}
      </button>
    </div>
    <div class="sidebar-panel__body">
      <FileTreePanel
        v-if="store.activePanel === 'tree'"
        class="sidebar-panel__file-tree"
        @open-file="emit('open-file', $event)"
        @open-folder="emit('open-folder', $event)"
        @request-menu="emit('request-menu', $event)"
      />
      <FileListPanel
        v-else-if="store.activePanel === 'list'"
        class="sidebar-panel__file-list"
        @open-file="emit('open-file', $event)"
      />
      <RecentLocationsPanel
        v-else-if="store.activePanel === 'recent'"
        class="sidebar-panel__recent"
        @open-folder="emit('open-folder', $event)"
      />
      <OutlinePanel v-else class="sidebar-panel__outline" />
    </div>
    <div class="sidebar-panel__footer">
      <button class="sidebar-panel__btn" title="新建文件" @click="emit('create-file')">＋</button>
      <button class="sidebar-panel__btn" title="更多操作" @click="moreOpen = !moreOpen">⋯</button>
      <div v-if="moreOpen" class="sidebar-panel__more">
        <button @click="onRefresh">手动刷新</button>
        <button @click="emit('open-folder', '')">打开文件夹…</button>
        <button @click="onRecent">最近位置</button>
        <button @click="onSearch">全局搜索</button>
        <button @click="onSort('alpha')">按字母排序</button>
        <button @click="onSort('mtime')">按修改时间排序</button>
        <button @click="onSort('natural')">按自然序排序</button>
        <button @click="store.setGroupFolder(!store.groupFolderFirst)">Group by Folder</button>
      </div>
    </div>
  </aside>
</template>

<style scoped>
/* 侧栏容器样式（03 阶段朴素定位；08 主题模块按设计令牌精修） */
.sidebar-panel {
  display: flex;
  flex-direction: column;
  width: 260px;
  min-width: 200px;
  height: 100%;
  background: var(--markwell-surface, #fff);
  border-right: 1px solid var(--markwell-border, #ddd);
  overflow: hidden;
}

.sidebar-panel__tabs {
  display: flex;
  flex-shrink: 0;
  border-bottom: 1px solid var(--markwell-border, #ddd);
}

/* 全局搜索框（F12：侧栏顶部显示；03 阶段占位收集，06 接入搜索逻辑） */
.sidebar-panel__search {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--markwell-border, #ddd);
}

.sidebar-panel__search-input {
  flex: 1;
  min-width: 0;
  box-sizing: border-box;
  padding: 4px 8px;
  font-size: 13px;
  border: 1px solid var(--markwell-border, #ddd);
  border-radius: 4px;
  background: var(--markwell-surface, #fff);
  color: var(--markwell-text, #333);
}

.sidebar-panel__search-close {
  width: 22px;
  height: 22px;
  border: none;
  background: none;
  font-size: 14px;
  line-height: 1;
  color: var(--markwell-text-dim, #888);
  cursor: pointer;
}

.sidebar-panel__tab {
  flex: 1;
  padding: 8px 0;
  border: none;
  background: none;
  font-size: 13px;
  color: var(--markwell-text-dim, #888);
  cursor: pointer;
}

.sidebar-panel__tab--active {
  color: var(--markwell-accent, #3b82f6);
  border-bottom: 2px solid var(--markwell-accent, #3b82f6);
  font-weight: 600;
}

.sidebar-panel__body {
  flex: 1;
  overflow-y: auto;
  padding: 6px 0;
}

.sidebar-panel__footer {
  position: relative;
  display: flex;
  flex-shrink: 0;
  padding: 4px 8px;
  border-top: 1px solid var(--markwell-border, #ddd);
}

.sidebar-panel__btn {
  width: 28px;
  height: 28px;
  border: none;
  background: none;
  font-size: 14px;
  line-height: 1;
  color: var(--markwell-text, #333);
  cursor: pointer;
}

.sidebar-panel__more {
  position: absolute;
  bottom: 36px;
  left: 8px;
  z-index: 10;
  display: flex;
  flex-direction: column;
  min-width: 160px;
  background: var(--markwell-surface, #fff);
  border: 1px solid var(--markwell-border, #ddd);
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  padding: 4px 0;
}

.sidebar-panel__more button {
  padding: 6px 12px;
  border: none;
  background: none;
  text-align: left;
  font-size: 13px;
  color: var(--markwell-text, #333);
  cursor: pointer;
}

.sidebar-panel__more button:hover {
  background: var(--markwell-accent-weak, #e8f1ff);
}
</style>
