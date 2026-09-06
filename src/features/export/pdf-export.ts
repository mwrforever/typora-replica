// pdf-export.ts
// PDF 导出编排（09 X2 前端侧）
//
// 职责分界（spec §5）：HTML 管线（含 @page 页眉页脚 CSS 组装）在前端
// （buildExportDocumentForPdf）；打印管线在 Rust（export_pdf：隐藏 WebView2 +
// PrintToPdfStream 落盘）。PDF 字节不经 IPC 回传（宪法 A.3.5）——Rust 直接落盘。
// 错误契约：Rust ExportPdfError 自定义 Serialize 输出中文消息字符串，前端 catch
// string 形态包装 ExportError（AC-X2-5：失败呈现不崩溃）。
import { invoke } from "@tauri-apps/api/core";
import { buildExportDocumentForPdf } from "./html-export";
import { A4_SIZE_IN } from "./css-inline";
import { exportSaveDialog } from "./export-dialog";
import { resolveExportDefaultPath, setLastExportDir } from "./export-location";
import { recordExportSnapshot } from "./export-previous";
import { ExportError } from "./export-types";
import type { ExportResult, PdfExportOptions, PdfPrintSettingsDto } from "./export-types";

/**
 * 导出 PDF
 * @param options 导出选项（缺省值由调用方合并 store 后传入）
 * @returns 导出结果；用户取消对话框返回 undefined
 * @throws ExportError 编辑器未就绪 / 打印管线失败（AC-X2-5 向上传播，不静默崩溃）
 */
export async function exportPdf(options: PdfExportOptions = {}): Promise<ExportResult | undefined> {
  // @page CSS 由管线在 title 解析后组装（模板进、产物出）
  const { document: html, title } = await buildExportDocumentForPdf(options);
  const target = options.destinationPath ?? (await askPdfTarget(title));
  if (target === undefined) return undefined;
  // A4 + 打印背景（暗色跟随的载体，AC-X2-4；页眉页脚走 CSS 不走 Rust 模板）
  const settings: PdfPrintSettingsDto = {
    printBackground: true,
    pageWidthIn: A4_SIZE_IN.widthIn,
    pageHeightIn: A4_SIZE_IN.heightIn,
  };
  try {
    await invoke<void>("export_pdf", { htmlContent: html, settings, outputPath: target });
  } catch (error) {
    // Rust 错误契约为中文字符串；Error 对象（环境层异常）与其余形态兜底归一
    const message =
      typeof error === "string" ? error : error instanceof Error ? error.message : "未知打印错误";
    throw new ExportError(`PDF 导出失败：${message}`);
  }
  // 成功落盘即回写会话上次导出目录（X8 auto 对未命名文档的回落链，与 HTML 导出同规）
  setLastExportDir(dirnameOf(target));
  // X6：成功落盘后登记会话快照（复导出/覆盖入口消费）
  recordExportSnapshot("pdf", target, options);
  return { path: target, format: "pdf" };
}

/** PDF 另存对话框（title 供文件名基；位置设置读导出 store，与 html 管线同规） */
async function askPdfTarget(title: string): Promise<string | undefined> {
  // 动态 import 延迟模块加载：仅真正解析导出目标时才加载 tabs/export store 的
  // 编排链依赖，避免导出功能未触发时就在模块启动路径引入这部分加载成本
  const { useTabsStore } = await import("../tabs/tabs-store");
  const { useExportStore } = await import("./export-store");
  const active = useTabsStore().activeTab;
  const exportStore = useExportStore();
  const base = toFileName(title);
  const defaultPath = resolveExportDefaultPath(
    `${base}.pdf`,
    { locationMode: exportStore.locationMode, customDir: exportStore.customDir },
    { documentDir: active?.path !== undefined ? dirnameOf(active.path) : undefined },
  );
  const picked = await exportSaveDialog({ defaultPath, filterName: "PDF", ext: "pdf" });
  return picked ?? undefined;
}

/**
 * 标题转文件名基（Windows 非法字符替换为下划线；与 html-export 同构不互引避免耦合）
 * @param title 文档标题
 * @returns 可用文件名；全为非法字符/空白时回落 Untitled
 */
function toFileName(title: string): string {
  return title.replace(/[\\/:*?"<>|]/g, "_").trim() || "Untitled";
}

/**
 * 取路径父目录（兼容 / 与 \ 分隔符，取更靠右者）
 * @param path 完整路径
 * @returns 父目录；纯文件名（无分隔符）返回 undefined
 */
function dirnameOf(path: string): string | undefined {
  const idx = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return idx === -1 ? undefined : path.slice(0, idx);
}
