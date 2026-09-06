// 主题域 IPC 收敛（08 spec §5 提供面；宪法 B.4.1 invoke 收敛服务层）
//
// 契约对齐 Rust io/themes.rs：DTO camelCase（serde rename_all），错误为 Rust 中文
// String → ThemeIoError。不复用 file-io 的 FileIoError——职责隔离（A.7.3），
// 错误类型按域各自建模。请求/响应分离：list_themes 无参（无请求建模），
// watch_themes 经 Channel 批量接收（与 file-io.watchDir 同形态、独立 interface）。
import { Channel, invoke } from "@tauri-apps/api/core";

/** 主题元数据（list_themes 行） */
export interface ThemeMeta {
  /** 主题名（文件名词干，settings 持久化键） */
  name: string;
  /** 文件名（含 .css） */
  fileName: string;
  /** 菜单标签（连字符分词首字母大写） */
  label: string;
  /** {theme}.user.css 是否存在 */
  hasUserCss: boolean;
}

/** list_themes 响应 */
export interface ThemeListResult {
  /** 主题目录绝对路径（convertFileSrc 基准） */
  dir: string;
  /** 合法主题列表（升序） */
  themes: ThemeMeta[];
  /** base.user.css 是否存在 */
  hasBaseUserCss: boolean;
}

/** watch_themes 事件（Rust 100ms 合并窗口批量投递） */
export interface ThemeFsEvent {
  /** create / remove / modify / other */
  kind: string;
  /** 变更条目完整路径 */
  path: string;
}

/** 主题服务错误（invoke 拒绝的规范化包装，message 为 Rust 侧中文错误） */
export class ThemeIoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ThemeIoError";
  }
}

/**
 * invoke 包装：Rust 侧 String 错误 → ThemeIoError（与 file-io 同形态、独立域）
 * @param command 已注册的 Tauri command 名
 * @param args 透传参数（camelCase 键）
 */
async function invokeOrThrow<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await (args === undefined ? invoke<T>(command) : invoke<T>(command, args));
  } catch (error) {
    const message =
      typeof error === "string"
        ? error
        : error instanceof Error
          ? error.message
          : "未知主题服务错误";
    throw new ThemeIoError(message);
  }
}

/** 扫描主题列表（Themes 菜单数据源；目录缺失自动创建） */
export function listThemes(): Promise<ThemeListResult> {
  return invokeOrThrow<ThemeListResult>("list_themes");
}

// TODO(theme-ui): openThemeFolder 由 10 设置页 Appearance 分区 / 12 菜单装配消费，计划于 10/12 模块接入
/** 资源管理器打开主题目录（AC-T2-1） */
export function openThemeFolder(): Promise<void> {
  return invokeOrThrow<void>("open_theme_folder");
}

/**
 * 订阅主题目录变更（热刷新事件流；Rust 侧 100ms 合并批量）
 * @param onEvents 批量事件回调（订阅随应用生命周期存活）
 */
export function watchThemes(onEvents: (events: ThemeFsEvent[]) => void): Promise<void> {
  const channel = new Channel<ThemeFsEvent[]>();
  channel.onmessage = onEvents;
  return invokeOrThrow<void>("watch_themes", { channel });
}

/**
 * 切换 DevTools 开合（AC-T7-1）
 * @returns 切换后状态：true=已打开，false=已关闭（或当前构建不支持）
 */
export function toggleDevtools(): Promise<boolean> {
  return invokeOrThrow<boolean>("toggle_devtools");
}

/** 把主题目录加入 asset 协议可读范围（复用 07 allow_asset_directory，递归含 fonts/） */
export function allowThemeAssetDirectory(dir: string): Promise<void> {
  return invokeOrThrow<void>("allow_asset_directory", { dir });
}
