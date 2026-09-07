<!-- EditorSection.vue
     Editor 分区（12.2）：Image Insert 四开关（07 消费即时生效）、auto pair 两开关（重启生效）、
     默认行尾（02 消费即时生效）。 -->
<script setup lang="ts">
import { computed } from "vue";
import type { WritableComputedRef } from "vue";
import SettingRow from "./SettingRow.vue";
import { useSettingsStore } from "./settings-store";
import type { EditorSettings, ImageSettings } from "../../services/settings";

const store = useSettingsStore();

/** Image 组布尔键子集（四开关；insertBehavior/copyTargetDir 为非布尔键不经本绑定） */
type ImageBoolKey =
  "copyToFolderEnabled" | "relativePathEnabled" | "dotSlashPrefixEnabled" | "urlEscapeEnabled";

/**
 * Image 组布尔开关绑定（07 图片管线经失效事件刷新，即时生效）
 * @param key ImageSettings 布尔键（写回走组内单键增量，深合并保留组内其余键）
 */
function imageFlag(key: ImageBoolKey): WritableComputedRef<boolean> {
  return computed<boolean>({
    get: () => Boolean(store.gui?.image[key]),
    set: (value: boolean) => {
      const patch: Partial<ImageSettings> = {};
      patch[key] = value;
      void store.updateGui({ image: patch });
    },
  });
}

/**
 * Editor 组布尔开关绑定（auto pair 输入规则随编辑器 create 注入，重启生效）
 * @param key EditorSettings 键（两键均布尔）
 */
function editorFlag(key: keyof EditorSettings): WritableComputedRef<boolean> {
  return computed<boolean>({
    get: () => Boolean(store.gui?.editor[key]),
    set: (value: boolean) => {
      const patch: Partial<EditorSettings> = {};
      patch[key] = value;
      void store.updateGui({ editor: patch });
    },
  });
}

const copyToFolder = imageFlag("copyToFolderEnabled");
const relativePath = imageFlag("relativePathEnabled");
const dotSlashPrefix = imageFlag("dotSlashPrefixEnabled");
const urlEscape = imageFlag("urlEscapeEnabled");
const autoPairBrackets = editorFlag("autoPairBrackets");
const autoPairMarkdown = editorFlag("autoPairMarkdown");

/** 默认行尾绑定（落盘行尾，02 消费即时生效） */
const lineEnding = computed({
  get: () => store.gui?.defaultLineEnding ?? "lf",
  set: (value: "lf" | "crlf") => {
    void store.updateGui({ defaultLineEnding: value });
  },
});
</script>

<template>
  <section class="settings-section" aria-label="Editor">
    <h2>Editor</h2>
    <SettingRow item-id="editor.image-copy-to-folder">
      <input v-model="copyToFolder" type="checkbox" aria-label="插入图片复制到指定文件夹" />
    </SettingRow>
    <SettingRow item-id="editor.image-relative-path">
      <input v-model="relativePath" type="checkbox" aria-label="图片引用使用相对路径" />
    </SettingRow>
    <SettingRow item-id="editor.image-dot-slash">
      <input v-model="dotSlashPrefix" type="checkbox" aria-label="相对路径加 ./ 前缀" />
    </SettingRow>
    <SettingRow item-id="editor.image-url-escape">
      <input v-model="urlEscape" type="checkbox" aria-label="URL 转义" />
    </SettingRow>
    <SettingRow item-id="editor.auto-pair-brackets">
      <input v-model="autoPairBrackets" type="checkbox" aria-label="自动配对括号与引号" />
    </SettingRow>
    <SettingRow item-id="editor.auto-pair-markdown">
      <input v-model="autoPairMarkdown" type="checkbox" aria-label="自动配对 Markdown 语法标记" />
    </SettingRow>
    <SettingRow item-id="editor.default-line-ending">
      <select v-model="lineEnding" aria-label="默认行尾符" class="setting-control">
        <option value="lf">LF</option>
        <option value="crlf">CRLF</option>
      </select>
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
  max-width: 120px;
}
</style>
