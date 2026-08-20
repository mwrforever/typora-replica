// 标签快捷键（04 注册；12 窗口外壳可整体接管）
//
// Ctrl+N 新建标签、Ctrl+W 关闭标签、Ctrl+Tab/Ctrl+Shift+Tab 轮换、
// Ctrl+Shift+T LIFO 重开。与 02 registerAppShortcuts（Ctrl+S/P）与
// 03 registerFileTreeShortcuts（Ctrl+Shift+L/1/2/3/F）不重叠。
//
// 注意：Ctrl+Tab 在 WebView2 的 event.key 为 "Tab"（大写），统一 toLowerCase
// 归一后再比较；Alt/Meta 修饰一律不响应（避免与系统/浏览器组合冲突）。
export function registerTabsShortcuts(handlers: {
  onNewTab: () => void;
  onCloseTab: () => void;
  onCycle: (dir: 1 | -1) => void;
  onReopenClosed: () => void;
}): () => void {
  const onKeydown = (event: KeyboardEvent) => {
    // 非纯 Ctrl 组合（缺 Ctrl / 带 Alt / 带 Meta）一律忽略
    if (!event.ctrlKey || event.altKey || event.metaKey) return;
    const key = event.key.toLowerCase();
    if (key === "n" && !event.shiftKey) {
      event.preventDefault();
      handlers.onNewTab();
    } else if (key === "w" && !event.shiftKey) {
      event.preventDefault();
      handlers.onCloseTab();
    } else if (key === "tab") {
      event.preventDefault();
      handlers.onCycle(event.shiftKey ? -1 : 1);
    } else if (key === "t" && event.shiftKey) {
      event.preventDefault();
      handlers.onReopenClosed();
    }
  };
  window.addEventListener("keydown", onKeydown);
  return () => window.removeEventListener("keydown", onKeydown);
}
