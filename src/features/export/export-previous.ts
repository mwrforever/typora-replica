// 重复导出会话级记忆（09 X6）——登记/读取面 + 复用/覆盖两命令（导出菜单经
// export-commands 的 runExport 单一入口分派到本模块）。
//
// 记忆范围 = 当前窗口 + 当前文档（spec：会话级）；docKey = 激活标签 id（多标签
// 天然隔离）。纯前端内存不持久化。
import type {
  ExportFormatId,
  ExportHtmlOptions,
  ExportResult,
  PdfExportOptions,
} from "./export-types";
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

/**
 * 使用上一次设置导出（AC-X6-1）
 * @returns 导出结果；无快照回落正常 HTML 导出（Typora 未载明，自定策略：不弹错不打断）
 */
export async function exportWithPrevious(): Promise<ExportResult | undefined> {
  const snapshot = getPreviousSnapshot();
  if (snapshot === undefined) {
    // 动态 import 断循环依赖（html-export → 本模块登记 → 命令 → html-export）
    const { exportHtml } = await import("./html-export");
    return exportHtml();
  }
  return rerunSnapshot(snapshot);
}

/**
 * 导出并覆盖上次的导出文件（AC-X6-2）
 * @returns 导出结果；无快照 / 用户取消覆盖警告返回 undefined
 */
export async function exportOverwriteWithPrevious(): Promise<ExportResult | undefined> {
  const snapshot = getPreviousSnapshot();
  if (snapshot === undefined) return undefined;
  // 覆盖警告（AC-X6-2；「Please be careful」语义的自定弹窗策略）
  const confirmed = window.confirm(
    `将覆盖上次的导出文件：\n${snapshot.destinationPath}\n\n请谨慎操作。`,
  );
  if (!confirmed) return undefined;
  return rerunSnapshot(snapshot);
}

/** 按快照格式重新执行导出（三分派保真：pdf/html-plain/html 各走原管线；目标路径锁定快照路径；选项原样复用） */
async function rerunSnapshot(snapshot: ExportSnapshot): Promise<ExportResult | undefined> {
  if (snapshot.format === "pdf") {
    const { exportPdf } = await import("./pdf-export");
    return exportPdf({
      ...(snapshot.options as PdfExportOptions),
      destinationPath: snapshot.destinationPath,
    });
  }
  if (snapshot.format === "html-plain") {
    // plain 快照必须回落无样式管线，否则 styled HTML 覆盖 plain 文件破坏格式保真（批5 R1）
    const { exportPlainHtml } = await import("./html-export");
    return exportPlainHtml({
      ...(snapshot.options as ExportHtmlOptions),
      destinationPath: snapshot.destinationPath,
    });
  }
  const { exportHtml } = await import("./html-export");
  return exportHtml({
    ...(snapshot.options as ExportHtmlOptions),
    destinationPath: snapshot.destinationPath,
  });
}
