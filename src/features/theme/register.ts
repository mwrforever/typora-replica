// 主题功能装配（08；App.vue onMounted 调一次。12 窗口外壳后续接管菜单接线）
import { useThemeStore } from "./theme-store";
import { registerDevtoolsShortcut } from "./devtools";
import { isMainWindow } from "../../services/window-io";

/**
 * 注册主题功能：初始化主题 store（读设置 + 扫描目录 + asset 授权 + 系统色系订阅 +
 * 首次注入）+ Shift+F12 DevTools 快捷键。异步流程不阻塞启动；失败经日志降级。
 *
 * 12 W3 多窗口主题守卫（TASK 08#1 D1 裁决，必做）：watch_themes 的 Rust 监视槽位
 * 为进程级单槽（后订阅顶掉先订阅）——仅主窗口订阅目录热刷新；New Window 次窗口
 * 跳过订阅（主题目录变更降级为重启可见，08 既有降级口径 D-5；CSS 注入与主题切换
 * 不受影响），否则任一次窗关闭清共享槽位会连带终止主窗口热刷新。
 * @returns 注销函数（App 卸载调用：注销快捷键 + 退订色系监听 + 清理定时器）
 */
export function registerThemeFeature(): () => void {
  const store = useThemeStore();
  void store.init({ watchFs: isMainWindow() });
  const cleanupDevtools = registerDevtoolsShortcut();
  return () => {
    cleanupDevtools();
    store.dispose();
  };
}
