// 侧栏快捷键（03 文件树注册；12 窗口外壳可整体接管）
//
// Ctrl+Shift+L 侧栏开关（F2）、Ctrl+Shift+1/2/3 面板切换（F2）、
// Ctrl+Shift+F 全局搜索入口（F12）。与 02 registerAppShortcuts（纯 Ctrl）不重叠。
export function registerFileTreeShortcuts(handlers: {
  toggleSidebar: () => void;
  switchPanel: (key: "outline" | "list" | "tree") => void;
  showSearch: () => void;
}): () => void {
  const onKeydown = (event: KeyboardEvent) => {
    // 编辑器 keymap 已消费的按键不得重复触发侧栏动作（TASK 10#3 收口，
    // settings-shortcuts.ts 同款先例：prosemirror-view 命中仅 preventDefault 不阻断传播）
    if (event.defaultPrevented) return;
    if (!event.ctrlKey || !event.shiftKey || event.altKey || event.metaKey) return;
    const key = event.key.toLowerCase();
    if (key === "l") {
      event.preventDefault();
      handlers.toggleSidebar();
    } else if (key === "1") {
      event.preventDefault();
      handlers.switchPanel("outline");
    } else if (key === "2") {
      event.preventDefault();
      handlers.switchPanel("list");
    } else if (key === "3") {
      event.preventDefault();
      handlers.switchPanel("tree");
    } else if (key === "f") {
      event.preventDefault();
      handlers.showSearch();
    }
  };
  window.addEventListener("keydown", onKeydown);
  return () => window.removeEventListener("keydown", onKeydown);
}
