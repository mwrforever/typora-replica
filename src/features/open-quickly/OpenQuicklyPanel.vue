<!--
  Open Quickly 面板（02 文档管理，F11）

  Ctrl+P 唤出：输入过滤候选、↑↓ 导航、Enter 打开、Escape 关闭、无匹配空态。
  数据由父组件经 props 注入（App.vue 组装 buildQuickItems 结果）。
-->
<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { searchQuickItems, type QuickItem } from "./fuzzy";

/** 候选条目（父组件注入） */
const props = defineProps<{ items: QuickItem[] }>();

/** 事件：选中打开 / 关闭面板 */
const emit = defineEmits<{
  select: [path: string];
  close: [];
}>();

/** 输入框引用（挂载自动聚焦） */
const inputRef = ref<HTMLInputElement | null>(null);
/** 用户输入 */
const query = ref("");
/** 当前高亮索引（↑↓ 导航） */
const activeIndex = ref(0);

/** 过滤后的匹配结果（无匹配时为空数组 → 空态） */
const results = computed(() => searchQuickItems(query.value, props.items));

// 列表变化后高亮收敛（避免过滤收缩后索引越界）：computed 内不允许副作用
//（eslint vue/no-side-effects-in-computed-properties），改由 watch 收敛
watch(results, (list) => {
  if (activeIndex.value >= list.length) activeIndex.value = list.length - 1;
});

/** 挂载后聚焦输入框（面板即键盘可用） */
// 注：onMounted 后 nextTick 聚焦，避免与面板入场动画冲突
onMounted(() => {
  void nextTick(() => inputRef.value?.focus());
});

/** Enter：打开当前高亮项（无结果时忽略） */
function onEnter(): void {
  const target = results.value[activeIndex.value];
  if (target) emit("select", target.path);
}

/** ↑↓：移动高亮（首项回绕到末项，末项回绕到首项） */
function onArrow(direction: "up" | "down"): void {
  if (results.value.length === 0) return;
  const delta = direction === "down" ? 1 : -1;
  activeIndex.value = (activeIndex.value + delta + results.value.length) % results.value.length;
}

/** 键盘处理：Enter 打开 / Escape 关闭 / ↑↓ 导航 */
function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Enter") onEnter();
  else if (event.key === "Escape") emit("close");
  else if (event.key === "ArrowDown") onArrow("down");
  else if (event.key === "ArrowUp") onArrow("up");
}

/** 输入变化时高亮复位到首项 */
function onInput(): void {
  activeIndex.value = 0;
}
</script>

<template>
  <div class="quick-open" role="dialog" aria-label="Open Quickly">
    <input
      ref="inputRef"
      v-model="query"
      class="quick-open__input"
      placeholder="搜索文件名…（Enter 打开，Esc 关闭）"
      @input="onInput"
      @keydown="onKeydown"
    />
    <ul class="quick-open__list">
      <li
        v-for="(item, index) in results"
        :key="item.path"
        :class="['quick-open__item', { 'quick-open__item--active': index === activeIndex }]"
        @click="emit('select', item.path)"
        @mouseenter="activeIndex = index"
      >
        {{ item.label }}
      </li>
    </ul>
    <p v-if="results.length === 0" class="quick-open__empty">无匹配结果</p>
  </div>
</template>

<style scoped>
/* 面板样式（02 阶段朴素定位；08 主题模块按设计令牌精修） */
.quick-open {
  position: fixed;
  top: 72px;
  left: 50%;
  transform: translateX(-50%);
  width: 420px;
  max-height: 320px;
  display: flex;
  flex-direction: column;
  background: var(--markwell-surface, #fff);
  border: 1px solid var(--markwell-border, #ddd);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
  z-index: 1000;
  overflow: hidden;
}

.quick-open__input {
  width: 100%;
  padding: 10px 14px;
  border: none;
  border-bottom: 1px solid var(--markwell-border, #ddd);
  outline: none;
  font-size: 14px;
}

.quick-open__list {
  list-style: none;
  margin: 0;
  padding: 4px 0;
  overflow-y: auto;
}

.quick-open__item {
  padding: 8px 14px;
  font-size: 13px;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.quick-open__item--active {
  background: var(--markwell-accent-weak, #e8f1ff);
}

.quick-open__empty {
  padding: 16px;
  text-align: center;
  color: var(--markwell-text-dim, #888);
  font-size: 13px;
}
</style>
