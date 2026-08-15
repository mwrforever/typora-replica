// 行尾转换器（02 文档管理收口）
//
// 落盘统一口径（01 终审裁决）：editorManager.getMarkdown() 已剥全部尾随换行，
// 保存链路经 toDiskContent 补回单个尾换行再按 Default Line Ending 归一——
// 硬换行结尾文档（`text  \n`）结构完整往返；全文级转换同时覆盖单行 CRLF FM
// 定界符盲区（reinsertFrontMatter 的 eol 检测对单行内文恒退化 LF）。
import type { LineEnding } from "./file-io";

/**
 * 全文级行尾归一（CRLF ↔ LF）
 * @param text 任意行尾的文本（可含 FM 区）
 * @param target 目标行尾
 * @returns 转换后文本（末尾无换行保持无换行）
 */
export function normalizeLineEnding(text: string, target: LineEnding): string {
  const lfNormalized = text.replace(/\r\n/g, "\n");
  return target === "crlf" ? lfNormalized.replace(/\n/g, "\r\n") : lfNormalized;
}

/**
 * 补回单个尾换行（非空且末尾无 \n 时）
 * @param text 编辑器序列化产物（已剥全部尾随换行）
 * @returns 落盘前文本（空串保持空串）
 */
export function ensureTrailingNewline(text: string): string {
  if (text === "" || text.endsWith("\n")) return text;
  return `${text}\n`;
}

/**
 * 落盘内容组合（保存链路唯一出口）：补尾换行 → 目标行尾归一
 * @param body 编辑器序列化产物（getMarkdown 结果）
 * @param target 偏好 defaultLineEnding
 * @returns 写盘内容
 */
export function toDiskContent(body: string, target: LineEnding): string {
  return normalizeLineEnding(ensureTrailingNewline(body), target);
}
