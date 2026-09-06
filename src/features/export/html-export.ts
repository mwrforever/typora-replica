// HTML / HTML 无样式 / PDF 源文档导出编排（09 X1 / X3 / X2 前端源）
//
// 管线：编辑器 doc（副本）→ DOMSerializer 序列化 → 后处理（mermaid/latex/toc）→
// head 模板变量替换（仅 head，防 XSS 边界见 yaml-variables）→ CSS 内联 → 落盘。
// 序列化产物为独立 DOM 副本，全程不触碰编辑器 DOM（宪法 B.2.5）。
// 暗色接线（AC-X2-4）：html 根类 markwell-dark + CSS 暗色段，跟随当前系统色系。
// plain 语义（AC-X3-1）：无 <style>、无 mw-* 包裹类；锚点 id 保留（语义 HTML）。
import { DOMSerializer } from "@milkdown/kit/prose/model";
import katex from "katex";
// mhchem 副作用（化学式；与 create-editor.ts 同源一次，重复无害）
import "katex/contrib/mhchem";
import { editorManager } from "../editor/editor-manager";
import { getActiveFrontMatter } from "../tabs/editor-registry";
import { collectHeadings } from "../editor/heading-collect";
import { useOutlineStore } from "../outline/outline-store";
import { useThemeStore } from "../theme/theme-store";
import { useTabsStore } from "../tabs/tabs-store";
import { readFile, writeFile } from "../../services/file-io";
import { listThemes } from "../../services/theme-io";
import { extractYamlVariables, replaceHeadVariables } from "./yaml-variables";
import { buildOutlineHtml } from "./outline-html";
import { buildPdfPageCss, buildStyleBlock } from "./css-inline";
import { postProcessExportHtml } from "./html-postprocess";
import { renderMermaidToSvg } from "./mermaid-export";
import { exportSaveDialog } from "./export-dialog";
import { resolveExportDefaultPath } from "./export-location";
import { recordExportSnapshot } from "./export-previous";
import { ExportError } from "./export-types";
import type {
  ExportHtmlOptions,
  ExportResult,
  ExportThemeRef,
  PdfExportOptions,
} from "./export-types";

/** head 段模板（{{key}} 占位符经 replaceHeadVariables 转义替换） */
const HEAD_TEMPLATE =
  '<meta charset="UTF-8">\n<meta name="viewport" content="width=device-width, initial-scale=1.0">\n<meta name="generator" content="MarkWell">\n<title>{{title}}</title>\n<meta name="author" content="{{author}}">\n<meta name="description" content="{{description}}">';

/** 文档构建入参（内部；pdfPage 模板由 title 解析后组装） */
interface BuildArgs {
  plain: boolean;
  options: ExportHtmlOptions;
  /** PDF @page 模板（仅 PDF 管线传入；html/plain 为 undefined） */
  pdfPage?: { header?: string; footer?: string; breakH1: boolean };
}

/**
 * LaTeX 块级数学渲染（KaTeX displayMode + throwOnError:false 降级）
 * @param code LaTeX 源码
 * @returns KaTeX HTML（错误原样回显不抛异常）
 */
function renderMathBlockToHtml(code: string): string {
  return katex.renderToString(code, { displayMode: true, throwOnError: false });
}

/**
 * 导出 HTML（内嵌样式单文件）
 * @param options 导出选项（缺省值由调用方合并 store 后传入）
 * @returns 导出结果；用户取消对话框返回 undefined
 * @throws ExportError 编辑器未就绪 / 落盘失败
 */
export async function exportHtml(
  options: ExportHtmlOptions = {},
): Promise<ExportResult | undefined> {
  const built = await buildExportDocument({ plain: false, options });
  const target = await askExportTarget(built.title, "HTML", "html", options.destinationPath);
  if (target === undefined) return undefined;
  await writeFile(target, built.document, "lf");
  recordExportSnapshot("html", target, options);
  return { path: target, format: "html" };
}

/**
 * 导出 HTML 无样式（纯语义 HTML：无 <style>、无 mw-* 包裹类；锚点 id 保留）
 * @param options 同 exportHtml
 * @returns 同 exportHtml
 */
export async function exportPlainHtml(
  options: ExportHtmlOptions = {},
): Promise<ExportResult | undefined> {
  const built = await buildExportDocument({ plain: true, options });
  const target = await askExportTarget(built.title, "HTML", "html", options.destinationPath);
  if (target === undefined) return undefined;
  await writeFile(target, built.document, "lf");
  recordExportSnapshot("html-plain", target, options);
  return { path: target, format: "html-plain" };
}

/**
 * 构建 PDF 源文档（pdf-export 消费；@page CSS 在 title 解析后内部组装）
 * @param options PDF 导出选项
 * @returns 完整 HTML 与解析出的标题
 */
export async function buildExportDocumentForPdf(
  options: PdfExportOptions,
): Promise<{ document: string; title: string }> {
  return buildExportDocument({
    plain: false,
    options,
    pdfPage: { header: options.header, footer: options.footer, breakH1: options.breakH1 ?? false },
  });
}

/**
 * 构建导出文档（编排核心）
 *
 * 执行序：序列化副本 → 后处理 → 变量解析（title 优先级：FM > fileNameBase > Untitled）→
 * body/style 组装（plain 分流）→ 完整 HTML 拼装。序列化产物为独立 DOM 副本，
 * 编辑器 DOM 全程只读（宪法 B.2.5）。
 * @param args 见接口注
 * @returns 完整 HTML 与解析出的标题（落盘文件名基）
 * @throws ExportError 编辑器视图未就绪
 */
