<!-- C2 关闭脏标签确认（04：三按钮「保存/不保存/取消」，自绘 modal——
     tauri dialog 不支持三按钮，Typora 亦自绘）。
     挂起态由 tabs-controller.closeRequest 驱动（v-if 装配于 App.vue），
     三按钮分别 emit save/discard/cancel，由上层按 AC-C2-2/3 分支执行。 -->
<script setup lang="ts">
defineProps<{
  /** 标签标题（提示文案用，帮助用户识别目标标签） */
  title: string;
}>();

const emit = defineEmits<{
  /** 保存后关闭（上层走 02 保存链路，成功后关——AC-C2-2） */
  save: [];
  /** 不保存直接关闭（内容丢弃，重开栈仍存关闭前内容——D4） */
  discard: [];
  /** 取消：标签保持打开（AC-C2-3） */
  cancel: [];
}>();
</script>

<template>
  <div class="confirm-close" role="dialog" aria-label="未保存的更改">
    <div class="confirm-close__panel">
      <p class="confirm-close__message">{{ title }} 有未保存的更改，是否保存？</p>
      <div class="confirm-close__actions">
        <button type="button" @click="emit('save')">保存</button>
        <button type="button" @click="emit('discard')">不保存</button>
        <button type="button" @click="emit('cancel')">取消</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.confirm-close {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.3);
  z-index: 100;
}
.confirm-close__panel {
  background: var(--markwell-surface, #fff);
  padding: 16px 20px;
  border-radius: 6px;
  min-width: 280px;
}
.confirm-close__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 12px;
}
</style>
