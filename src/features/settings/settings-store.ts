// 设置快照 store（10；spec §3「设置快照是各模块读取设置值的唯一入口」）
//
// 双层装载：面板 GUI（tauri-plugin-store 经 services/settings）+ 高级键（conf.user.json 经
// services/advanced-settings）。合并语义（自定设计，披露 4）：
//   1. merged = GUI 值为基，conf.user.json 的 autoSaveTimer 覆盖 autoSave.timerMinutes——
//      面板改动经 updateAutoSaveTimer write-through 双写两文件保持一致，手改 conf 重启后
//      以文件为准（对齐官方「高级配置重启生效」口径）；
//   2. 高级读取失败不阻断（回退默认值 + advancedError 提示条），对齐 AC-C1-4 不崩溃精神。
// 失效广播：updateGui/resetAdvanced 后 dispatch SETTINGS_INVALIDATED_EVENT（07 图片快照
// 监听刷新——对接契约，T1 已迁入 services 层，image/register 监听行为零变化）。
// 注：主契约中的 menuShortcutEntries（12 菜单展示数据）标注「Task 11 追加」——其依赖的
// shortcut-binding.ts 为 Task 10 交付物，本任务不含，届时原位追加（返回面只增不改）。
import { computed, ref } from "vue";
import { defineStore } from "pinia";
import {
  DEFAULT_SETTINGS,
  SETTINGS_INVALIDATED_EVENT,
  loadSettings,
  updateSettings,
} from "../../services/settings";
import type { AppSettings } from "../../services/settings";
import {
  DEFAULT_ADVANCED_SETTINGS,
  openAdvancedSettings,
  readAdvancedSettings,
  resetAdvancedSettings,
  writeAdvancedSetting,
} from "../../services/advanced-settings";
import type { AdvancedSettings } from "../../services/advanced-settings";

/** updateSettings 的 patch 形状透传（避免重复建模 A.7.3 职责隔离） */
export type SettingsPatch = Parameters<typeof updateSettings>[0];

/** 设置快照 store（setup store 形态，state 全量 return——宪法 B.2.4） */
export const useSettingsStore = defineStore("settings", () => {
  // —— state ——
  /** 面板显隐（Ctrl+, / 12 菜单触发） */
  const visible = ref(false);
  /** 面板 GUI 设置快照（undefined = 尚未 load） */
  const gui = ref<AppSettings | undefined>(undefined);
  /** conf.user.json 高级设置快照（undefined = 尚未 load） */
  const advanced = ref<AdvancedSettings | undefined>(undefined);
  /** 高级读取失败的非致命错误消息（面板顶部提示条；undefined = 无错误） */
  const advancedError = ref<string | undefined>(undefined);

  // —— getters ——
  /** 合并快照（唯一读取入口；未装载窗口期回落 DEFAULT_SETTINGS） */
  const merged = computed<AppSettings>(() => {
    if (gui.value === undefined) return DEFAULT_SETTINGS;
    if (advanced.value === undefined) return gui.value;
    return {
      ...gui.value,
      // autoSaveTimer 高级覆盖：面板改动 write-through 后两处一致，手改 conf 重启后以此为准
      autoSave: { ...gui.value.autoSave, timerMinutes: advanced.value.autoSaveTimer },
    };
  });

  // —— actions ——
  /** 双层装载（启动链路与面板打开共用；幂等语义由调用方保证） */
  async function load(): Promise<void> {
    gui.value = await loadSettings();
    try {
      advanced.value = await readAdvancedSettings();
      advancedError.value = undefined;
    } catch (error: unknown) {
      // 读取失败回退默认高级值（非法 JSON 等场景不崩面板，错误提示条呈现）
      advanced.value = DEFAULT_ADVANCED_SETTINGS;
      advancedError.value = error instanceof Error ? error.message : "读取高级设置失败";
      console.warn("[MarkWell] conf.user.json 读取失败，已回退默认高级设置:", advancedError.value);
    }
  }

  /**
   * 更新面板 GUI 设置（深合并写回 store 插件 + 刷新快照 + 广播失效事件）
   * @param patch 增量补丁（组内 Partial，同 updateSettings 契约）
   * @returns 写回后的完整设置
   */
  async function updateGui(patch: SettingsPatch): Promise<AppSettings> {
    const next = await updateSettings(patch);
    gui.value = next;
    // 广播失效事件（07 图片设置快照等监听方即时刷新——AC-S1-3 即时生效通道）
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event(SETTINGS_INVALIDATED_EVENT));
    }
    return next;
  }

  /**
   * 自动保存间隔 write-through 双写（12.7 autoSaveTimer 双层键的一致性收口）
   * 先写 conf.user.json（失败即中断，面板值不写——双层一致性优先），再写面板 store；
   * conf 写入成功后同步 advanced 内存快照——merged 以 advanced.autoSaveTimer 覆盖面板值，
   * 不同步会让合并快照仍呈现旧间隔（唯一读取入口失真）。
   * @param minutes 间隔分钟数（面板输入约束 ≥1）
   */
  async function updateAutoSaveTimer(minutes: number): Promise<void> {
    await writeAdvancedSetting("autoSaveTimer", minutes);
    if (advanced.value !== undefined) {
      advanced.value = { ...advanced.value, autoSaveTimer: minutes };
    }
    await updateGui({
      autoSave: { enabled: merged.value.autoSave.enabled, timerMinutes: minutes },
    });
  }

  /** 重置高级设置（AC-S2-3）：conf.user.json 覆写默认模板 + 快照回默认 + 广播失效 */
  async function resetAdvanced(): Promise<void> {
    await resetAdvancedSettings();
    advanced.value = DEFAULT_ADVANCED_SETTINGS;
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event(SETTINGS_INVALIDATED_EVENT));
    }
  }

  /** 打开 conf.user.json（系统默认应用；12.6 Open Advanced Settings 入口） */
  async function openConfFile(): Promise<void> {
    await openAdvancedSettings();
  }

  /** 打开面板（未装载则触发装载——首次打开读盘，此后复用快照） */
  function open(): void {
    visible.value = true;
    if (gui.value === undefined) void load();
  }

  /** 关闭面板 */
  function close(): void {
    visible.value = false;
  }

  /** 开合切换（Ctrl+, 消费） */
  function togglePanel(): void {
    if (visible.value) close();
    else open();
  }

  return {
    visible,
    gui,
    advanced,
    advancedError,
    merged,
    load,
    updateGui,
    updateAutoSaveTimer,
    resetAdvanced,
    openConfFile,
    open,
    close,
    togglePanel,
  };
});
