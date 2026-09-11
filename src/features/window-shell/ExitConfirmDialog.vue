<!-- 退出聚合确认弹窗（12 窗口外壳 W6，AC-M-18：列表式一次性确认）。
     列出全部脏标签文件名，三按钮「全部保存/全部不保存/取消」（Esc=取消语义）；
     挂起态由 12 exit-confirm 状态机驱动（v-if 装配于 App.vue，confirming+saving
     期间展示），三按钮分别 emit saveAll/discardAll/cancel 由状态机分支执行。
     样式基调沿 04 ConfirmCloseDialog（fixed 遮罩 + 居中面板 + 右对齐按钮行）。 -->
<script setup lang="ts">
import { onBeforeUnmount, onMounted } from "vue";
import type { DirtyTabEntry } from "./exit-confirm";

const props = defineProps<{
  /** 冻结的脏标签列表（进入确认时点快照，文件名逐项展示） */
  items: DirtyTabEntry[];
  /** 逐标签写盘进行中（saving 阶段禁用全部按钮，防重复触发保证写盘原子性） */
  saving: boolean;
}>();

const emit = defineEmits<{
  /** 全部保存：状态机逐标签写盘，全部成功才关窗（AC-M-19） */
  saveAll: [];
  /** 全部不保存：丢弃列表变更直接关窗（用户显式一次性决定） */
  discardAll: [];
  /** 取消：中止本轮，窗口保持内容不变（AC-M-20） */
  cancel: [];
}>();

/**
 * Esc = 取消（模态确认的键盘逃生口）。document 级 keydown 捕获（弹窗遮罩不挡
 * 键盘事件）；defaultPrevented 守卫——前置监听（如查找面板 Esc）已消费按键时
 * 不重复响应；写盘期忽略（saving 中取消语义由状态机守卫禁用）。
 */
function onKeydown(event: KeyboardEvent): void {
  if (event.key !== "Escape" || event.defaultPrevented || props.saving) return;
  emit("cancel");
}

onMounted(() => document.addEventListener("keydown", onKeydown));
onBeforeUnmount(() => document.removeEventListener("keydown", onKeydown));
</script>

<template>
  <div class="exit-confirm" role="dialog" aria-label="未保存的更改">
    <div class="exit-confirm__panel">
      <p class="exit-confirm__message">以下文件有未保存的更改：</p>
      <ul class="exit-confirm__list">
        <li v-for="item in items" :key="item.id">{{ item.title }}</li>
      </ul>
      <div class="exit-confirm__actions">
        <button type="button" :disabled="saving" @click="emit('saveAll')">全部保存</button>
        <button type="button" :disabled="saving" @click="emit('discardAll')">全部不保存</button>
        <button type="button" :disabled="saving" @click="emit('cancel')">取消</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.exit-confirm {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.3);
  z-index: 100;
}
.exit-confirm__panel {
  background: var(--markwell-surface, #fff);
  padding: 16px 20px;
  border-radius: 6px;
  min-width: 280px;
}
.exit-confirm__list {
  max-height: 40vh;
  overflow-y: auto;
  margin: 8px 0 0;
  padding-left: 20px;
}
.exit-confirm__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 12px;
}
</style>
