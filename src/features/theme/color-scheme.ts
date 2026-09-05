// 系统色系监视（08 spec T5 明暗源；D-3：系统跟随、不钉死窗口主题）
//
// matchMedia('(prefers-color-scheme: dark)') 为唯一事实源——WebView2 色系跟随
// 系统时 change 事件即系统明暗切换；主题内 media query 自适应同样依赖该链路
// （AC-T5-2，注入层不干预）。纯封装无状态；退订函数交调用方持有。
const DARK_QUERY = "(prefers-color-scheme: dark)";

/** 当前系统是否暗色 */
export function currentSystemDark(): boolean {
  return window.matchMedia(DARK_QUERY).matches;
}

/**
 * 订阅系统色系变化
 * @param onChange 色系变化回调（dark=true 暗色）
 * @returns 退订函数（dispose 链消费）
 */
export function watchSystemColorScheme(onChange: (dark: boolean) => void): () => void {
  const mql = window.matchMedia(DARK_QUERY);
  const handler = (event: MediaQueryListEvent): void => onChange(event.matches);
  mql.addEventListener("change", handler);
  return () => mql.removeEventListener("change", handler);
}
