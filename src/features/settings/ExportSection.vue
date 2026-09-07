<!-- ExportSection.vue
     Export 分区（12.5）：导出位置、导出项管理（09 useExportStore 实体——增删改序实时作用于
     Export 菜单装配）、HTML 选项、PDF 选项与信息行（纸张 A4 固定 / 主题 Windows 仅浅色）。 -->
<script setup lang="ts">
import { computed, ref } from "vue";
import SettingRow from "./SettingRow.vue";
import { useSettingsStore } from "./settings-store";
import { useExportStore } from "../export/export-store";

const store = useSettingsStore();
const exportStore = useExportStore();

/** 新导出项名称输入（本地 UI 态，确认后入 09 store） */
const newItemName = ref("");

/** 导出位置三模式（auto = 文档目录优先） */
const locationMode = computed({
  get: () => store.gui?.export.locationMode ?? "auto",
  set: (value: "auto" | "document-dir" | "custom") => {
    void store.updateGui({ export: { locationMode: value } });
  },
});

/** 自定义导出目录（locationMode=custom 时渲染该行） */
const customDir = computed({
  get: () => store.gui?.export.customDir ?? "",
  set: (value: string) => {
    void store.updateGui({ export: { customDir: value } });
  },
});

/** HTML 导出包含大纲 */
const includeOutline = computed<boolean>({
  get: () => store.gui?.export.includeOutline ?? false,
  set: (value: boolean) => {
    void store.updateGui({ export: { includeOutline: value } });
  },
});

/** YAML front matter 覆盖导出设置（TODO(export) 预留键，重启生效） */
const yamlOverrides = computed<boolean>({
  get: () => store.gui?.export.yamlOverrides ?? false,
  set: (value: boolean) => {
    void store.updateGui({ export: { yamlOverrides: value } });
  },
});

/** HTML 追加 head/body 标签（TODO(export) 预留键，重启生效） */
const htmlAppendHeadBody = computed<boolean>({
  get: () => store.gui?.export.htmlAppendHeadBody ?? false,
  set: (value: boolean) => {
    void store.updateGui({ export: { htmlAppendHeadBody: value } });
  },
});

/** HTML 导出主题（空串 = 跟随当前主题；TODO(export) 预留键，重启生效） */
const htmlThemeOverride = computed({
  get: () => store.gui?.export.htmlThemeOverride ?? "",
  set: (value: string) => {
    void store.updateGui({ export: { htmlThemeOverride: value } });
  },
});

/** PDF 页边距（英寸，默认 0.4；TODO(export) 预留键，重启生效） */
const pdfMarginIn = computed<number>({
  get: () => store.gui?.export.pdfMarginIn ?? 0.4,
  set: (value: number) => {
    void store.updateGui({ export: { pdfMarginIn: value } });
  },
});

/** PDF 页眉模板（${title}/${pageNo}/${pageCount}；空串 = 不启用） */
const pdfHeader = computed({
  get: () => store.gui?.export.pdfHeader ?? "",
  set: (value: string) => {
    void store.updateGui({ export: { pdfHeader: value } });
  },
});

/** PDF 页脚模板（空串 = 不启用） */
const pdfFooter = computed({
  get: () => store.gui?.export.pdfFooter ?? "",
  set: (value: string) => {
    void store.updateGui({ export: { pdfFooter: value } });
  },
});

/** PDF h1 章节分页 */
const pdfPageBreakH1 = computed<boolean>({
  get: () => store.gui?.export.pdfPageBreakH1 ?? false,
  set: (value: boolean) => {
    void store.updateGui({ export: { pdfPageBreakH1: value } });
  },
});

/** 新增自定义导出项（09 store；名称去空白后入列，空名忽略） */
function addExportItem(): void {
  const name = newItemName.value.trim();
  if (name === "") return;
  exportStore.addItem(name);
  newItemName.value = "";
}
</script>

