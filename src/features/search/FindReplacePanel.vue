<!-- 查找/替换面板（06）：编辑区右上角固定浮层，Find / Find+Replace 两态。
     本组件是 useFindController 的 App 级唯一挂载点——根元素 v-if 只控制浮层
     显隐，组件本体常驻，订阅随生命周期稳定存在（dispose 与 unmount 成对）。 -->
<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from "vue";
import { editorManager } from "../editor/editor-manager";
import {
  navigateNext,
  navigatePrev,
  replaceAllInView,
  replaceOneInView,
  useFindController,
} from "./find-controller";
import { useSearchStore } from "./search-store";

const store = useSearchStore();
const { dispose } = useFindController();
onUnmounted(dispose);

/** 查询框 DOM 引用（打开时自动聚焦，AC-F24-1） */
const inputEl = ref<HTMLInputElement | null>(null);

watch(
  () => store.visible,
  async (visible) => {
    if (!visible) return;
    await nextTick();
    inputEl.value?.focus();
  },
);

/** 计数文案：n/m；零匹配 0/0（AC-F24-6）；非法正则/空匹配态专属提示（AC-F25-5 呈现） */
const countText = computed(() => {
  if (!store.query) return "";
  if (store.queryStatus === "invalid-regex") return "无效正则";
  if (store.queryStatus === "matches-empty") return "无法搜索：正则可匹配空串";
  return store.matchCount === 0 ? "0/0" : `${store.activeIndex + 1}/${store.matchCount}`;
});

const queryModel = computed({
  get: () => store.query,
  set: (v: string) => store.setQuery(v),
});

const replaceModel = computed({
  get: () => store.replacement,
  set: (v: string) => store.setReplacement(v),
});

/** AC-F25-5 UI 面：非 ok 态或空查询时替换动作不可用 */
const canReplace = computed(() => store.query.length > 0 && store.queryStatus === "ok");

/** 替换当前项（光标不在匹配上时先选中下一处——官方两段式）；禁用态兜底拒绝（合成 click 不受 disabled 拦截） */
function onReplaceOne(): void {
  if (!canReplace.value) return;
  replaceOneInView();
}

/** 全部替换（单事务合并，一次 Ctrl+Z 全撤）；禁用态兜底拒绝同上 */
function onReplaceAll(): void {
  if (!canReplace.value) return;
  replaceAllInView();
}

/** 查询框键盘：Enter 下一个 / Shift+Enter 上一个（与窗口层 F3 同源命令） */
function onQueryKeydown(event: KeyboardEvent): void {
  if (event.key !== "Enter" || event.isComposing) return;
  event.preventDefault();
  if (event.shiftKey) navigatePrev();
  else navigateNext();
}

/** 关闭并焦点回编辑器（ESC 由窗口层 onClose 走同一动作） */
function closePanel(): void {
  store.close();
  editorManager.getView()?.focus();
}
</script>

<template>
  <div v-if="store.visible" class="find-panel" data-find-panel>
    <div class="find-panel__row">
      <input
        ref="inputEl"
        v-model="queryModel"
        class="find-panel__input"
        :class="{
          'find-panel__input--invalid':
            store.queryStatus !== 'ok' && store.queryStatus !== 'idle' && store.query,
        }"
        placeholder="查找"
        data-find-input
        @keydown="onQueryKeydown"
      />
      <span v-if="countText" class="find-panel__count" data-find-count>{{ countText }}</span>
      <button
        class="find-panel__btn"
        title="上一个 (Shift+F3)"
        data-find-prev
        @click="navigatePrev()"
      >
        ↑
      </button>
      <button class="find-panel__btn" title="下一个 (F3)" data-find-next @click="navigateNext()">
        ↓
      </button>
      <button class="find-panel__btn" title="关闭 (Esc)" data-find-close @click="closePanel">
        ×
      </button>
    </div>
    <div v-if="store.mode === 'replace'" class="find-panel__row">
      <input
        v-model="replaceModel"
        class="find-panel__input"
        placeholder="替换为（支持 $1/$2 捕获组）"
        data-replace-input
        @keydown="onQueryKeydown"
      />
      <button
        class="find-panel__action"
        :disabled="!canReplace"
        title="替换当前项"
        data-replace-one
        @click="onReplaceOne"
      >
        替换
      </button>
      <button
        class="find-panel__action"
        :disabled="!canReplace"
        title="全部替换（一次 Ctrl+Z 可全部撤销）"
        data-replace-all
        @click="onReplaceAll"
      >
        全部
      </button>
    </div>
    <div class="find-panel__row find-panel__toggles">
      <button
        class="find-panel__toggle"
        :class="{ 'find-panel__toggle--active': store.caseSensitive }"
        title="区分大小写"
        data-toggle-case
        @click="store.toggleOption('caseSensitive')"
      >
        Aa
      </button>
      <button
        class="find-panel__toggle"
        :class="{ 'find-panel__toggle--active': store.wholeWord }"
        title="全词匹配"
        data-toggle-word
        @click="store.toggleOption('wholeWord')"
      >
        全词
      </button>
      <button
        class="find-panel__toggle"
        :class="{ 'find-panel__toggle--active': store.regexp }"
        title="正则表达式"
        data-toggle-regexp
        @click="store.toggleOption('regexp')"
      >
        .*
      </button>
    </div>
  </div>
</template>

<style scoped>
/* 浮层定位：TabBar 下方右上角（12 外壳阶段按布局令牌校正） */
.find-panel {
  position: fixed;
  top: 48px;
  right: 16px;
  z-index: 60;
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 340px;
  padding: 8px;
  background: var(--markwell-surface, #fff);
  border: 1px solid var(--markwell-border, #ddd);
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}
.find-panel__row {
  display: flex;
  align-items: center;
  gap: 4px;
}
.find-panel__input {
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
.find-panel__input--invalid {
  border-color: #d33;
}
.find-panel__count {
  flex-shrink: 0;
  font-size: 12px;
  color: var(--markwell-text-dim, #888);
  white-space: nowrap;
}
.find-panel__btn {
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  border: none;
  background: none;
  font-size: 13px;
  line-height: 1;
  color: var(--markwell-text, #333);
  cursor: pointer;
}
.find-panel__action {
  flex-shrink: 0;
  padding: 3px 10px;
  border: 1px solid var(--markwell-border, #ddd);
  border-radius: 4px;
  background: var(--markwell-surface, #fff);
  font-size: 12px;
  color: var(--markwell-text, #333);
  cursor: pointer;
}
.find-panel__action:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.find-panel__toggle {
  padding: 2px 8px;
  border: 1px solid transparent;
  border-radius: 4px;
  background: none;
  font-size: 12px;
  color: var(--markwell-text-dim, #888);
  cursor: pointer;
}
.find-panel__toggle--active {
  color: var(--markwell-accent, #3b82f6);
  border-color: var(--markwell-accent, #3b82f6);
  background: var(--markwell-accent-weak, #e8f1ff);
}
</style>
