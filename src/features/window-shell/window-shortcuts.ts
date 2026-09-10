// 窗口外壳快捷键（12 W2/W3）：Ctrl+O 打开文件 / Ctrl+Shift+S 另存为 /
// F11 全屏 / Ctrl+Shift+0/=/- 缩放三键 / Ctrl+Shift+N 新建窗口
//
// 菜单装配引入的窗口级组合（此前无键盘通路，菜单 label 真实性要求注册）；
// Ctrl+Shift+N/0/=/- 同步登记进 10 域 WINDOW_RESERVED_PM_KEYS（shortcut-keys.ts，
// 防 keyBinding 把编辑器命令绑到同名组合造成双重执行；F11 无 Ctrl 修饰本就被
// parseShortcutCombo 拒绝，无需入集）。与 02 registerAppShortcuts（纯 Ctrl）同型
// 分层：编辑器内快捷键归 01 keymap 注册表，本层只处理窗口级组合；
// defaultPrevented 守卫随 10#3 收口先行。

/** 窗口外壳快捷键回调集（装配层转 menuRouter / window-controls 同一命令函数） */
export interface WindowShellShortcutHandlers {
  /** 打开文件对话框（Ctrl+O） */
  onOpenFile: () => void;
  /** 另存为（Ctrl+Shift+S） */
  onSaveAs: () => void;
  /** 切换全屏（F11） */
  onToggleFullscreen: () => void;
  /** 缩放恢复原始尺寸（Ctrl+Shift+0） */
  onZoomReset: () => void;
  /** 缩放放大一档（Ctrl+Shift+=） */
  onZoomIn: () => void;
  /** 缩放缩小一档（Ctrl+Shift+-） */
  onZoomOut: () => void;
  /** 新建窗口（Ctrl+Shift+N） */
  onNewWindow: () => void;
}

/**
 * 注册窗口外壳快捷键（App 装配层调用一次；窗口级 keydown 监听）
 * @param handlers 命令回调集（与菜单 action 共用同一命令函数——AC-M-3）
 * @returns 注销函数（组件卸载调用）
 */
export function registerWindowShellShortcuts(handlers: WindowShellShortcutHandlers): () => void {
  const onKeydown = (event: KeyboardEvent): void => {
    // 编辑器 keymap 已消费的按键不得重复触发（TASK 10#3 同款守卫先例）
    if (event.defaultPrevented) return;
    // F11 全屏：单键无修饰（任何修饰组合均不归本服务）
    if (
      event.key === "F11" &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.metaKey &&
      !event.shiftKey
    ) {
      // 拦截 WebView 默认行为（如原生全屏语义），统一走本命令函数
      event.preventDefault();
      handlers.onToggleFullscreen();
      return;
    }
    // Ctrl 必需，Alt/Meta 排除（Shift 仅用于 Ctrl+Shift 组合族区分）
    if (!event.ctrlKey || event.altKey || event.metaKey) return;
    const key = event.key.toLowerCase();
    if (key === "o" && !event.shiftKey) {
      // 拦截 WebView 默认「打开文件」行为
      event.preventDefault();
      handlers.onOpenFile();
    } else if (key === "s" && event.shiftKey) {
      event.preventDefault();
      handlers.onSaveAs();
    } else if (event.shiftKey) {
      // Ctrl+Shift 组合族按物理键位判定（event.code）：Shift 参与时 event.key 随
      // 布局漂移（Shift+= → "+"、Shift+- → "_"），物理键位恒定对齐菜单标注组合
      switch (event.code) {
        case "Digit0":
          event.preventDefault();
          handlers.onZoomReset();
          break;
        case "Equal":
          event.preventDefault();
          handlers.onZoomIn();
          break;
        case "Minus":
          event.preventDefault();
          handlers.onZoomOut();
          break;
        case "KeyN":
          event.preventDefault();
          handlers.onNewWindow();
          break;
      }
    }
  };
  window.addEventListener("keydown", onKeydown);
  return () => window.removeEventListener("keydown", onKeydown);
}
