// 主题功能装配（08；App.vue onMounted 调一次。12 窗口外壳后续接管菜单接线）
import { useThemeStore } from "./theme-store";

/**
 * 注册主题功能：初始化主题 store（读设置 + 扫描目录 + asset 授权 + 首次注入）。
 * init 内部接管全部拒绝（恒 resolve，含设置读取/目录扫描失败），故此处的 void
 * 调用不产生 unhandled rejection；失败经 store 内 console.error 日志降级为默认
 * 样式，编辑主链路不受影响。
 */
export function registerThemeFeature(): void {
  const store = useThemeStore();
  void store.init();
}
