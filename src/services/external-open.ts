// 系统浏览器打开封装（E14 Ctrl+点击链接）
//
// 默认实现走 @tauri-apps/plugin-opener（Rust 侧已注册 opener:default，见 src-tauri）。
// 12 窗口外壳模块可用相同签名替换实现（如走自定义 Tauri command），测试以 vi.mock 替换。
import { openUrl } from "@tauri-apps/plugin-opener";

/** 允许打开的 URL 协议白名单（href 来自文档内容、完全可控，白名单外一律拒绝打开） */
const ALLOWED_URL_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:"]);

/**
 * 校验 URL 是否属于白名单协议（http/https/mailto/tel）
 *
 * 文档内容可控，link 标记的 href 可能被构造为 file:/javascript:/data: 等危险协议；
 * 当前 Tauri capability ACL 虽已限制 opener 可打开的协议，但本封装注释承诺可被
 * 12 模块替换实现——替换实现绕过 ACL 时白名单仍能守住本地文件打开/脚本执行面，
 * capability 未来放宽也不会无感知扩大攻击面（FIX-6 安全纵深）。
 * @param url 目标 URL
 * @returns 白名单内返回 true；非法/不可解析的 URL 一律返回 false（拒绝打开）
 */
function isAllowedUrlProtocol(url: string): boolean {
  try {
    return ALLOWED_URL_PROTOCOLS.has(new URL(url).protocol);
  } catch {
    // 不可解析的畸形 URL 一律拒绝（不打开也不抛错，调用方无需感知）
    return false;
  }
}

/**
 * 在系统默认浏览器打开链接
 * @param url 目标 URL（http/https/mailto/tel；白名单外协议拒绝打开）
 * @returns 打开完成（Tauri command 返回后 resolve）；白名单外直接 resolve 不打开
 */
export async function openExternalUrl(url: string): Promise<void> {
  // 协议白名单：非白名单协议直接拒绝（安全底线，见 isAllowedUrlProtocol）
  if (!isAllowedUrlProtocol(url)) return;
  // 纯 Web 环境（npm run dev 浏览器态）无 Tauri 运行时：openUrl 内部 invoke 访问
  // window.__TAURI_INTERNALS__ 会抛 TypeError——回落 window.open 保持链接可用，
  // 且不带 opener 引用（noopener）+ 不泄漏 Referer（noreferrer）
  if (!("__TAURI_INTERNALS__" in window)) {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  await openUrl(url);
}
