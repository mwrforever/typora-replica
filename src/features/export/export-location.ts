// 导出位置解析（09 X8：auto / 同目录 / 自定义）
//
// 纯函数 + 会话级「上次导出目录」记忆（模块级变量，不持久化——spec auto 语义
// 「未命名文档 = 上次导出目录」，自定策略见调研 §5 表项 6）。
/** 导出位置设置切片（settings.export 子集） */
export interface ExportLocationSettings {
  locationMode: "auto" | "document-dir" | "custom";
  customDir: string;
}

/** 位置解析上下文（文档目录 / 显式传入的历史目录） */
export interface ExportLocationContext {
  /** 当前文档目录（未命名文档 undefined） */
  documentDir?: string;
  /** 调用方显式传入的上次导出目录（优先于会话记忆；缺省用会话记忆） */
  lastExportDir?: string;
}

/** 会话级上次导出目录（成功落盘后由导出编排回写） */
let lastExportDir: string | undefined;

/**
 * 回写上次导出目录（导出成功路径调用；会话级）
 * @param dir 落盘目录；undefined 清除
 */
export function setLastExportDir(dir: string | undefined): void {
  lastExportDir = dir;
}

/** 测试面：读取会话记忆（生产代码禁用） */
export function getLastExportDirForTest(): string | undefined {
  return lastExportDir;
}

/**
 * 解析导出默认目录
 *
 * 语义：custom（已配置）> 文档目录 > 上次导出目录 > undefined。
 * custom 未配置回落 auto（不产生「配置了 custom 却无处可导」的死态）；
 * document-dir 与 auto 在文档目录上等价（差异仅语义命名，自定策略）。
 * @param loc 位置设置
 * @param ctx 解析上下文
 * @returns 默认目录；undefined = 无可定位目录（对话框用系统默认）
 */
export function resolveDefaultExportDir(
  loc: ExportLocationSettings,
  ctx: ExportLocationContext,
): string | undefined {
  if (loc.locationMode === "custom" && loc.customDir !== "") return loc.customDir;
  if (ctx.documentDir !== undefined) return ctx.documentDir;
  return ctx.lastExportDir ?? lastExportDir;
}

/**
 * 解析导出默认完整路径（目录 + 文件名）
 * @param fileName 文件名（含扩展名）
 * @param loc 位置设置（缺省 auto）
 * @param ctx 上下文（缺省仅会话记忆）
 * @returns 默认路径；无目录时仅文件名
 */
export function resolveExportDefaultPath(
  fileName: string,
  loc: ExportLocationSettings = { locationMode: "auto", customDir: "" },
  ctx: ExportLocationContext = {},
): string {
  const dir = resolveDefaultExportDir(loc, ctx);
  return dir === undefined ? fileName : `${dir}/${fileName}`;
}
