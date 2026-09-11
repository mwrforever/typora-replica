// 窗口级快捷键（02 文档管理注册；12 窗口外壳模块可整体接管）
//
// Ctrl+S 保存（浏览器默认保存拦截）、Ctrl+P Open Quickly（Task 17 接线）。
// 编辑器内快捷键（Ctrl+B 等）仍走 01 keymap 注册表；本层只处理窗口级组合。
/**
 * 注册窗口级快捷键
 * @param handlers 保存/快速打开回调
 * @returns 注销函数（组件卸载调用）
 */
export function registerAppShortcuts(handlers: {
  onSave: () => void;
  onQuickOpen: () => void;
}): () => void {
  const onKeydown = (event: KeyboardEvent) => {
    // 编辑器 keymap 已消费的按键不得重复触发：prosemirror-view 命中键位仅
    // preventDefault 不阻断传播，事件仍冒泡到 window——keyBinding 把编辑器命令
    // 绑到 Ctrl+S/P 时，编辑器动作已执行，窗口保存/快速打开不得二次触发
    // （TASK 10#3 收口，settings-shortcuts.ts 同款先例）
    if (event.defaultPrevented) return;
    // 纯 Ctrl 组合（排除 Shift/Alt/Meta 修饰，避免与编辑器内快捷键冲突）
    if (!event.ctrlKey || event.shiftKey || event.altKey || event.metaKey) return;
    const key = event.key.toLowerCase();
    if (key === "s") {
      // 拦截浏览器默认「保存网页」行为
      event.preventDefault();
      handlers.onSave();
    } else if (key === "p") {
      event.preventDefault();
      handlers.onQuickOpen();
    }
  };
  window.addEventListener("keydown", onKeydown);
  return () => window.removeEventListener("keydown", onKeydown);
}
