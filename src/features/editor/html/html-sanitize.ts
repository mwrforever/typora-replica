// HTML 安全清洗（E20 安全路径）
//
// 策略（与 Typora 官方机制一致，见 01 调研第 2 节）：
//   - 白名单清洗：DOMPurify 默认白名单 + script/onload 等事件属性禁用
//   - iframe：允许但强制 sandbox（无本地文件访问权限）
//   - class/id/data-*：渲染时剥离、导出时保留（编辑视图与落盘分离）
//
// 注意：DOMPurify 的 ADD_ATTR 只放行「输入中已存在」的属性，不会为缺失该属性的
// 元素注入（3.4.13 实测：仅 ADD_ATTR 时输出 iframe 不带 sandbox）。因此 sandbox
// 强制注入在清洗后经 DOM 解析补做，保证 AC-E20-4 的 sandbox 属性恒存在。
import DOMPurify from "dompurify";

/**
 * 清洗 HTML 片段（进入编辑视图前调用）
 *
 * 核心安全路径（AC-E20-1/3/4）：DOMPurify 白名单移除 script 与 on* 事件属性、
 * 拦截 javascript: 协议；iframe 放行后强制补注 sandbox 属性（隔离脚本与本地
 * 文件访问）。class/id/data-* 不做处理（渲染剥离由 stripHtmlAttrsAtRender 负责，
 * 导出保留原文）。
 * @param html 原始 HTML 字符串（来自文档解析/粘贴/导入，不可信输入）
 * @returns 清洗后的安全 HTML 字符串
 */
export function sanitizeHtml(html: string): string {
  // 白名单清洗：iframe 不在 DOMPurify 默认允许标签中，需 ADD_TAGS 显式放行；
  // ADD_ATTR 放行 sandbox 属性（输入自带时保留，缺失时由下方 DOM 解析补注）
  const cleaned = DOMPurify.sanitize(html, {
    ADD_TAGS: ["iframe"],
    ADD_ATTR: ["sandbox"],
  });
  // 强制 iframe sandbox：逐 iframe 检查并补注空 sandbox（无任何权限的隔离沙箱）。
  // 清洗结果已是白名单输出，此处仅做属性补注，不引入新的解析面
  const doc = new DOMParser().parseFromString(cleaned, "text/html");
  for (const el of doc.body.querySelectorAll("iframe")) {
    // 已带 sandbox 的 iframe 保留原 token（仍受 sandbox 隔离约束），不重复注入
    if (!el.hasAttribute("sandbox")) el.setAttribute("sandbox", "");
  }
  return doc.body.innerHTML;
}

/**
 * 渲染时剥离装饰性属性（class/id/data-*），导出时保留原文（AC-E20-2）
 *
 * 实现：解析 DOM 后逐节点移除属性再序列化，仅用于编辑视图渲染（html 节点
 * NodeView 调用），文档内容（getMarkdown）不做此剥离。
 * @param html 已清洗的 HTML（sanitizeHtml 输出）
 * @returns 剥离 class/id/data-* 后的 HTML 字符串
 */
export function stripHtmlAttrsAtRender(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  for (const el of doc.body.querySelectorAll<HTMLElement>("*")) {
    // 装饰性属性：class/id 直接移除（编辑视图以内容语义为准，Typora 同款）
    el.removeAttribute("class");
    el.removeAttribute("id");
    // data-* 自定义属性：逐个移除（可能有多个，且属性集合在移除过程中变化，
    // 先快照属性列表再遍历，避免遍历中修改集合）
    for (const attr of [...el.attributes]) {
      if (attr.name.startsWith("data-")) el.removeAttribute(attr.name);
    }
  }
  return doc.body.innerHTML;
}
