<!-- 状态栏（11）：左区侧栏开关按钮（渲染归 11、开关逻辑转发 03 fileTree.toggleSidebar）
     + 右区字数按钮与统计弹面板（行数/字数/字符数/估计阅读时间；点击单位条目切换默认
     计数单位；选中文字显示「选中 N / 总 N」）；显隐消费 appearance.showStatusBar（D1）。
     拼写检查图标占位按 D2 决策本次不渲染（调研 §2.2 裁决）。
     临时装配点挂 App.vue .app-shell 尾部（fixed 底部浮层；12 窗口外壳迁移时随组件走） -->
<script setup lang="ts">
import { computed, onUnmounted } from "vue";
import { useFileTreeStore } from "../file-tree/file-tree-store";
import { useSettingsStore } from "../settings/settings-store";
import { useStatusBarStore } from "./status-bar-store";
import { useStatusBarData } from "./use-status-bar-data";

const store = useStatusBarStore();
const settings = useSettingsStore();
const fileTree = useFileTreeStore();

// 数据装配订阅与组件生命周期严格成对（useOutlineData 同模式；dispose 内含双通道退订
// 与标签 watch 解除）
const { dispose } = useStatusBarData();
onUnmounted(dispose);

// 显隐消费（D1：组件内自读设置快照；merged 未装载窗口期回落默认开）
const visible = computed(() => settings.merged.appearance.showStatusBar);
</script>

<template>
  <div v-if="visible" class="status-bar" data-status-bar>
    <!-- 左区：侧栏开关按钮（渲染归 11，开关逻辑转发 03/12——fileTree.toggleSidebar，AC-S3-9） -->
    <button
      type="button"
      class="status-bar__button"
      aria-label="切换侧栏"
      @click="fileTree.toggleSidebar()"
    >
      ☰
    </button>
    <!-- 右区：字数按钮（默认字数单位；选中态「选中 N / 总 N」由 Task 7 扩展） -->
    <button type="button" class="status-bar__button" data-status-bar-count>
      {{ store.docStats.words }} 词
    </button>
  </div>
</template>

<style scoped>
/* 状态栏容器：临时装配点为 fixed 底部浮层（D1；12 窗口外壳接管后由容器布局接管，
   届时移除 fixed 改文档流占位，披露 6） */
.status-bar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 500;
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 28px;
  padding: 0 8px;
  font-size: 12px;
  background: var(--markwell-bg, #fff);
  border-top: 1px solid var(--markwell-border, #ddd);
  color: var(--markwell-text, #333);
}

.status-bar__button {
  padding: 2px 8px;
  border: none;
  background: none;
  font-size: 12px;
  color: inherit;
  cursor: pointer;
  white-space: nowrap;
}

.status-bar__button:hover {
  background: var(--markwell-accent-weak, #e8f1ff);
}
</style>
