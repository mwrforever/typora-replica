// 系统浏览器打开封装（E14 Ctrl+点击链接）
//
// 默认实现走 @tauri-apps/plugin-opener（Rust 侧已注册 opener:default，见 src-tauri）。
// 12 窗口外壳模块可用相同签名替换实现（如走自定义 Tauri command），测试以 vi.mock 替换。
import { openUrl } from "@tauri-apps/plugin-opener";

/**
 * 在系统默认浏览器打开链接
 * @param url 目标 URL（http/https）
 * @returns 打开完成（Tauri command 返回后 resolve）
 */
export async function openExternalUrl(url: string): Promise<void> {
  await openUrl(url);
}
