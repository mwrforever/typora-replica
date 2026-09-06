// 重复导出会话级记忆（09 X6）——登记/读取面；X6 复用/覆盖两命令在 export-commands
// （批 5 交付，因命令需动态 import 批 4 的 pdf-export）。
//
// 记忆范围 = 当前窗口 + 当前文档（spec：会话级）；docKey = 激活标签 id（多标签
// 天然隔离）。纯前端内存不持久化。
import type { ExportFormatId, ExportHtmlOptions, PdfExportOptions } from "./export-types";
import { useTabsStore } from "../tabs/tabs-store";

/** 导出快照（复导出所需上下文；options 类型全链统一） */
export interface ExportSnapshot {
  format: ExportFormatId;
  /** 上次成功落盘路径（overwrite 目标） */
  destinationPath: string;
  /** 上次导出选项（html/plain → ExportHtmlOptions；pdf → PdfExportOptions） */
  options: ExportHtmlOptions | PdfExportOptions;
  savedAt: number;
}

/** docKey → 快照（模块级 Map，会话级生命周期） */
const snapshots = new Map<string, ExportSnapshot>();

/** 当前导出文档键 = 激活标签 id（无激活标签固定键，快照互不串扰） */
function currentDocKey(): string {
  return useTabsStore().activeTabId ?? "no-active-tab";
}

/**
 * 登记成功导出快照（exportHtml/exportPlainHtml/exportPdf 成功路径调用）
 * @param format 格式 id
 * @param destinationPath 落盘路径
 * @param options 导出选项原样存档
 */
export function recordExportSnapshot(
  format: ExportFormatId,
  destinationPath: string,
  options: ExportHtmlOptions | PdfExportOptions,
): void {
  snapshots.set(currentDocKey(), { format, destinationPath, options, savedAt: Date.now() });
}

/** 读取当前文档快照（无则 undefined） */
export function getPreviousSnapshot(): ExportSnapshot | undefined {
  return snapshots.get(currentDocKey());
}

/** 测试专用：清空会话记忆（模块级单例用例间隔离） */
export function resetExportPreviousForTest(): void {
  snapshots.clear();
}
