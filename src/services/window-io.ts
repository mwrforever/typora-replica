// 窗口控制 IPC 封装（12 窗口外壳 W3；B.4.1 IPC 网关——全屏/置顶/缩放/新建窗口/
// 全屏态查询 invoke 收敛本层，组件/功能域禁止散落直呼）
//
// 契约对齐（A.3）：命令名 snake_case；参数 camelCase 键 JSON；返回值经显式泛型
// 收敛（A.7.2）。窗口参数不从前端传递——Rust 侧注入「发起 invoke 的窗口」，
// 全屏/置顶/缩放天然仅作用于当前窗口（AC-M-15 仅当前窗口语义）。
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { CloseRequestedEvent } from "@tauri-apps/api/window";

/** 主窗口 label（tauri.conf.json windows[0] 未声明 label 时 Tauri 默认 main） */
const MAIN_WINDOW_LABEL = "main";

/**
 * 切换全屏（AC-M-13：F11；前端据返回值联动菜单栏显隐）
 * @returns 切换后的全屏态（true = 已进入全屏）
 * @throws Error Rust 命令 reject（平台调用失败；调用方记录告警，状态不镜像）
 */
export function toggleFullscreen(): Promise<boolean> {
  return invoke<boolean>("toggle_fullscreen");
}

/**
 * 查询当前窗口全屏态（AC-M-17 启动对齐：window-state 插件恢复全屏后装配层读取，
 * 同步「全屏即隐菜单」语义到重启恢复路径）
 * @returns 当前全屏态
 * @throws Error Rust 命令 reject（调用方按非全屏降级继续）
 */
export function isWindowFullscreen(): Promise<boolean> {
  return invoke<boolean>("is_window_fullscreen");
}

/**
 * 切换窗口置顶（AC-M-15：Always on Top；仅作用于发起 invoke 的当前窗口）
 * @returns 切换后的置顶态（true = 置顶生效中）
 * @throws Error Rust 命令 reject（平台调用失败）
 */
export function toggleAlwaysOnTop(): Promise<boolean> {
  return invoke<boolean>("toggle_always_on_top");
}

/**
 * 设置 WebView 整窗缩放（AC-M-14：含侧栏整窗生效；档位决策在前端状态机，
 * 本层只透传系数——Rust 侧再钳制 0.5~2.0 防越界）
 * @param scale 缩放系数（1.0 = 100%）
 * @throws Error Rust 命令 reject（平台调用失败）
 */
export async function setWebviewZoom(scale: number): Promise<void> {
  await invoke("set_webview_zoom", { scale });
}

/**
 * 新建应用窗口（AC-M-16：New Window；新窗口为独立 WebView 加载同一前端产物，
 * 独立 JS context → Pinia/多标签/菜单装配按窗口天然隔离，初始空文档）
 * @returns 新窗口 label（main-2、main-3…；日志/调试标识）
 * @throws Error Rust 命令 reject（创建失败）
 */
export function createMainWindow(): Promise<string> {
  return invoke<string>("create_main_window");
}

/**
 * 当前窗口是否主窗口（label 判定）
 * @returns true = 主窗口（main）；false = New Window 创建的次窗口（main-N）。
 *          主题热刷新守卫等「仅主窗口执行」场景消费（12 W3 D1 裁决）
 */
export function isMainWindow(): boolean {
  return getCurrentWindow().label === MAIN_WINDOW_LABEL;
}

/**
 * 注册当前窗口关闭请求监听（12 W6 退出聚合接线，AC-M-18~21）。
 * @param handler 关闭请求回调（event.preventDefault() 阻止本次关闭，后续处置
 *                归退出聚合状态机——弹确认或 destroy）
 * @returns 取消监听函数（unlisten 自持，A.5.4 精神；装配层 onBeforeUnmount 退订）
 */
export function registerCloseRequested(
  handler: (event: CloseRequestedEvent) => void | Promise<void>,
): Promise<() => void> {
  return getCurrentWindow().onCloseRequested(handler);
}

/**
 * 销毁当前窗口（12 W6 确认通过后的唯一关窗出口）。
 * 必须 destroy 而非 close：onCloseRequested 监听在册时 Tauri 对 close 请求
 * 自动阻止并再次回调 JS（has_js_listener 判定），close 只会重入确认流程形成
 * 死循环；destroy 绕过 close-requested 管线直接销毁窗口。
 * @throws Error IPC 调用失败（窗口可能已销毁；调用方记录并回退交互态）
 */
export async function destroyCurrentWindow(): Promise<void> {
  await getCurrentWindow().destroy();
}
