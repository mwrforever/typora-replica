<!-- 标签条（04 多标签）：渲染/点击激活/× 关闭/脏标记/溢出滚动
     展示层组件：不持有业务状态，所有行为经 activate/close 事件上抛，
     close 的脏确认分支由上层（controller C2 弹窗）决定 -->
<script setup lang="ts">
import type { TabMeta } from "./tabs-store";

defineProps<{
  tabs: TabMeta[];
  activeTabId?: string;
}>();

const emit = defineEmits<{
  /** 点击标签激活 */
  activate: [id: string];
  /** 点击 × 关闭（脏标签由上层转 C2 弹窗） */
  close: [id: string];
}>();
</script>

<template>
  <div class="tab-bar" role="tablist">
    <div
      v-for="tab in tabs"
      :key="tab.id"
      class="tab-bar__tab"
      :class="{ 'tab-bar__tab--active': tab.id === activeTabId, 'tab-bar__tab--dirty': tab.dirty }"
      role="tab"
      :aria-selected="tab.id === activeTabId"
      @click="emit('activate', tab.id)"
    >
      <span class="tab-bar__title">{{ tab.title }}</span>
      <button class="tab-bar__close" aria-label="关闭标签" @click.stop="emit('close', tab.id)">
        ×
      </button>
    </div>
  </div>
</template>

<style scoped>
/* 横向滚动条：标签溢出时横向滚动，不换行压缩（12 窗口外壳可加拖拽排序） */
.tab-bar {
  display: flex;
  overflow-x: auto;
  border-bottom: 1px solid var(--markwell-border, #e0e0e0);
}
.tab-bar__tab {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  cursor: pointer;
  user-select: none;
  border-right: 1px solid var(--markwell-border, #e0e0e0);
}
.tab-bar__tab--active {
  font-weight: 600;
}
/* 脏标记：标题后圆点（不改 DOM 结构，伪元素实现） */
.tab-bar__tab--dirty .tab-bar__title::after {
  content: "•";
  margin-left: 4px;
}
.tab-bar__close {
  border: none;
  background: none;
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  padding: 0 2px;
}
</style>
