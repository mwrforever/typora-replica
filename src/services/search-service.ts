// 全局搜索命令桥（06）：Channel 流式事件 + 取消
//
// wire 契约（spec §5.3①）：search_in_folder(root, query, opts{caseSensitive,
// wholeWord, regexp, maxResults}, channel) → Rust 按 100ms 合并窗口批量投递
// SearchStreamEvent[]，结束以 done 事件收口；cancel_search 幂等。
import { Channel, invoke } from "@tauri-apps/api/core";
import { FileIoError } from "./file-io";

/** 全局结果上限（AC-F26-3；前后端各持一份同值常量） */
export const GLOBAL_MAX_RESULTS = 50;

/** 三开关选项（前端 store 快照透传） */
export interface GlobalSearchOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
  regexp: boolean;
}

/** 单条匹配行（1 起行号 + 整行文本） */
export interface GlobalSearchMatch {
  lineNumber: number;
  lineText: string;
  /** 该行首个命中的文件内全局序号（0 起；跨文件点击定位按序取位，序号对齐裁决 2026-08-24） */
  firstMatchIndex: number;
}

/** 流式事件（serde tagged enum 对应形态，camelCase） */
export type SearchStreamEvent =
  | {
      type: "result";
      filePath: string;
      fileName: string;
      encoding: string | null;
      matches: GlobalSearchMatch[];
    }
  | { type: "done"; truncated: boolean }
  | { type: "error"; path: string; message: string };

/** invoke 拒绝 → FileIoError 规范化（与 file-io.invokeOrThrow 同口径） */
function toFileIoError(error: unknown): FileIoError {
  const message =
    typeof error === "string" ? error : error instanceof Error ? error.message : "未知全局搜索错误";
  return new FileIoError(message);
}

/**
 * 发起跨文件搜索
 * @param root 扫描根目录（当前工作区目录）
 * @param query 查找词（正则模式原文）
 * @param opts 三开关 + maxResults 固定 50
 * @param onBatch Channel 批量回调（100ms 合并窗口批量到达）
 * @returns invoke 完成（仅代表扫描已受理；结束以 done 事件为准）
 */
export function startGlobalSearch(
  root: string,
  query: string,
  opts: GlobalSearchOptions,
  onBatch: (events: SearchStreamEvent[]) => void,
): Promise<void> {
  const channel = new Channel<SearchStreamEvent[]>();
  channel.onmessage = onBatch;
  return invoke<void>("search_in_folder", {
    root,
    query,
    opts: { ...opts, maxResults: GLOBAL_MAX_RESULTS },
    channel,
  }).catch((error: unknown) => {
    throw toFileIoError(error);
  });
}

/** 取消当前搜索（幂等：无任务亦成功） */
export function cancelGlobalSearch(): Promise<void> {
  return invoke<void>("cancel_search").catch((error: unknown) => {
    throw toFileIoError(error);
  });
}
