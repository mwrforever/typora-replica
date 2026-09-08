<!-- SettingsPanel.vue
     偏好设置面板（10 S1）：7 分区导航（Save & Recover 为 General 内部区锚点）+ 面板内 Ctrl+F
     搜索（AC-S1-2：搜索态展示命中条目列表，点击条目跳转对应分区）+ 分区表单切换。
     开合由 settingsStore.visible 驱动（Ctrl+, / 12 菜单）；面板以应用内浮层呈现（披露 5，
     独立窗口归 12）。ESC 关闭。 -->
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useSettingsStore } from "./settings-store";
import { filterSettingsItems, SETTINGS_ITEMS, SETTINGS_SECTIONS } from "./settings-registry";
import type { SettingsSectionId } from "./settings-registry";
import GeneralSection from "./GeneralSection.vue";
import EditorSection from "./EditorSection.vue";
import ImageSection from "./ImageSection.vue";
import AppearanceSection from "./AppearanceSection.vue";
import MarkdownSection from "./MarkdownSection.vue";
import ExportSection from "./ExportSection.vue";

const store = useSettingsStore();

/** 当前激活分区（save-recover 锚点映射到 general 渲染） */
const activeSection = ref<SettingsSectionId>("general");

/** 面板内搜索词（非空 = 搜索态，隐藏分区表单） */
const query = ref("");

/** 搜索框 DOM 引用（Ctrl+F 聚焦目标） */
const searchInput = ref<HTMLInputElement | null>(null);

/** 搜索命中条目（附分区显示名供结果行呈现；过滤为注册表纯函数，大小写不敏感） */
const searchHits = computed(() =>
  filterSettingsItems(SETTINGS_ITEMS, query.value).map((item) => ({
    ...item,
    sectionLabel: SETTINGS_SECTIONS.find((s) => s.id === item.section)?.label ?? item.section,
  })),
);

/** 激活分区对应的表单组件（save-recover 锚点渲染 General——内部区在其中） */
const activeComponent = computed(() => {
  const target: SettingsSectionId =
    activeSection.value === "save-recover" ? "general" : activeSection.value;
  return {
    general: GeneralSection,
    editor: EditorSection,
    image: ImageSection,
    appearance: AppearanceSection,
    markdown: MarkdownSection,
    export: ExportSection,
  }[target];
});

/** 分区切换（Save & Recover：切到 General 并滚动到内部区锚点） */
function selectSection(id: SettingsSectionId): void {
  activeSection.value = id;
  if (id === "save-recover") {
    // 锚点定位在表单渲染完成后下一帧执行（v-if 切换 DOM 未即时就绪）
    requestAnimationFrame(() => {
      document.getElementById("save-recover-anchor")?.scrollIntoView({ block: "start" });
    });
  }
}

/** 搜索结果点击：跳转目标分区并清空搜索（恢复表单态） */
function gotoHit(item: { section: SettingsSectionId }): void {
  activeSection.value = item.section === "save-recover" ? "general" : item.section;
  query.value = "";
}

// 面板关闭时清空搜索态：搜索词不跨开合残留，重开即分区表单视图（导航立即可用）
watch(
  () => store.visible,
  (visible) => {
    if (!visible) {
      query.value = "";
    }
  },
);

/**
 * 面板级键盘处理：Ctrl+F 聚焦搜索（AC-S1-2）、ESC 关闭。
 * visible 守卫（批1 审查 M1）：组件常驻挂载（浮层由模板 v-if 驱动显隐）而监听器挂
 * window——面板隐藏时必须让位编辑器搜索（App.vue 侧「可见时归面板」守卫的成对面），
 * 禁止隐藏态仍 preventDefault 抢占 Ctrl+F。
 * Ctrl+F 采用纯 Ctrl 组合口径（排除 Shift/Alt/Meta，与既有窗口快捷键同口径）。
 */
function onKeydown(event: KeyboardEvent): void {
  if (!store.visible) return;
  if (
    event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey &&
    !event.metaKey &&
    event.key.toLowerCase() === "f"
  ) {
    event.preventDefault();
    searchInput.value?.focus();
  } else if (event.key === "Escape") {
    store.close();
  }
}

