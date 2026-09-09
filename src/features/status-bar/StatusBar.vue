<!-- 状态栏（11）：左区侧栏开关按钮（渲染归 11、开关逻辑转发 03 fileTree.toggleSidebar）
     + 右区字数按钮与统计弹面板（行数/字数/字符数/估计阅读时间；点击单位条目切换默认
     计数单位；选中文字显示「选中 N / 总 N」）；显隐消费 appearance.showStatusBar（D1）。
     拼写检查图标占位按 D2 决策本次不渲染（调研 §2.2 裁决）。
     临时装配点挂 App.vue .app-shell 尾部（fixed 底部浮层；12 窗口外壳迁移时随组件走） -->
<script setup lang="ts">
import { computed, onUnmounted, ref } from "vue";
import { useFileTreeStore } from "../file-tree/file-tree-store";
import { useSettingsStore } from "../settings/settings-store";
import { useStatusBarStore } from "./status-bar-store";
import { useStatusBarData } from "./use-status-bar-data";
import { estimateReadingMinutes, type WordCountUnit } from "../../utils/word-count";

const store = useStatusBarStore();
const settings = useSettingsStore();
const fileTree = useFileTreeStore();

// 数据装配订阅与组件生命周期严格成对（useOutlineData 同模式；dispose 内含双通道退订
// 与标签 watch 解除）
const { dispose } = useStatusBarData();
onUnmounted(dispose);

// 显隐消费（D1：组件内自读设置快照；merged 未装载窗口期回落默认开）
const visible = computed(() => settings.merged.appearance.showStatusBar);

// 阅读速度（词/分钟，settings.merged.appearance.readingSpeed；0/负值 → 阅读时间行隐藏）
const readingSpeed = computed(() => settings.merged.appearance.readingSpeed);

// 估计阅读时间（分钟，向上取整；undefined = 阅读时间行隐藏，AC-S3-6；恒按字数折算）
const readingMinutes = computed(() =>
  estimateReadingMinutes(store.docStats.words, readingSpeed.value),
);

// 统计弹面板显隐
const panelOpen = ref(false);

// 单位条目基表（面板展示顺序 = 调研 §2.1 自定：行数/字数/字符数；suffix 为按钮计数后缀）
const UNITS: Array<{ id: WordCountUnit; label: string; suffix: string }> = [
  { id: "lines", label: "行数", suffix: "行" },
  { id: "words", label: "字数", suffix: "词" },
  { id: "characters", label: "字符数", suffix: "字符" },
];

// 默认计数单位（会话内 UI 状态仅本组件消费——不入 store，B.2.4；默认字数 = 调研 §2.1 用户实测）
const unit = ref<WordCountUnit>("words");

// 按单位取全量统计值（面板条目数值与「总 N」共用的取值口）
function totalFor(id: WordCountUnit): number {
  switch (id) {
    case "lines":
      return store.docStats.lines;
    case "characters":
      return store.docStats.characters;
    case "words":
      return store.docStats.words;
  }
}

// 字数按钮点击：开合统计弹面板（面板与按钮自身 @click.stop 不冒泡，见模板）
function togglePanel(): void {
  panelOpen.value = !panelOpen.value;
  if (panelOpen.value) {
    // 开：登记 document 一次性 click 做 click-away 关闭（outline 右键菜单同模式）
    document.addEventListener("click", closePanel, { once: true });
  } else {
    // 关：解除未消费的 click-away 监听（幂等，防后续无关点击空触发）
    document.removeEventListener("click", closePanel);
  }
}

// 关闭面板并解除 click-away 监听（幂等：监听未登记时 remove 为无害操作）
function closePanel(): void {
  panelOpen.value = false;
  document.removeEventListener("click", closePanel);
}

// 卸载兜底：解除 click-away 监听（数据装配 dispose 已在上方登记）
onUnmounted(() => {
  closePanel();
});
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
    <!-- 右区：字数按钮（默认字数单位；选中态「选中 N / 总 N」由 Task 7 扩展）。
         @click.stop 防开面板的这次点击冒泡到 document 立即触发 click-away -->
    <button
      type="button"
      class="status-bar__button"
      data-status-bar-count
      :aria-expanded="panelOpen"
      @click.stop="togglePanel"
    >
      {{ store.docStats.words }} 词
    </button>
    <!-- 统计弹面板：锚定字数按钮上方（调研 §4 自定形态；绝对定位随状态栏右缘）。
         @click.stop 面板内点击不冒泡——面板内点击不触发 click-away 关闭 -->
    <div
      v-if="panelOpen"
      class="status-bar__panel"
      role="dialog"
      aria-label="统计详情"
      data-status-bar-panel
      @click.stop
    >
      <!-- 单位条目：渲染四项中前三项（行数/字数/字符数，调研 §2.1 自定顺序）；
           当前单位带 ✓（等宽占位防抖动）。本任务只渲染，点击切换行为由 Task 7 补 -->
      <button
        v-for="u in UNITS"
        :key="u.id"
        type="button"
        class="status-bar__row"
        :data-status-bar-unit="u.id"
      >
        <span class="status-bar__check">{{ unit === u.id ? "✓" : "" }}</span>
        {{ u.label }} {{ totalFor(u.id) }}
      </button>
      <!-- 阅读时间行：非单位条目不可点击；阅读速度 ≤ 0 整行隐藏（AC-S3-6） -->
      <div v-if="readingMinutes !== undefined" class="status-bar__row status-bar__row--info">
        <span class="status-bar__check"></span>
        估计阅读时间 {{ readingMinutes }} 分钟
      </div>
    </div>
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

/* 统计弹面板：绝对定位锚定状态栏右缘上方（jsdom 零矩形不影响功能与断言） */
.status-bar__panel {
  position: absolute;
  right: 8px;
  bottom: 30px;
  z-index: 600;
  min-width: 160px;
  padding: 4px;
  background: var(--markwell-bg, #fff);
  border: 1px solid var(--markwell-border, #ddd);
  border-radius: 6px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.18);
}

/* 面板行：单位条目（button）与信息行（div）共用行形态 */
.status-bar__row {
  display: block;
  width: 100%;
  padding: 4px 8px;
  border: none;
  background: none;
  text-align: left;
  font-size: 12px;
  color: var(--markwell-text, #333);
  cursor: pointer;
  white-space: nowrap;
}

.status-bar__row:hover {
  background: var(--markwell-accent-weak, #e8f1ff);
}

/* 阅读时间信息行：不可点击语义（cursor/default + hover 不高亮） */
.status-bar__row--info {
  cursor: default;
  color: var(--markwell-text-dim, #888);
}

.status-bar__row--info:hover {
  background: none;
}

/* 勾选占位等宽：勾选态切换不引起面板行文字抖动（outline 菜单勾选先例） */
.status-bar__check {
  display: inline-block;
  width: 18px;
}
</style>
