// 搜索快捷键（06）：window 层注册（沿 app-shortcuts/tabs-shortcuts 先例）
//
// Ctrl+F/Ctrl+H 开关面板、F3/Shift+F3 导航、Escape 关闭上报。
// 不走 addEditorKeymap：免受 Crepe create 时序约束，且面板内外焦点均生效。
// Escape 恒上报——「面板不可见时忽略」的守卫由接线方持有（本模块无状态可判）。
export interface SearchShortcutHandlers {
  /** Ctrl+F 开关 Find 面板 */
  onToggleFind: () => void;
  /** Ctrl+H 开关 Find+Replace 面板 */
  onToggleReplace: () => void;
  /** F3 / 输入框 Enter 下一个 */
  onNext: () => void;
  /** Shift+F3 / Shift+Enter 上一个 */
  onPrev: () => void;
  /** Escape 关闭（接线方持可见性守卫） */
  onClose: () => void;
}

/**
 * 注册搜索快捷键
 * @param handlers 五路回调（语义见接口注释）
 * @returns 注销函数（组件卸载成对调用）
 */
export function registerSearchShortcuts(handlers: SearchShortcutHandlers): () => void {
  const onKeydown = (event: KeyboardEvent): void => {
    // 编辑器 keymap 已消费的按键不得重复触发搜索面板（TASK 10#3 收口，
    // settings-shortcuts.ts 同款先例：prosemirror-view 命中仅 preventDefault 不阻断传播）
    if (event.defaultPrevented) return;
    // IME 组合期一律放行（中文输入过程不触发任何搜索行为）
    if (event.isComposing) return;
    // Ctrl 单修饰组合（排除 Shift/Alt/Meta，避免与编辑器/其他模块冲突）
    if (event.ctrlKey && !event.shiftKey && !event.altKey && !event.metaKey) {
      const key = event.key.toLowerCase();
      if (key === "f") {
        event.preventDefault();
        handlers.onToggleFind();
        return;
      }
      if (key === "h") {
        event.preventDefault();
        handlers.onToggleReplace();
        return;
      }
      return;
    }
    if (event.key === "F3") {
      event.preventDefault(); // 拦截浏览器/Electron 默认查找栏
      if (event.shiftKey) handlers.onPrev();
      else handlers.onNext();
      return;
    }
    if (event.key === "Escape") {
      handlers.onClose();
    }
  };
  window.addEventListener("keydown", onKeydown);
  return () => window.removeEventListener("keydown", onKeydown);
}