onMounted(() => window.addEventListener("keydown", onKeydown));
onBeforeUnmount(() => window.removeEventListener("keydown", onKeydown));
</script>

<template>
  <div v-if="store.visible" class="settings-overlay" role="dialog" aria-label="偏好设置">
    <div class="settings-panel">
      <aside class="settings-panel__side">
        <input
          ref="searchInput"
          v-model="query"
          type="text"
          aria-label="搜索设置项"
          placeholder="搜索设置项（Ctrl+F）"
          data-testid="settings-search-input"
          class="settings-panel__search"
        />
        <nav aria-label="设置分区" data-testid="settings-nav">
          <ul class="settings-nav">
            <li v-for="section in SETTINGS_SECTIONS" :key="section.id">
              <button
                type="button"
                class="settings-nav__item"
                :class="{ 'settings-nav__item--active': activeSection === section.id }"
                data-testid="settings-nav-item"
                @click="selectSection(section.id)"
              >
                {{ section.label }}
              </button>
            </li>
          </ul>
        </nav>
      </aside>
      <div class="settings-panel__main">
        <!-- 高级读取失败提示条（store.advancedError 呈现，不阻断面板其余操作） -->
        <p v-if="store.advancedError" class="settings-panel__error" role="alert">
          {{ store.advancedError }}
        </p>
        <!-- 搜索态：命中条目列表；空态：激活分区表单 -->
        <template v-if="query.trim() !== ''">
          <ul v-if="searchHits.length > 0" class="settings-hits">
            <li v-for="hit in searchHits" :key="hit.id">
              <button type="button" class="settings-hits__item" @click="gotoHit(hit)">
                <span>{{ hit.label }}</span>
                <span class="settings-hits__meta">
                  {{ hit.sectionLabel }} · {{ hit.effect === "restart" ? "重启生效" : "即时" }}
                </span>
              </button>
            </li>
          </ul>
          <p v-else class="settings-panel__empty">未找到匹配的设置项</p>
        </template>
        <component :is="activeComponent" v-else-if="store.gui" />
        <p v-else class="settings-panel__empty">正在加载设置…</p>
      </div>
      <button
        type="button"
        class="settings-panel__close"
        aria-label="关闭偏好设置"
        @click="store.close"
      >
        ×
      </button>
    </div>
  </div>
</template>

<style scoped>
.settings-overlay {
  position: fixed;
  inset: 0;
  background: rgb(0 0 0 / 40%);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}
.settings-panel {
  background: var(--crepe-color-background, #fff);
  border-radius: 8px;
  width: min(860px, 92vw);
  height: min(600px, 88vh);
  display: flex;
  position: relative;
  overflow: hidden;
}
.settings-panel__side {
  width: 180px;
  border-right: 1px solid var(--crepe-color-background, #eee);
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.settings-panel__search {
  width: 100%;
  box-sizing: border-box;
}
.settings-nav {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.settings-nav__item {
  width: 100%;
  text-align: left;
  border: none;
  background: transparent;
  padding: 6px 8px;
  border-radius: 4px;
  cursor: pointer;
}
.settings-nav__item--active {
  background: var(--crepe-color-primary-light, #eef3ff);
}
.settings-panel__main {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px;
}
.settings-panel__error {
  color: #c0392b;
  font-size: 13px;
}
.settings-panel__empty {
  color: var(--crepe-color-muted, #888);
}
.settings-hits {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.settings-hits__item {
  width: 100%;
  display: flex;
  justify-content: space-between;
  border: none;
  background: transparent;
  padding: 6px 8px;
  border-radius: 4px;
  cursor: pointer;
  text-align: left;
}
.settings-hits__meta {
  color: var(--crepe-color-muted, #888);
  font-size: 12px;
}
.settings-panel__close {
  position: absolute;
  top: 8px;
  right: 8px;
  border: none;
  background: transparent;
  font-size: 18px;
  cursor: pointer;
}
</style>
