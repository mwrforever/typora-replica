// YAML 导出变量提取与 head 白名单替换（09 X1）
//
// 安全设计（spec §2 X1「YAML 变量替换仅限 <title>/<meta> 内防 XSS」）：
// 1. 变量只从 front matter 内文提取，键名走白名单，白名单外键直接丢弃；
// 2. 替换只作用于调用方传入的 head 模板字符串——正文 HTML（DOM 序列化产物）
//    在 html-export 管线中永不进入本函数，正文中的 {{title}} 字面量天然不被替换；
// 3. 全部值经 escapeHtmlValue 转义后才拼入模板，<script> 注入失效。
// 纯函数模块：无状态、无 IO。
import { readFrontMatterKey } from "../editor/frontmatter/frontmatter";

/** 导出变量白名单（对齐 Typora YAML 导出变量语义；title 必有键） */
const VARIABLE_KEYS = ["title", "author", "description", "keywords", "date"] as const;

/** 导出变量集（白名单键 → 字符串值；title 恒存在，无值时空串） */
export interface YamlExportVariables {
  title: string;
  author?: string;
  description?: string;
  keywords?: string;
  date?: string;
}

/**
 * HTML 敏感字符转义（防 XSS 核心闸门）
 * @param raw 原始值（YAML 行级值，可能含任意字符）
 * @returns 转义后可安全嵌入 HTML 文本的值（& < > " ' 全转义）
 */
export function escapeHtmlValue(raw: string): string {
  // split/join 而非 replaceAll：项目 TS lib 低于 ES2021 无该方法，且字面量替换天然规避正则元字符转义
  return raw
    .split("&")
    .join("&amp;")
    .split("<")
    .join("&lt;")
    .split(">")
    .join("&gt;")
    .split('"')
    .join("&quot;")
    .split("'")
    .join("&#39;");
}

/**
 * 从 front matter 内文提取白名单导出变量（行级解析，复用 01 readFrontMatterKey）
 * @param fm front matter 内文（不含定界符）；null = 无 front matter
 * @returns 变量集；title 恒有键（无值空串，由调用方回落文件名）
 */
export function extractYamlVariables(fm: string | null): YamlExportVariables {
  const vars: YamlExportVariables = { title: "" };
  if (fm === null) return vars;
  for (const key of VARIABLE_KEYS) {
    const value = readFrontMatterKey(fm, key);
    if (value !== undefined && value !== "") {
      vars[key] = value;
    }
  }
  return vars;
}

/**
 * head 模板变量替换（唯一替换入口；{{key}} 占位符 → 转义后值）
 *
 * 占位符形式采用 {{key}}（内部模板约定，非用户面）；未出现的占位符替换为空串，
 * 防止模板残留占位符泄漏到导出产物。
 * @param headTemplate head 段模板字符串（含 {{title}} 等占位符）
 * @param vars 变量集（值在替换前统一转义）
 * @returns 替换完成的 head 段 HTML
 */
export function replaceHeadVariables(headTemplate: string, vars: YamlExportVariables): string {
  let out = headTemplate;
  for (const key of VARIABLE_KEYS) {
    const raw = vars[key] ?? "";
    // split/join 全局字面量替换占位符（lib 低于 ES2021 无 replaceAll；动态串免正则转义）
    out = out.split(`{{${key}}}`).join(escapeHtmlValue(raw));
  }
  return out;
}
