<!-- MarkdownSection.vue
     Markdown 分区（12.3）：语法开关组 + Code Fences 选项组；schema/输入规则随编辑器 create
     注入，全部「重启生效」徽标（AC-S1-5 由 SettingRow + 注册表条目驱动）。 -->
<script setup lang="ts">
import { computed } from "vue";
import type { WritableComputedRef } from "vue";
import SettingRow from "./SettingRow.vue";
import { useSettingsStore } from "./settings-store";
import { normalizeNumberInput } from "./number-input";
import { DEFAULT_SETTINGS } from "../../services/settings";
import type { CodeFenceSettings, MarkdownSettings } from "../../services/settings";

const store = useSettingsStore();

/** Markdown 顶层语法键子集（排除 codeFence 子组——子组经 codeFence 系列绑定写回） */
type MarkdownFlagKey = Exclude<keyof MarkdownSettings, "codeFence">;

/**
 * Markdown 顶层布尔开关绑定（重启生效：编辑器 create 时读取注入 schema/输入规则）
 * @param key MarkdownSettings 布尔键（写回走组内单键增量，深合并保留 codeFence 子组）
 */
function markdownFlag(key: MarkdownFlagKey): WritableComputedRef<boolean> {
  return computed<boolean>({
    get: () => Boolean(store.gui?.markdown[key]),
    set: (value: boolean) => {
      const patch: Partial<MarkdownSettings> = {};
      patch[key] = value;
      void store.updateGui({ markdown: patch });
    },
  });
}

/**
 * Code Fences 布尔开关绑定（嵌套子组，深合并只改目标键）
 * @param key CodeFenceSettings 布尔键（行号/换行/Shift+Tab 缩进/Last Used）
 */
function codeFenceFlag(
  key: "lineNumbers" | "wrapLongLines" | "shiftTabIndent" | "useLastUsedLanguage",
): WritableComputedRef<boolean> {
  return computed<boolean>({
    get: () => Boolean(store.gui?.markdown.codeFence[key]),
    set: (value: boolean) => {
      const patch: Partial<CodeFenceSettings> = {};
      patch[key] = value;
      void store.updateGui({ markdown: { codeFence: patch } });
    },
  });
}

const inlineMath = markdownFlag("inlineMath");
const diagrams = markdownFlag("diagrams");
const strictMode = markdownFlag("strictMode");
const highlight = markdownFlag("highlight");
const superscript = markdownFlag("superscript");
const subscript = markdownFlag("subscript");
const spellcheck = markdownFlag("spellcheck");
const lineNumbers = codeFenceFlag("lineNumbers");
const wrapLongLines = codeFenceFlag("wrapLongLines");
const shiftTabIndent = codeFenceFlag("shiftTabIndent");
const useLastUsedLanguage = codeFenceFlag("useLastUsedLanguage");

/** 代码块缩进宽度绑定（空格数 1-8）；清空 / 非法输入回退默认 4（批1 M2 收口） */
const indentWidth = computed<number>({
  get: () => store.gui?.markdown.codeFence.indentWidth ?? 4,
  set: (value: number | string) => {
    void store.updateGui({
      markdown: {
        codeFence: {
          indentWidth: normalizeNumberInput(value, DEFAULT_SETTINGS.markdown.codeFence.indentWidth),
        },
      },
    });
  },
});

/** 默认代码语言绑定（空串 = 无；非空时优先于 Last Used 语义） */
const defaultLanguage = computed<string>({
  get: () => store.gui?.markdown.codeFence.defaultLanguage ?? "",
  set: (value: string) => {
    void store.updateGui({ markdown: { codeFence: { defaultLanguage: value } } });
  },
});
</script>

<template>
  <section class="settings-section" aria-label="Markdown">
    <h2>Markdown</h2>
    <SettingRow item-id="markdown.inline-math">
      <input v-model="inlineMath" type="checkbox" aria-label="行内数学公式" />
    </SettingRow>
    <SettingRow item-id="markdown.diagrams">
      <input v-model="diagrams" type="checkbox" aria-label="图表" />
    </SettingRow>
    <SettingRow item-id="markdown.strict-mode">
      <input v-model="strictMode" type="checkbox" aria-label="严格模式" />
    </SettingRow>
    <SettingRow item-id="markdown.code-fence-line-numbers">
      <input v-model="lineNumbers" type="checkbox" aria-label="代码块显示行号" />
    </SettingRow>
    <SettingRow item-id="markdown.code-fence-wrap">
      <input v-model="wrapLongLines" type="checkbox" aria-label="代码块长行自动换行" />
    </SettingRow>
    <SettingRow item-id="markdown.code-fence-shift-tab">
      <input v-model="shiftTabIndent" type="checkbox" aria-label="Shift+Tab 缩进选中行" />
    </SettingRow>
    <SettingRow item-id="markdown.code-fence-indent-width">
      <input
        v-model.number="indentWidth"
        type="number"
        min="1"
        max="8"
        aria-label="代码块缩进宽度"
        class="setting-control--number"
      />
    </SettingRow>
    <SettingRow item-id="markdown.code-fence-default-language">
      <input
        v-model="defaultLanguage"
        type="text"
        placeholder="无"
        aria-label="默认代码语言"
        class="setting-control--text"
      />
    </SettingRow>
    <SettingRow item-id="markdown.code-fence-last-used">
      <input v-model="useLastUsedLanguage" type="checkbox" aria-label="新代码块使用上次语言" />
    </SettingRow>
    <SettingRow item-id="markdown.highlight">
      <input v-model="highlight" type="checkbox" aria-label="高亮语法" />
    </SettingRow>
    <SettingRow item-id="markdown.superscript">
      <input v-model="superscript" type="checkbox" aria-label="上标语法" />
    </SettingRow>
    <SettingRow item-id="markdown.subscript">
      <input v-model="subscript" type="checkbox" aria-label="下标语法" />
    </SettingRow>
    <SettingRow item-id="markdown.spellcheck">
      <input v-model="spellcheck" type="checkbox" aria-label="拼写检查" />
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
.setting-control--number {
  width: 72px;
}
.setting-control--text {
  width: 180px;
}
</style>
