// 主题功能装配（08；App.vue onMounted 调一次。12 窗口外壳后续接管菜单接线）
import { useThemeStore } from "./theme-store";

/**
 * 注册主题功能：初始化主题 store（读设置 + 扫描目录 + asset 授权 + 首次注入）。
 * 异步流程不阻塞启动；失败经 store 内日志降级（编辑主链路不受影响）。
 */
export function registerThemeFeature(): void {
  const store = useThemeStore();
  void store.init();
}
