// 偏好设置（02 文档管理，store 插件持久化）
//
// 键值：autoSave（开关+定时分钟）、defaultLineEnding（落盘行尾）、
// launch（启动行为：模式/自定义路径/上次文件夹/上次文件）、
// outline（大纲视图：折叠开关）、
// image（图片插入：copy to folder 开关+目标目录+相对路径+./ 前缀+URL 转义）、
// theme（主题：亮/暗模式主题名）。
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

/** 大纲视图设置 */
export interface OutlineSettings {
  /** 大纲视图允许折叠和展开（默认 false = Flat，AC-F22-1） */
  collapsible: boolean;
}

/** 图片插入设置（07；四开关默认全关对齐 Typora 用户实测） */
export interface ImageSettings {
  /** copy to folder 总开关（关闭时粘贴图片不落盘，仅生成临时预览） */
  copyToFolderEnabled: boolean;
  /** 目标文件夹绝对路径（空串=未配置） */
  copyTargetDir: string;
  /** relative path 开关（存盘后插入相对引用而非绝对路径） */
  relativePathEnabled: boolean;
  /** ./ prefix 开关（相对引用前补 ./ 前缀） */
  dotSlashPrefixEnabled: boolean;
  /** URL 转义开关（路径含空格/特殊字符时按 JS escape() 语义转义，%XX/%uXXXX，非 RFC 3986 百分号编码） */
  urlEscapeEnabled: boolean;
}

/** 主题设置（08；明暗分离存储，mode → 主题名映射） */
export interface ThemeSettings {
  /** 亮色模式主题名（文件名词干；设置值失效时由主题层回落内置主题） */
  lightTheme: string;
  /** 暗色模式主题名 */
  darkTheme: string;
}

/** 应用偏好 */
export interface AppSettings {
  autoSave: AutoSaveSettings;
  /** 落盘行尾（默认 lf） */
  defaultLineEnding: LineEnding;
  launch: LaunchSettings;
  outline: OutlineSettings;
  /** 图片插入（07 模块消费） */
  image: ImageSettings;
  /** 主题（08 模块消费） */
  theme: ThemeSettings;
}

/** 默认偏好（缺失键回落基准） */
export const DEFAULT_SETTINGS: AppSettings = {
  autoSave: { enabled: true, timerMinutes: 5 },
  defaultLineEnding: "lf",
  launch: { mode: "restore-folder", customPath: "" },
  outline: { collapsible: false },
  image: {
    copyToFolderEnabled: false,
    copyTargetDir: "",
    relativePathEnabled: false,
    dotSlashPrefixEnabled: false,
    urlEscapeEnabled: false,
  },
  // 默认名与 Rust BUILT_IN_THEMES 预置文件同名，首启即可解析到主题
  theme: { lightTheme: "markwell-light", darkTheme: "markwell-dark" },
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
    outline: ((await store.get("outline")) ?? {}) as Partial<OutlineSettings>,
    image: ((await store.get("image")) ?? {}) as Partial<ImageSettings>,
    theme: ((await store.get("theme")) ?? {}) as Partial<ThemeSettings>,
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
    outline: {
      collapsible: stored.outline.collapsible ?? DEFAULT_SETTINGS.outline.collapsible,
    },
    image: {
      copyToFolderEnabled:
        stored.image.copyToFolderEnabled ?? DEFAULT_SETTINGS.image.copyToFolderEnabled,
      // 空串是合法存量值（=未配置），仅 undefined 回落默认
      copyTargetDir: stored.image.copyTargetDir ?? DEFAULT_SETTINGS.image.copyTargetDir,
      relativePathEnabled:
        stored.image.relativePathEnabled ?? DEFAULT_SETTINGS.image.relativePathEnabled,
      dotSlashPrefixEnabled:
        stored.image.dotSlashPrefixEnabled ?? DEFAULT_SETTINGS.image.dotSlashPrefixEnabled,
      urlEscapeEnabled: stored.image.urlEscapeEnabled ?? DEFAULT_SETTINGS.image.urlEscapeEnabled,
    },
    theme: {
      lightTheme: stored.theme.lightTheme ?? DEFAULT_SETTINGS.theme.lightTheme,
      darkTheme: stored.theme.darkTheme ?? DEFAULT_SETTINGS.theme.darkTheme,
    },
  };
}

/** 更新偏好（深合并后写回并返回新值；调用方拿返回值继续链路） */
export async function updateSettings(
  // launch/outline/image/theme 允许部分字段且均走纯 Partial（文档会话等调用方只传
  // lastFile/lastFolder、05 大纲只传 collapsible、07 图片粘贴只传 image 组内
  // 增量、08 主题切换只传 lightTheme/darkTheme 单键）——与 launch/outline 同一
  // 收口机制：排除在 Omit 外单独声明 Partial，避免「整组必填」误约束增量调用方
  patch: Partial<Omit<AppSettings, "launch" | "outline" | "image" | "theme">> & {
    launch?: Partial<LaunchSettings>;
    outline?: Partial<OutlineSettings>;
    image?: Partial<ImageSettings>;
    theme?: Partial<ThemeSettings>;
  },
): Promise<AppSettings> {
  const current = await loadSettings();
  const next: AppSettings = {
    autoSave: { ...current.autoSave, ...patch.autoSave },
    defaultLineEnding: patch.defaultLineEnding ?? current.defaultLineEnding,
    launch: { ...current.launch, ...patch.launch },
    outline: { ...current.outline, ...patch.outline },
    image: { ...current.image, ...patch.image },
    theme: { ...current.theme, ...patch.theme },
  };
  const store = await load(STORE_FILE, { autoSave: true });
  await store.set("autoSave", next.autoSave);
  await store.set("defaultLineEnding", next.defaultLineEnding);
  await store.set("launch", next.launch);
  await store.set("outline", next.outline);
  await store.set("image", next.image);
  await store.set("theme", next.theme);
  return next;
}
