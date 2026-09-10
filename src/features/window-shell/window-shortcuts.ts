// 窗口外壳快捷键（12 W2）：Ctrl+O 打开文件 / Ctrl+Shift+S 另存为
//
// W2 菜单装配引入的两个新窗口级组合（此前无键盘通路，菜单 label 真实性要求注册）：
// 同步登记进 10 域 WINDOW_RESERVED_PM_KEYS（shortcut-keys.ts，防 keyBinding 双重执行）。
// 与 02 registerAppShortcuts（纯 Ctrl）同型分层：编辑器内快捷键归 01 keymap 注册表，
// 本层只处理窗口级组合；defaultPrevented 守卫随 10#3 收口先行。
/**
 * 注册窗口外壳快捷键
 * @param handlers 打开文件/另存为回调（装配层转 menuRouter 派发）
 * @returns 注销函数（组件卸载调用）
 */
export function registerWindowShellShortcuts(handlers: {
  onOpenFile: () => void;
  onSaveAs: () => void;
}): () => void {
  const onKeydown = (event: KeyboardEvent): void => {
    // 编辑器 keymap 已消费的按键不得重复触发（TASK 10#3 同款守卫先例）
    if (event.defaultPrevented) return;
    // Ctrl 必需，Alt/Meta 排除（Shift 仅用于 Ctrl+Shift+S 区分另存为）
    if (!event.ctrlKey || event.altKey || event.metaKey) return;
    const key = event.key.toLowerCase();
    if (key === "o" && !event.shiftKey) {
      // 拦截 WebView 默认「打开文件」行为
      event.preventDefault();
      handlers.onOpenFile();
    } else if (key === "s" && event.shiftKey) {
      event.preventDefault();
      handlers.onSaveAs();
    }
  };
  window.addEventListener("keydown", onKeydown);
  return () => window.removeEventListener("keydown", onKeydown);
}
