// 主题功能装配（08；App.vue onMounted 调一次。12 窗口外壳后续接管菜单接线）
import { useThemeStore } from "./theme-store";
import { registerDevtoolsShortcut } from "./devtools";

/**
 * 注册主题功能：初始化主题 store（读设置 + 扫描目录 + asset 授权 + 系统色系订阅 +
 * 首次注入）+ Shift+F12 DevTools 快捷键。异步流程不阻塞启动；失败经日志降级。
 * @returns 注销函数（App 卸载调用：注销快捷键 + 退订色系监听 + 清理定时器）
 */
export function registerThemeFeature(): () => void {
  const store = useThemeStore();
  void store.init();
  const cleanupDevtools = registerDevtoolsShortcut();
  return () => {
    cleanupDevtools();
    store.dispose();
  };
}