<template>
  <section class="settings-section" aria-label="Export">
    <h2>Export</h2>
    <SettingRow item-id="export.location-mode">
      <select v-model="locationMode" aria-label="默认导出目录" class="setting-control">
        <option value="auto">自动（文档目录优先）</option>
        <option value="document-dir">与文档同目录</option>
        <option value="custom">自定义目录</option>
      </select>
    </SettingRow>
    <SettingRow v-if="locationMode === 'custom'" item-id="export.custom-dir">
      <input
        v-model="customDir"
        type="text"
        aria-label="自定义导出目录"
        class="setting-control--text"
      />
    </SettingRow>
    <SettingRow item-id="export.items">
      <div class="export-items">
        <!-- 导出项列表（09 store 实体：顺序即 Export 菜单序，全部项可排位） -->
        <div v-for="item in exportStore.items" :key="item.id" class="export-items__row">
          <span>{{ item.label }}</span>
          <span class="export-items__actions">
            <button
              type="button"
              :aria-label="`上移 ${item.label}`"
              @click="exportStore.moveItem(item.id, exportStore.items.indexOf(item) - 1)"
            >
              ↑
            </button>
            <button
              type="button"
              :aria-label="`下移 ${item.label}`"
              @click="exportStore.moveItem(item.id, exportStore.items.indexOf(item) + 1)"
            >
              ↓
            </button>
            <!-- 内置项锁定（09 AC-X7-2）：仅自定义项可删 -->
            <button
              v-if="!item.builtin"
              type="button"
              :aria-label="`删除 ${item.label}`"
              @click="exportStore.removeItem(item.id)"
            >
              删除
            </button>
          </span>
        </div>
        <div class="export-items__add">
          <input
            v-model="newItemName"
            type="text"
            aria-label="新导出项名称"
            class="setting-control--text"
          />
          <button type="button" class="setting-button" @click="addExportItem">添加导出项</button>
        </div>
      </div>
    </SettingRow>
    <SettingRow item-id="export.yaml-overrides">
      <input v-model="yamlOverrides" type="checkbox" aria-label="YAML 覆盖导出设置" />
    </SettingRow>
    <SettingRow item-id="export.html-include-outline">
      <input v-model="includeOutline" type="checkbox" aria-label="HTML 导出包含大纲" />
    </SettingRow>
    <SettingRow item-id="export.html-append-head-body">
      <input v-model="htmlAppendHeadBody" type="checkbox" aria-label="HTML 追加 head/body 标签" />
    </SettingRow>
    <SettingRow item-id="export.html-theme">
      <input
        v-model="htmlThemeOverride"
        type="text"
        placeholder="空 = 跟随当前主题"
        aria-label="HTML 导出主题"
        class="setting-control--text"
      />
    </SettingRow>
    <SettingRow item-id="export.pdf-paper">
      <span class="setting-info">A4（首版固定）</span>
    </SettingRow>
    <SettingRow item-id="export.pdf-margin">
      <input
        v-model.number="pdfMarginIn"
        type="number"
        step="0.1"
        min="0"
        aria-label="PDF 页边距（英寸）"
        class="setting-control--number"
      />
    </SettingRow>
    <SettingRow item-id="export.pdf-theme">
      <span class="setting-info">Windows 仅浅色（打印引擎限制）</span>
    </SettingRow>
    <SettingRow item-id="export.pdf-page-break-h1">
      <input v-model="pdfPageBreakH1" type="checkbox" aria-label="PDF 一级标题分页" />
    </SettingRow>
    <SettingRow item-id="export.pdf-header">
      <input v-model="pdfHeader" type="text" aria-label="PDF 页眉" class="setting-control--text" />
    </SettingRow>
    <SettingRow item-id="export.pdf-footer">
      <input v-model="pdfFooter" type="text" aria-label="PDF 页脚" class="setting-control--text" />
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
.setting-info {
  font-size: 13px;
  color: var(--crepe-color-muted, #888);
}
.setting-control--text {
  width: 220px;
}
.setting-control--number {
  width: 80px;
}
.setting-button {
  cursor: pointer;
}
.export-items {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.export-items__row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}
.export-items__actions {
  display: flex;
  gap: 4px;
}
.export-items__add {
  display: flex;
  gap: 8px;
  margin-top: 4px;
}
</style>
