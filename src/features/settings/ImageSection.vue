<!-- ImageSection.vue
     Image 分区（12.4）：上传器占位禁用（AC-S1-4 云上传首版未开放）、插入时处理范围、
     YAML 自动上传占位禁用。禁用占位提示由 SettingRow 经注册表条目渲染。 -->
<script setup lang="ts">
import { computed } from "vue";
import SettingRow from "./SettingRow.vue";
import { useSettingsStore } from "./settings-store";

const store = useSettingsStore();

/** 插入时处理范围（12.4；消费方为云上传接入后的 07 管线，重启生效） */
const insertBehavior = computed({
  get: () => store.gui?.image.insertBehavior ?? "local-only",
  set: (value: "local-only" | "all") => {
    void store.updateGui({ image: { insertBehavior: value } });
  },
});
</script>

<template>
  <section class="settings-section" aria-label="Image">
    <h2>Image</h2>
    <SettingRow item-id="image.uploader">
      <!-- 上传器占位（注册表 disabled + disabledReason 驱动，AC-S1-4） -->
      <select aria-label="图片上传器" class="setting-control" disabled>
        <option>无（占位）</option>
      </select>
    </SettingRow>
    <SettingRow item-id="image.insert-behavior">
      <select v-model="insertBehavior" aria-label="插入时处理范围" class="setting-control">
        <option value="local-only">仅本地图片</option>
        <option value="all">含在线图片</option>
      </select>
    </SettingRow>
    <SettingRow item-id="image.yaml-auto-upload">
      <input type="checkbox" aria-label="YAML 触发自动上传" disabled />
    </SettingRow>
  </section>
</template>

<style scoped>
.settings-section {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.settings-section h2 {
  font-size: 16px;
  margin: 0 0 8px;
}
.setting-control {
  max-width: 200px;
}
</style>
