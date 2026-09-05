// 主题功能装配（08；App.vue onMounted 调一次。12 窗口外壳后续接管菜单接线）
import { useThemeStore } from "./theme-store";

/**
 * 注册主题功能：初始化主题 store（读设置 + 扫描目录 + asset 授权 + 系统色系订阅 +
 * 首次注入）。异步流程不阻塞启动；失败经 store 内日志降级。
 * @returns 注销函数（App 卸载调用：退订色系监听 + 清理防抖定时器）
 */
export function registerThemeFeature(): () => void {
  const store = useThemeStore();
  void store.init();
  return () => store.dispose();
}
