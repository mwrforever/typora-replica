<!-- SettingRow.vue
     设置行通用件（10 偏好面板）：label + 生效徽标 + 禁用占位提示。
     徽标与占位由注册表条目驱动（单一事实源），分区表单仅经默认插槽传入控件。 -->
<script setup lang="ts">
import { computed } from "vue";
import { SETTINGS_ITEM_BY_ID } from "./settings-registry";
import type { SettingsItem } from "./settings-registry";

/** 组件属性 */
const props = defineProps<{
  /** 注册表条目 id（SETTINGS_ITEM_BY_ID 查找；未命中回退 undefined——仅渲染控件不加标签，
   * 表单组件与注册表须同步维护，typecheck 不拦字符串 id） */
  itemId: string;
}>();

/** 条目元数据（未注册 id 的行为面：label 空、无徽标、不禁用） */
const item = computed<SettingsItem | undefined>(() => SETTINGS_ITEM_BY_ID[props.itemId]);
</script>

<template>
  <div class="setting-row" :data-setting-id="itemId" :data-testid="`setting-row-${itemId}`">
    <div class="setting-row__head">
      <span class="setting-row__label">{{ item?.label }}</span>
      <!-- 重启生效徽标（AC-S1-5）：注册表 effect=restart 时渲染 -->
      <span v-if="item?.effect === 'restart'" class="setting-row__badge">重启生效</span>
    </div>
    <div class="setting-row__body" :class="{ 'setting-row__body--disabled': item?.disabled }">
      <slot />
      <!-- 禁用占位原因（AC-S1-4：云上传等未开放项） -->
      <span v-if="item?.disabled" class="setting-row__reason">{{ item.disabledReason }}</span>
    </div>
  </div>
</template>

<style scoped>
.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 6px 0;
}
.setting-row__head {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.setting-row__badge {
  flex: none;
  font-size: 12px;
  color: var(--crepe-color-primary, #4b7bec);
  border: 1px solid currentColor;
  border-radius: 4px;
  padding: 0 4px;
}
.setting-row__body {
  display: flex;
  align-items: center;
  gap: 8px;
}
.setting-row__body--disabled {
  opacity: 0.5;
}
.setting-row__reason {
  font-size: 12px;
  color: var(--crepe-color-muted, #888);
}
</style>
