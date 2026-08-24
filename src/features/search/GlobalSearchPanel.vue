<!-- 全局搜索面板（06）：侧栏「搜索」tab body。
     查询框（防抖发起走 store.requestGlobalSearch）+ 三开关 + 文件分组结果列表
     （多匹配默认折叠，用户实测形态）+ 截断提示。点击结果行走 global-reveal 链路。 -->
<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import { useFileTreeStore } from "../file-tree/file-tree-store";
import { revealGlobalMatch } from "./global-reveal";
import { useSearchStore } from "./search-store";

const store = useSearchStore();
const fileTree = useFileTreeStore();

/** 查询输入 DOM 引用（切入搜索 tab 时自动聚焦） */
const inputEl = ref<HTMLInputElement | null>(null);

watch(
  () => fileTree.activePanel,
  async (panel) => {
    if (panel !== "search") return;
    await nextTick();
    inputEl.value?.focus();
  },
);

/** 输入即防抖请求（300ms 合并，Enter 走 flush 直发） */
function onInput(event: Event): void {
  store.requestGlobalSearch((event.target as HTMLInputElement).value);
}

/** Enter 提交：清防抖定时器立即发起 */
function onSubmit(): void {
  store.flushGlobalSearch();
}

/** 三开关点击：翻转后立即重跑在途查询（结果不滞留旧口径，对照当前文件面板开关即时生效）；
 * 空查询或未开文件夹时不发起，避免无谓扫描 */
function onToggleOption(name: "globalCaseSensitive" | "globalWholeWord" | "globalRegexp"): void {
  store.toggleOption(name);
  if (store.globalQuery && fileTree.currentDir) store.flushGlobalSearch();
}

/** 分组展开态：单匹配文件恒展开；多匹配默认折叠，expandedFiles 记录手动切换 */
function isOpen(filePath: string): boolean {
  const group = store.globalResults.find((r) => r.filePath === filePath);
  if (!group) return true;
  return group.matches.length <= 1 || store.expandedFiles.has(filePath);
}

/** 点击结果条目：打开/激活标签并按命中序号定位高亮 */
async function onOpen(filePath: string, fileName: string, matchIndex: number): Promise<void> {
  await revealGlobalMatch(filePath, fileName, matchIndex);
}
</script>

<template>
  <div class="global-search" data-global-search-panel>
    <input
      ref="inputEl"
      :value="store.globalQuery"
      class="global-search__input"
      placeholder="搜索当前文件夹…"
      data-global-input
      @input="onInput"
      @keydown.enter="onSubmit"
    />
    <div class="global-search__toggles">
      <button
        class="global-search__toggle"
        :class="{ 'global-search__toggle--active': store.globalCaseSensitive }"
        title="区分大小写"
        data-global-case
        @click="onToggleOption('globalCaseSensitive')"
      >
        Aa
      </button>
      <button
        class="global-search__toggle"
        :class="{ 'global-search__toggle--active': store.globalWholeWord }"
        title="全词匹配"
        data-global-word
        @click="onToggleOption('globalWholeWord')"
      >
        全词
      </button>
      <button
        class="global-search__toggle"
        :class="{ 'global-search__toggle--active': store.globalRegexp }"
        title="正则表达式"
        data-global-regexp
        @click="onToggleOption('globalRegexp')"
      >
        .*
      </button>
    </div>
    <p v-if="!fileTree.currentDir" class="global-search__empty">打开文件夹后可搜索</p>
    <p v-else-if="store.globalError" class="global-search__error">{{ store.globalError }}</p>
    <p
      v-else-if="store.globalSearching && store.globalResults.length === 0"
      class="global-search__empty"
    >
      搜索中…
    </p>
    <p v-else-if="store.globalResults.length === 0" class="global-search__empty">无匹配结果</p>
    <ul v-else class="global-search__list" data-global-results>
      <li v-for="group in store.globalResults" :key="group.filePath" class="global-search__group">
        <button
          class="global-search__file-head"
          :data-global-file="group.fileName"
          @click="group.matches.length > 1 && store.toggleExpandFile(group.filePath)"
        >
          <span class="global-search__name">{{ group.fileName }}</span>
          <span v-if="group.encoding" class="global-search__enc">{{ group.encoding }}</span>
          <span class="global-search__count">({{ group.matches.length }})</span>
        </button>
        <ul v-if="isOpen(group.filePath)" class="global-search__matches">
          <li v-for="m in group.matches" :key="`${group.filePath}:${m.lineNumber}`">
            <button
              class="global-search__item"
              :data-global-item="m.lineNumber"
              @click="onOpen(group.filePath, group.fileName, m.firstMatchIndex)"
            >
              <span class="global-search__line">L{{ m.lineNumber }}</span>
              <span class="global-search__text">{{ m.lineText }}</span>
            </button>
          </li>
        </ul>
      </li>
    </ul>
    <p v-if="store.globalTruncated" class="global-search__truncated" data-global-truncated>
      已达结果上限，仅显示前 {{ store.globalMatchTotal }} 行
    </p>
  </div>
</template>

<style scoped>
/* 朴素可用形态（08 主题精修）；变量沿侧栏既有 token 回退写法 */
.global-search {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 6px;
}
.global-search__input {
  box-sizing: border-box;
  width: 100%;
  padding: 4px 8px;
  font-size: 13px;
  border: 1px solid var(--markwell-border, #ddd);
  border-radius: 4px;
  background: var(--markwell-surface, #fff);
  color: var(--markwell-text, #333);
}
.global-search__toggles {
  display: flex;
  gap: 4px;
}
.global-search__toggle {
  padding: 2px 8px;
  border: 1px solid transparent;
  border-radius: 4px;
  background: none;
  font-size: 12px;
  color: var(--markwell-text-dim, #888);
  cursor: pointer;
}
.global-search__toggle--active {
  color: var(--markwell-accent, #3b82f6);
  border-color: var(--markwell-accent, #3b82f6);
  background: var(--markwell-accent-weak, #e8f1ff);
}
.global-search__empty,
.global-search__error,
.global-search__truncated {
  margin: 0;
  font-size: 12px;
  color: var(--markwell-text-dim, #888);
}
.global-search__error {
  color: #d33;
}
.global-search__list,
.global-search__matches {
  margin: 0;
  padding: 0;
  list-style: none;
}
.global-search__file-head {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 3px 4px;
  border: none;
  background: none;
  font-size: 13px;
  font-weight: 600;
  text-align: left;
  color: var(--markwell-text, #333);
  cursor: pointer;
}
.global-search__enc {
  flex-shrink: 0;
  padding: 0 4px;
  border-radius: 3px;
  background: var(--markwell-accent-weak, #e8f1ff);
  font-size: 11px;
  color: var(--markwell-accent, #3b82f6);
}
.global-search__count {
  color: var(--markwell-text-dim, #888);
  font-weight: normal;
}
.global-search__item {
  display: flex;
  gap: 6px;
  width: 100%;
  padding: 2px 4px 2px 16px;
  border: none;
  background: none;
  font-size: 12px;
  text-align: left;
  color: var(--markwell-text, #333);
  cursor: pointer;
}
.global-search__line {
  flex-shrink: 0;
  color: var(--markwell-accent, #3b82f6);
}
.global-search__text {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
</style>