async function buildExportDocument(args: BuildArgs): Promise<{ document: string; title: string }> {
  const view = editorManager.getView();
  if (view === undefined) throw new ExportError("编辑器未就绪，无法导出");
  const doc = view.state.doc;
  const outlineHtml = buildOutlineHtml(collectHeadings(doc), useOutlineStore().collapsible);

  // 序列化到独立 DOM 副本：serializeFragment 产出全新 DOM 树，不触碰编辑器挂载节点
  const container = document.createElement("div");
  DOMSerializer.fromSchema(view.state.schema).serializeFragment(doc.content, {}, container);
  await postProcessExportHtml(container, {
    renderMermaid: renderMermaidToSvg,
    renderMathBlock: renderMathBlockToHtml,
    outlineHtml,
    plainMode: args.plain,
  });

  // title 优先级：YAML title（白名单提取）> 调用方显式文件名基 > Untitled
  const vars = extractYamlVariables(getActiveFrontMatter());
  const title = vars.title !== "" ? vars.title : (args.options.fileNameBase ?? "Untitled");
  // YAML title 缺省时以回落标题回填变量集：导出产物 <title> 与落盘文件名保持一致
  if (vars.title === "") vars.title = title;

  // Include Outline：body 最前置大纲导航（正文锚点跳转依赖标题 id 序列化保留）
  const outlineNav = args.options.includeOutline === true ? `${outlineHtml}\n` : "";
  const darkMode = document.documentElement.classList.contains("markwell-dark");
  let bodyHtml: string;
  let styleBlock: string;
  if (args.plain) {
    // plain：无包裹 div、无 style 块（AC-X3-1 纯语义 HTML）
    bodyHtml = outlineNav + container.innerHTML;
    styleBlock = "";
  } else {
    bodyHtml = outlineNav + `<div class="mw-export-body">\n${container.innerHTML}\n</div>`;
    const themeCss = await collectThemeCss(args.options.themeOverride);
    styleBlock = buildStyleBlock({ themeCss, darkMode });
    if (args.pdfPage !== undefined) {
      // @page 依赖解析后的 title（${title} 页眉变量替换），置于主题段之后按需追加
      styleBlock += `\n<style>\n${buildPdfPageCss({ ...args.pdfPage, title })}\n</style>`;
    }
  }
  const htmlRoot = darkMode ? '<html lang="zh-CN" class="markwell-dark">' : '<html lang="zh-CN">';
  const head = replaceHeadVariables(HEAD_TEMPLATE, vars);
  const documentHtml = `<!DOCTYPE html>\n${htmlRoot}\n<head>\n${head}\n${styleBlock}\n</head>\n<body>\n${bodyHtml}\n</body>\n</html>\n`;
  return { document: documentHtml, title };
}

/**
 * 收集导出主题层 CSS（主主题 → base.user.css → 主题同名 user.css，后者覆盖前者）
 * @param themeOverride 主题覆盖（另选主题）；缺省 = 当前系统色系激活主题
 * @returns 三段拼接 CSS；无激活主题或任何读取失败返回 undefined（降级无主题样式，
 *          不阻断导出主链路）
 */
async function collectThemeCss(themeOverride?: ExportThemeRef): Promise<string | undefined> {
  try {
    const themeStore = useThemeStore();
    const theme =
      themeOverride ?? themeStore.resolveActiveTheme(themeStore.systemDark ? "dark" : "light");
    if (theme === undefined) return undefined;
    const { dir, hasBaseUserCss } = await listThemes();
    const parts: string[] = [(await readFile(`${dir}/${theme.fileName}`)).content];
    if (hasBaseUserCss) parts.push((await readFile(`${dir}/base.user.css`)).content);
    if (theme.hasUserCss) parts.push((await readFile(`${dir}/${theme.name}.user.css`)).content);
    return parts.join("\n");
  } catch (error) {
    // 降级不阻断：主题层缺失时导出仍可用（内置导出样式兜底）
    console.error("[MarkWell] 导出读取主题 CSS 失败（降级无主题样式）:", error);
    return undefined;
  }
}

/**
 * 解析导出落盘目标
 * @param titleBase 文档标题（文件名基）
 * @param filterName 对话框过滤器显示名
 * @param ext 扩展名（不含点）
 * @param destinationPath 直接落盘路径（X6 overwrite 复导出）；缺省走另存对话框
 * @returns 落盘路径；用户取消对话框 = undefined
 */
async function askExportTarget(
  titleBase: string,
  filterName: string,
  ext: string,
  destinationPath?: string,
): Promise<string | undefined> {
  if (destinationPath !== undefined) return destinationPath;
  const documentDir = dirnameOf(useTabsStore().activeTab?.path);
  const defaultPath = resolveExportDefaultPath(
    `${toFileName(titleBase)}.${ext}`,
    { locationMode: "auto", customDir: "" },
    { documentDir },
  );
  const picked = await exportSaveDialog({ defaultPath, filterName, ext });
  return picked ?? undefined;
}

/**
 * 取路径父目录（兼容 / 与 \ 分隔符，取更靠右者）
 * @param path 完整路径；undefined = 无文档路径（未命名文档）
 * @returns 父目录；纯文件名（无分隔符）返回 undefined
 */
function dirnameOf(path: string | undefined): string | undefined {
  if (path === undefined) return undefined;
  const idx = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return idx === -1 ? undefined : path.slice(0, idx);
}

/**
 * 标题转文件名基（Windows 非法字符替换为下划线）
 * @param title 文档标题
 * @returns 可用文件名；全为非法字符/空白时回落 Untitled
 */
function toFileName(title: string): string {
  return title.replace(/[\\/:*?"<>|]/g, "_").trim() || "Untitled";
}
