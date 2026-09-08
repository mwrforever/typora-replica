// 面板开合快捷键（10：Ctrl+, 开合偏好面板）
//
// 临时窗口级入口——12 窗口外壳菜单接入后由菜单项触发开合，本快捷键届时移交 12 装配
// （披露 5）。与既有 registerAppShortcuts/registerSearchShortcuts 同构：window keydown
// + 纯 Ctrl 组合口径（排除 Shift/Alt/Meta，避免与编辑器/输入法组合冲突）。

/**
 * 注册面板开合快捷键
 * @param handlers 面板开合回调（store.togglePanel）
 * @returns 注销函数（组件卸载调用）
 */
export function registerSettingsShortcuts(handlers: { onTogglePanel: () => void }): () => void {
  const onKeydown = (event: KeyboardEvent): void => {
    // 纯 Ctrl 单修饰组合（排除 Shift/Alt/Meta，与全仓窗口快捷键同口径）
    if (!event.ctrlKey || event.shiftKey || event.altKey || event.metaKey) return;
    if (event.key !== ",") return;
    // 拦截默认行为后触发开合（与同族快捷键一致，避免宿主层再消费该组合）
    event.preventDefault();
    handlers.onTogglePanel();
  };
  window.addEventListener("keydown", onKeydown);
  return () => window.removeEventListener("keydown", onKeydown);
}
