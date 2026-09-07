<!-- AppearanceSection.vue
     Appearance 分区（12.1）：明暗主题双选（08 即时生效）、状态栏/字号/阅读速度（消费方 11/12，
     重启生效标注）、高级键说明（defaultFontFamily/autoHideMenuBar/monocolorEmoji）。 -->
<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import type { WritableComputedRef } from "vue";
import SettingRow from "./SettingRow.vue";
import { useSettingsStore } from "./settings-store";
import { listThemes } from "../../services/theme-io";
import type { ThemeMeta } from "../../services/theme-io";
import type { ThemeSettings } from "../../services/settings";

const store = useSettingsStore();

/** 主题候选（面板打开时拉取一次；失败回落空列表——主题选择器降级为空选项，不崩面板） */
const themes = ref<ThemeMeta[]>([]);
onMounted(async () => {
  try {
    themes.value = (await listThemes()).themes;
  } catch (error: unknown) {
    console.warn("[MarkWell] 主题列表读取失败（主题选择器降级）:", error);
  }
});

/**
 * 主题双选绑定（08 消费即时生效）
 * @param key 明/暗模式键（写回走组内单键增量，深合并保留另一侧主题名）
 */
function themeBinding(key: "lightTheme" | "darkTheme"): WritableComputedRef<string> {
  return computed<string>({
    get: () => store.gui?.theme[key] ?? "",
    set: (value: string) => {
      const patch: Partial<ThemeSettings> = {};
      patch[key] = value;
      void store.updateGui({ theme: patch });
    },
  });
}
const lightTheme = themeBinding("lightTheme");
const darkTheme = themeBinding("darkTheme");

/** 状态栏显隐（消费方 11 装配） */
const showStatusBar = computed<boolean>({
  get: () => store.gui?.appearance.showStatusBar ?? true,
  set: (value: boolean) => {
    void store.updateGui({ appearance: { showStatusBar: value } });
  },
});

/** 字号绑定（undefined = 跟随主题；输入空串/非法值还原跟随主题语义） */
const fontSize = computed<string | number>({
  get: () => store.gui?.appearance.fontSize ?? "",
  set: (value: string | number) => {
    const parsed = typeof value === "number" ? value : Number.parseInt(value, 10);
    void store.updateGui({
      appearance: { fontSize: Number.isFinite(parsed) && parsed > 0 ? parsed : undefined },
    });
  },
});

/** 阅读速度（词/分钟，阅读时间统计口径） */
const readingSpeed = computed<number>({
  get: () => store.gui?.appearance.readingSpeed ?? 200,
  set: (value: number) => {
    void store.updateGui({ appearance: { readingSpeed: value } });
  },
});
</script>

<template>
  <section class="settings-section" aria-label="Appearance">
    <h2>Appearance</h2>
    <SettingRow item-id="appearance.light-theme">
      <select v-model="lightTheme" aria-label="浅色模式主题" class="setting-control">
        <option v-for="t in themes" :key="t.name" :value="t.name">{{ t.label }}</option>
      </select>
    </SettingRow>
    <SettingRow item-id="appearance.dark-theme">
      <select v-model="darkTheme" aria-label="深色模式主题" class="setting-control">
        <option v-for="t in themes" :key="t.name" :value="t.name">{{ t.label }}</option>
      </select>
    </SettingRow>
    <SettingRow item-id="appearance.show-status-bar">
      <input v-model="showStatusBar" type="checkbox" aria-label="显示状态栏" />
    </SettingRow>
    <SettingRow item-id="appearance.font-size">
      <input
        v-model="fontSize"
        type="number"
        min="1"
        placeholder="跟随主题"
        aria-label="字号"
        class="setting-control setting-control--number"
      />
    </SettingRow>
    <SettingRow item-id="appearance.reading-speed">
      <input
        v-model.number="readingSpeed"
        type="number"
        min="1"
        aria-label="阅读速度"
        class="setting-control setting-control--number"
      />
    </SettingRow>
    <!-- 高级键说明（只读文档性文本；值经 conf.user.json 手编，重启生效） -->
    <p class="settings-section__hint">
      高级键（conf.user.json，重启生效）：defaultFontFamily 默认字体族 / autoHideMenuBar
      菜单栏自动隐藏（true 启用，Alt 切换）/ monocolorEmoji 单色表情。
    </p>
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
.settings-section__hint {
  font-size: 12px;
  color: var(--crepe-color-muted, #888);
}
.setting-control {
  max-width: 200px;
}
.setting-control--number {
  width: 96px;
}
</style>
