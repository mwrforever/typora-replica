// 文件 IO 桥（02 文档管理）
//
// 全部文件读写走 Rust command（方案 C，绕开 fs 插件静态 scope）：
// 前端仅透传参数与规范化错误。invoke 失败统一包装为 FileIoError（中文消息）。
// 命令名以 src-tauri 注册名为准：草稿三命令在 Rust 侧 #[tauri::command] 函数名带
// _cmd 后缀（save_draft_cmd/list_drafts_cmd/recover_draft_cmd），invoke 名即函数名；
// get_cli_args 由 Task 13 注册，本封装先行就位。
import { invoke } from "@tauri-apps/api/core";

/** 源文本编码（readFile 探测结果；保存一律 UTF-8 无 BOM） */
export type TextEncoding = "utf8" | "utf8-bom" | "gbk";
/** 行尾形态（读探测 / 写目标） */
export type LineEnding = "lf" | "crlf";

/** 读文件结果 */
export interface ReadFileResult {
  /** 解码后的内容（GBK 已转 UTF-8） */
  content: string;
  /** 源编码 */
  encoding: TextEncoding;
  /** 源行尾 */
  lineEnding: LineEnding;
}

/** 目录条目（listDir 结果） */
export interface DirEntry {
  /** 完整路径 */
  path: string;
  /** 相对根路径（/ 分隔） */
  name: string;
  /** 是否目录 */
  isDir: boolean;
  /** 扩展名（不含点） */
  ext: string;
}

/** 草稿条目 */
export interface DraftEntry {
  /** 草稿完整路径 */
  path: string;
  /** 文件名（含 .md） */
  name: string;
  /** 日期前缀 YYYY-MM-DD */
  date: string;
}

/** 启动命令行参数 */
export interface CliArgs {
  /** --new 已传入（覆盖启动设置） */
  new: boolean;
  /** --reopen-file 目标路径 */
  reopenFile?: string;
}

/** 文件 IO 错误（invoke 拒绝的规范化包装，message 为 Rust 侧中文错误） */
export class FileIoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FileIoError";
  }
}

/**
 * invoke 包装：Rust 侧 String 错误 → FileIoError
 * @param command 已注册的 Tauri command 名
 * @param args 透传参数（camelCase 键，Rust 侧自动映射 snake_case）
 * @returns 命令返回值的 Promise；invoke 拒绝时抛 FileIoError（消息取字符串原值 /
 *          Error.message / 通用中文兜底）
 */
async function invokeOrThrow<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    // 无参命令不传 args（避免 invoke 收到显式 undefined 第二参，mock 断言与真实调用均以单参为准）
    return await (args === undefined ? invoke<T>(command) : invoke<T>(command, args));
  } catch (e) {
    const message = typeof e === "string" ? e : e instanceof Error ? e.message : "未知文件 IO 错误";
    throw new FileIoError(message);
  }
}

/** 读文件（编码探测 + 行尾探测） */
export function readFile(path: string): Promise<ReadFileResult> {
  return invokeOrThrow<ReadFileResult>("read_file", { path });
}

/** 写文件（行尾归一 + 原子写；落盘 UTF-8 无 BOM） */
export function writeFile(path: string, content: string, lineEnding: LineEnding): Promise<void> {
  return invokeOrThrow<void>("write_file", { path, content, opts: { lineEnding } });
}

/** 目录遍历（扩展名过滤 + 自然序；无过滤传 null 对应 Rust Option） */
export function listDir(path: string, extFilter?: string): Promise<DirEntry[]> {
  return invokeOrThrow<DirEntry[]>("list_dir", { path, extFilter: extFilter ?? null });
}

/** 保存草稿（返回实际保存路径） */
export function saveDraft(fileName: string, content: string): Promise<string> {
  return invokeOrThrow<string>("save_draft_cmd", { fileName, content });
}

/** 列出草稿（日期倒序） */
export function listDrafts(): Promise<DraftEntry[]> {
  return invokeOrThrow<DraftEntry[]>("list_drafts_cmd");
}

/** 恢复草稿（读后删除，返回解码结果） */
export function recoverDraft(fileName: string): Promise<ReadFileResult> {
  return invokeOrThrow<ReadFileResult>("recover_draft_cmd", { fileName });
}

/** 读取启动命令行参数 */
export function getCliArgs(): Promise<CliArgs> {
  return invokeOrThrow<CliArgs>("get_cli_args");
}
