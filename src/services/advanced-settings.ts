// conf.user.json 高级设置 IPC 封装（10 S2；B.4.1 IPC 网关——invoke 收敛 services 层）
//
// wire 契约（前端定稿，Rust advanced_settings.rs / Task 8 按此实现，两侧对齐点如下）：
//   命令名（Tauri command 全局唯一、snake_case）：
//     read_advanced_settings()            -> AdvancedSettingsDto（camelCase serde 序列化形状）
//     write_advanced_settings({key,value})-> ()（参数为 camelCase 键的 JSON 对象，A.3.2）
//     reset_advanced_settings()           -> ()
//     open_advanced_settings()            -> ()（12.6 Open Advanced Settings 入口，见计划披露 2）
//   键白名单：前端 ADVANCED_SETTING_KEYS 与 Rust ADVANCED_KEYS 同源七键清单（写入口双重收窄）。
//   错误契约：Rust AdvancedSettingsError 自定义 Serialize 输出中文消息字符串（A.3.3 枚举化，
//   pdf-export 同构），本层 catch string 包装为 AdvancedSettingsError 上抛。
//   同步形态：conf.user.json 为 KB 级小文件，四命令均为同步 command（A.3.4，与 read_file 同口径）。
import { invoke } from "@tauri-apps/api/core";

/** defaultFontFamily 子键结构（调研 §6 自定简洁键结构；缺省键 = 不覆盖该字体族） */
export interface DefaultFontFamilySettings {
  /** 无衬线族覆盖 */
  sansSerif?: string;
  /** 衬线族覆盖 */
  serif?: string;
}

/** conf.user.json 高级设置（与 Rust AdvancedSettingsDto 序列化形状 1:1，camelCase） */
export interface AdvancedSettings {
  /** 默认字体族覆盖 */
  defaultFontFamily: DefaultFontFamilySettings;
  /** true 才启用菜单栏自动隐藏（官方笔误，用户实测裁决） */
  autoHideMenuBar: boolean;
  /** 右键第三方搜索服务列表（用户手编自由结构——A.7.5 业务豁免：键面为用户直接编辑的
   * conf 文件，无固定 schema 可建模，透传 unknown 由消费方自行收窄） */
  searchService: unknown;
  /** true = 表情符号渲染为单色（默认 false 彩色，官方载明） */
  monocolorEmoji: boolean;
  /** Chromium 启动 flags（自由结构，豁免理由同上） */
  flags: unknown;
  /** 自动保存间隔（分钟，Double；与面板 autoSave.timerMinutes write-through 双写） */
  autoSaveTimer: number;
  /** 自定义快捷键：键=菜单命令名、值=组合串（重启生效） */
  keyBinding: Record<string, string>;
}

/** 高级设置合法键白名单（12.7 七键；与 Rust ADVANCED_KEYS 同源清单，写入口收窄防任意键注入） */
export const ADVANCED_SETTING_KEYS = [
  "defaultFontFamily",
  "autoHideMenuBar",
  "searchService",
  "monocolorEmoji",
  "flags",
  "autoSaveTimer",
  "keyBinding",
] as const;

/** 高级设置键 */
export type AdvancedSettingKey = (typeof ADVANCED_SETTING_KEYS)[number];

/** 可写入值类型（布尔开关 / 数值 / 对象结构 / 列表结构；具体形态由 Rust validate_value 校验） */
export type AdvancedSettingValue = boolean | number | Record<string, unknown> | unknown[];

/** 默认高级设置（与 Rust DEFAULT_CONF_TEMPLATE 模板逐键一致；读取失败时的合并快照回退基准） */
export const DEFAULT_ADVANCED_SETTINGS: AdvancedSettings = {
  defaultFontFamily: {},
  autoHideMenuBar: false,
  searchService: [],
  monocolorEmoji: false,
  flags: {},
  autoSaveTimer: 5,
  keyBinding: {},
};

/** 高级设置操作失败（message 为面向用户的中文描述，来自 Rust 错误契约或本层兜底） */
export class AdvancedSettingsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdvancedSettingsError";
  }
}

/** invoke 拒绝统一收口：string（Rust 错误契约）/ Error / 其余 → 可读中文 */
function wrapInvokeError(error: unknown, fallback: string): AdvancedSettingsError {
  if (typeof error === "string") return new AdvancedSettingsError(error);
  if (error instanceof Error) return new AdvancedSettingsError(error.message);
  return new AdvancedSettingsError(fallback);
}

/**
 * 读取高级设置（conf.user.json；文件缺失由 Rust 侧写入默认模板后返回）
 * @returns 高级设置快照
 * @throws AdvancedSettingsError 非法 JSON / 键值结构不合法（原文件未被改动）
 */
export async function readAdvancedSettings(): Promise<AdvancedSettings> {
  try {
    return await invoke<AdvancedSettings>("read_advanced_settings");
  } catch (error: unknown) {
    throw wrapInvokeError(error, "读取高级设置失败");
  }
}

/**
 * 写入单个高级键（行级合并写回：只替换目标行，用户注释与其余格式保留）
 * @param key 高级键（白名单外客户端直接拒绝，不发起 IPC）
 * @param value 键值（Rust 侧按键校验类型形态）
 * @throws AdvancedSettingsError 白名单外键 / 非法 JSON / 值类型不合法（原文件保留原样）
 */
export async function writeAdvancedSetting(
  key: AdvancedSettingKey,
  value: AdvancedSettingValue,
): Promise<void> {
  // 客户端键白名单先行收窄：白名单外键不发起 IPC，防任意键注入 conf 文件
  if (!ADVANCED_SETTING_KEYS.includes(key)) {
    throw new AdvancedSettingsError(`非法的高级设置键: ${key}（白名单七键之外拒绝写入）`);
  }
  try {
    await invoke<void>("write_advanced_settings", { key, value });
  } catch (error: unknown) {
    throw wrapInvokeError(error, "写入高级设置失败");
  }
}

/**
 * 重置高级设置（conf.user.json 覆写为默认模板，AC-S2-3）
 * @throws AdvancedSettingsError 落盘失败
 */
export async function resetAdvancedSettings(): Promise<void> {
  try {
    await invoke<void>("reset_advanced_settings");
  } catch (error: unknown) {
    throw wrapInvokeError(error, "重置高级设置失败");
  }
}

/**
 * 用系统默认应用打开 conf.user.json（12.6 Open Advanced Settings 入口；文件缺失先建默认模板）
 * @throws AdvancedSettingsError 打开失败
 */
export async function openAdvancedSettings(): Promise<void> {
  try {
    await invoke<void>("open_advanced_settings");
  } catch (error: unknown) {
    throw wrapInvokeError(error, "打开高级设置文件失败");
  }
}
