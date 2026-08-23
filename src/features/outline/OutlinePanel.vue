<!-- 大纲面板（05）：过滤输入框 + 层级缩进列表 + 点击跳转 + 当前标题高亮 + 双空态 -->
<script setup lang="ts">
import { computed, onUnmounted } from "vue";
import { revealRange } from "../editor/reveal-range";
import { editorManager } from "../editor/editor-manager";
import type { HeadingInfo } from "../editor/heading-collect";
import { useOutlineData } from "./outline-data";
import { useOutlineStore } from "./outline-store";

const store = useOutlineStore();

// 可写计算代理（AC-F21）：输入框 v-model 双向绑定过滤词——读直取 state、
// 写经 setFilter action 收口，保证过滤状态变更与其他 action 同一入口
const filterQuery = computed({
  get: () => store.filterQuery,
  set: (v: string) => store.setFilter(v),
});

// 数据装配订阅与组件生命周期严格成对：setup 内注册（useOutlineData），
// unmount 统一解除（dispose）
const { dispose } = useOutlineData();
onUnmounted(dispose);

/**
 * 点击条目：定位标题文本区间并临时高亮
 *
 * 复用 01 模块锁定接口 revealRange（选中 → 滚动可视 → 临时高亮），区间取标题
 * 文本 [pos+1, pos+1+text.length)——避开节点边界使选区落在可见文本上；
 * 越界由 revealRange 内部收敛（AC-F18-2）。编辑器未就绪时静默跳过。
 * @param item 被点击的标题条目（store.visibleHeadings 成员）
 */
function jumpTo(item: HeadingInfo): void {
  const editor = editorManager.getEditor();
  if (!editor) return;
  revealRange(editor, item.pos + 1, item.pos + 1 + item.text.length);
}
</script>

<template>
  <div class="outline-panel">
    <!-- 过滤输入框常驻面板顶部：输入即滤（store.filteredHeadings 大小写不敏感子串匹配） -->
    <input
      v-model="filterQuery"
      class="outline-panel__filter"
      placeholder="过滤标题…"
      data-outline-filter
    />
    <ul v-if="store.visibleHeadings.length > 0" class="outline-panel__list" data-outline-list>
      <li
        v-for="h in store.visibleHeadings"
        :key="`${h.pos}`"
        class="outline-panel__item"
        :class="{ 'outline-panel__item--active': h.id === store.activeHeadingId }"
        :style="{ paddingLeft: `${(h.level - 1) * 16}px` }"
        data-outline-item
        @click="jumpTo(h)"
      >
        {{ h.text }}
      </li>
    </ul>
    <!-- 双空态区分：无标题文档 vs 有标题但过滤零命中（AC-F21-2） -->
    <p v-else-if="store.headings.length === 0" class="outline-panel__empty">（无标题）</p>
    <p v-else class="outline-panel__empty">无匹配标题</p>
  </div>
</template>

<style scoped>
/* 大纲面板样式：沿项目 --markwell-* 设计令牌；08 主题模块按令牌精修 */
.outline-panel {
  height: 100%;
  overflow-y: auto;
  padding: 4px 0;
}

/* 过滤输入框：常驻顶部，token 与侧栏搜索框（sidebar-panel__search-input）同源 */
.outline-panel__filter {
  box-sizing: border-box;
  width: calc(100% - 16px);
  margin: 4px 8px;
  padding: 4px 8px;
  font-size: 13px;
  border: 1px solid var(--markwell-border, #ddd);
  border-radius: 4px;
  background: var(--markwell-surface, #fff);
  color: var(--markwell-text, #333);
}

.outline-panel__list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.outline-panel__item {
  /* 左缩进由模板内联样式按 (level-1)*16px 注入，此处只管其余方向 */
  padding: 4px 8px;
  font-size: 13px;
  line-height: 1.6;
  color: var(--markwell-text, #333);
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.outline-panel__item:hover {
  background: var(--markwell-accent-weak, #e8f1ff);
}

.outline-panel__item--active {
  color: var(--markwell-accent, #3b82f6);
  font-weight: 600;
  background: var(--markwell-accent-weak, #e8f1ff);
}

.outline-panel__empty {
  padding: 8px;
  font-size: 13px;
  color: var(--markwell-text-dim, #888);
}
</style>
