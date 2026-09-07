<!-- GeneralSection.vue
     General 分区（12.6）：启动行为、主题目录/高级设置入口、界面语言占位、重置高级设置、
     高级键说明（searchService/flags/keyBinding）；内含 Save & Recover 内部区锚点
     （12.2 Auto Save 落位，导航点击滚动定位到本锚点）。 -->
<script setup lang="ts">
import { computed } from "vue";
import SettingRow from "./SettingRow.vue";
import { useSettingsStore } from "./settings-store";
import { openThemeFolder } from "../../services/theme-io";
import { openFolderDialog } from "../../services/open-commands";

const store = useSettingsStore();

/** 启动行为绑定（AC-S1-3：变更即经 updateGui 持久化；02 启动链路消费） */
const launchMode = computed({
  get: () => store.gui?.launch.mode ?? "restore-folder",
  set: (mode: "new" | "restore-folder" | "restore-both" | "custom-folder") => {
    void store.updateGui({ launch: { mode } });
  },
});

/** 自定义启动目录绑定（mode=custom-folder 时渲染该行） */
const launchCustomPath = computed({
  get: () => store.gui?.launch.customPath ?? "",
  set: (path: string) => {
    void store.updateGui({ launch: { customPath: path } });
  },
});

/** 自动保存开关联动（Save & Recover 内部区；写回时带上合并快照的间隔，避免丢字段） */
const autoSaveEnabled = computed({
  get: () => store.merged.autoSave.enabled,
  set: (enabled: boolean) => {
    void store.updateGui({
      autoSave: { enabled, timerMinutes: store.merged.autoSave.timerMinutes },
    });
  },
});

/** 自动保存间隔（write-through 双写 conf autoSaveTimer——Task 4 双层一致性契约） */
const autoSaveTimer = computed({
  get: () => store.merged.autoSave.timerMinutes,
  set: (minutes: number) => {
    void store.updateAutoSaveTimer(minutes);
  },
});

/** 打开自定义启动目录（系统目录对话框，选中即写回；取消返回 null 不动原值） */
async function pickLaunchFolder(): Promise<void> {
  const picked = await openFolderDialog();
  if (picked) launchCustomPath.value = picked;
}

/**
 * 重置高级设置（AC-S2-3 面板入口）：确认后执行；失败原因写入 store.advancedError
 * 由面板顶部提示条呈现（不阻断面板其余操作）
 */
async function onResetAdvanced(): Promise<void> {
  const confirmed = window.confirm(
    "将把 conf.user.json 恢复为默认高级配置（面板偏好不受影响）。继续？",
  );
  if (!confirmed) return;
  try {
    await store.resetAdvanced();
  } catch (error: unknown) {
    store.advancedError = error instanceof Error ? error.message : "重置高级设置失败";
  }
}
</script>

<template>
  <section class="settings-section" aria-label="General">
    <h2>General</h2>
    <SettingRow item-id="general.launch">
      <select v-model="launchMode" aria-label="启动行为" class="setting-control">
        <option value="new">新建文件</option>
        <option value="restore-folder">恢复上次文件夹</option>
        <option value="restore-both">恢复上次文件与文件夹</option>
        <option value="custom-folder">自定义文件夹</option>
      </select>
    </SettingRow>
    <SettingRow v-if="launchMode === 'custom-folder'" item-id="general.launch">
      <input
        v-model="launchCustomPath"
        type="text"
        aria-label="自定义启动目录"
        class="setting-control setting-control--text"
      />
      <button type="button" class="setting-button" @click="pickLaunchFolder">选择目录</button>
    </SettingRow>
    <SettingRow item-id="general.open-theme-folder">
      <button type="button" class="setting-button" @click="openThemeFolder">打开主题文件夹</button>
    </SettingRow>
    <SettingRow item-id="general.open-advanced-settings">
      <button type="button" class="setting-button" @click="store.openConfFile">打开高级设置</button>
    </SettingRow>
    <SettingRow item-id="general.language">
      <!-- 界面语言占位禁用（注册表 disabled 元数据驱动提示；首版跟随系统） -->
      <select aria-label="界面语言" class="setting-control" disabled>
        <option>跟随系统（多语言未开放）</option>
      </select>
    </SettingRow>
    <SettingRow item-id="general.reset-advanced-settings">
      <button type="button" class="setting-button" @click="onResetAdvanced">重置高级设置</button>
    </SettingRow>
    <!-- 高级键说明（只读文档性文本；值经 conf.user.json 手编，重启生效） -->
    <p class="settings-section__hint">
      高级键（conf.user.json，重启生效）：searchService 右键搜索服务列表 / flags Chromium 启动参数 /
      keyBinding 自定义快捷键。
    </p>

    <!-- Save & Recover 内部区（导航锚点定位目标，id 供 SettingsPanel scrollIntoView） -->
    <fieldset id="save-recover-anchor" class="settings-subsection">
      <h3>Save &amp; Recover</h3>
      <SettingRow item-id="save-recover.auto-save">
        <input v-model="autoSaveEnabled" type="checkbox" aria-label="自动保存" />
      </SettingRow>
      <SettingRow item-id="save-recover.auto-save-timer">
        <input
          v-model.number="autoSaveTimer"
          type="number"
          min="1"
          aria-label="保存间隔（分钟）"
          class="setting-control setting-control--number"
        />
      </SettingRow>
    </fieldset>
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
.settings-section h3 {
  font-size: 14px;
  margin: 0 0 4px;
}
.settings-subsection {
  border: 1px solid var(--crepe-color-background, #eee);
  border-radius: 6px;
  padding: 8px 12px;
  margin-top: 12px;
}
.settings-section__hint {
  font-size: 12px;
  color: var(--crepe-color-muted, #888);
}
.setting-control {
  max-width: 220px;
}
.setting-control--text {
  width: 260px;
}
.setting-control--number {
  width: 72px;
}
.setting-button {
  cursor: pointer;
}
</style>
