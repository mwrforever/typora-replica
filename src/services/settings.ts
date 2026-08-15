// 偏好设置（02 文档管理，store 插件持久化）
//
// 键值：autoSave（开关+定时分钟）、defaultLineEnding（落盘行尾）、
// launch（启动行为：模式/自定义路径/上次文件夹/上次文件）。
// 自动保存默认开（差异化于 Typora 默认关——spec 待把关项按调研建议裁决，数据安全优先）。
import { load } from "@tauri-apps/plugin-store";
import type { LineEnding } from "./file-io";

/** 启动行为模式 */
export type LaunchMode = "new" | "restore-folder" | "restore-both" | "custom-folder";

/** 启动行为设置 */
export interface LaunchSettings {
  /** 启动模式：新建/恢复文件夹/恢复文件与文件夹/自定义文件夹 */
  mode: LaunchMode;
  /** 自定义文件夹路径（mode=custom-folder 时生效） */
  customPath: string;
  /** 上次打开的文件夹（restore-folder/restore-both 恢复目标） */
  lastFolder?: string;
  /** 上次打开的文件（restore-both 恢复目标） */
  lastFile?: string;
}

/** 自动保存设置 */
export interface AutoSaveSettings {
  /** 总开关（默认开） */
  enabled: boolean;
  /** 定时兜底分钟数（默认 5） */
  timerMinutes: number;
}

/** 应用偏好 */
export interface AppSettings {
  autoSave: AutoSaveSettings;
  /** 落盘行尾（默认 lf） */
  defaultLineEnding: LineEnding;
  launch: LaunchSettings;
}

/** 默认偏好（缺失键回落基准） */
export const DEFAULT_SETTINGS: AppSettings = {
  autoSave: { enabled: true, timerMinutes: 5 },
  defaultLineEnding: "lf",
  launch: { mode: "restore-folder", customPath: "" },
};

/** store 文件名（tauri-plugin-store 自动持久化到 app 数据目录） */
const STORE_FILE = "markwell-settings.json";

/** 读取偏好（缺失键逐层回落默认值） */
export async function loadSettings(): Promise<AppSettings> {
  const store = await load(STORE_FILE, { autoSave: true });
  const stored = {
    autoSave: ((await store.get("autoSave")) ?? {}) as Partial<AutoSaveSettings>,
    defaultLineEnding: (await store.get("defaultLineEnding")) as LineEnding | undefined,
    launch: ((await store.get("launch")) ?? {}) as Partial<LaunchSettings>,
  };
  return {
    autoSave: {
      enabled: stored.autoSave.enabled ?? DEFAULT_SETTINGS.autoSave.enabled,
      timerMinutes: stored.autoSave.timerMinutes ?? DEFAULT_SETTINGS.autoSave.timerMinutes,
    },
    defaultLineEnding: stored.defaultLineEnding ?? DEFAULT_SETTINGS.defaultLineEnding,
    launch: {
      mode: stored.launch.mode ?? DEFAULT_SETTINGS.launch.mode,
      customPath: stored.launch.customPath ?? DEFAULT_SETTINGS.launch.customPath,
      lastFolder: stored.launch.lastFolder,
      lastFile: stored.launch.lastFile,
    },
  };
}

/** 更新偏好（深合并后写回并返回新值；调用方拿返回值继续链路） */
export async function updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const current = await loadSettings();
  const next: AppSettings = {
    autoSave: { ...current.autoSave, ...patch.autoSave },
    defaultLineEnding: patch.defaultLineEnding ?? current.defaultLineEnding,
    launch: { ...current.launch, ...patch.launch },
  };
  const store = await load(STORE_FILE, { autoSave: true });
  await store.set("autoSave", next.autoSave);
  await store.set("defaultLineEnding", next.defaultLineEnding);
  await store.set("launch", next.launch);
  return next;
}
