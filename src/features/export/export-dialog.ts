// 导出另存对话框封装（09；features 域内封装——features 直用 plugin-dialog 有先例
// insert-local-image.ts/delete-image.ts；B.4.1 禁令指向组件散落直呼 invoke，不涉此）
// 独立建模不并入 open-commands：filters/defaultPath 语义按导出格式各异（A.7.3 职责隔离）。
import { save } from "@tauri-apps/plugin-dialog";

/** 导出保存对话框选项 */
export interface ExportSaveDialogOptions {
  /** 对话框默认路径（含文件名；目录部分由 resolveExportDefaultPath 提供） */
  defaultPath: string;
  /** 过滤器显示名（如 "HTML"） */
  filterName: string;
  /** 扩展名（不含点，如 "html"） */
  ext: string;
}

/**
 * 导出另存对话框（取消返回 null，调用方静默终止导出）
 * @param options 见接口注
 * @returns 用户选定完整路径；取消 = null
 */
export async function exportSaveDialog(options: ExportSaveDialogOptions): Promise<string | null> {
  return save({
    title: "导出",
    defaultPath: options.defaultPath,
    filters: [{ name: options.filterName, extensions: [options.ext] }],
  });
}
