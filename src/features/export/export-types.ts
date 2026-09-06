// 导出域共享类型与常量（09）
/** 主题元数据最小面（消费 08 公开接口；避免直接 import theme-io 造成类型耦合） */
export interface ExportThemeRef {
  name: string;
  fileName: string;
  hasUserCss: boolean;
}

/** 导出格式 id（image/pandoc 为 X4/X5 占位，首版禁用） */
export type ExportFormatId = "pdf" | "html" | "html-plain" | "image" | "pandoc";

/** 导出执行结果 */
export interface ExportResult {
  /** 落盘完整路径 */
  path: string;
  /** 导出格式 */
  format: ExportFormatId;
}

/** 导出失败（统一错误类型；message 中文面向用户） */
export class ExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExportError";
  }
}

/** HTML 导出选项（A.7 参数对象化；全部可选——缺省值由调用方装配层合并 store 后传入） */
export interface ExportHtmlOptions {
  /** Include Outline（body 前置大纲） */
  includeOutline?: boolean;
  /** 主题覆盖（另选主题）；缺省 = 当前激活主题 */
  themeOverride?: ExportThemeRef;
  /** 输出文件名基（去扩展名）；缺省 = 文档 title */
  fileNameBase?: string;
  /** 直接落盘路径（X6 overwrite 复导出）；缺省 = 另存对话框 */
  destinationPath?: string;
}

/** PDF 导出选项（页眉页脚/h1 分页；缺省值同上由调用方合并） */
export interface PdfExportOptions extends ExportHtmlOptions {
  /** 页眉模板（${title}/${pageNo}/${pageCount}） */
  header?: string;
  /** 页脚模板 */
  footer?: string;
  /** h1 分页开关 */
  breakH1?: boolean;
}

/** PDF 打印设置 IPC DTO（与 Rust PdfPrintSettingsDto 序列化形状 1:1，camelCase） */
export interface PdfPrintSettingsDto {
  /** 打印背景（暗色主题跟随的载体，AC-X2-4） */
  printBackground: boolean;
  /** 纸宽（英寸） */
  pageWidthIn: number;
  /** 纸高（英寸） */
  pageHeightIn: number;
}
