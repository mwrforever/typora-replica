// DevTools 快捷键（08 T7）：Shift+F12 窗口级组合（编辑器内快捷键归 01 keymap 注册表，
// 本层只处理窗口级组合——app-shortcuts.ts 同一分层）。命令本体见 Rust devtools.rs，
// debug 构建默认可用、release 需 devtools feature（不支持时命令返回 false 不报错）。
import { toggleDevtools } from "../../services/theme-io";

/**
 * 注册 Shift+F12 窗口级快捷键（View → Toggle DevTools；12 窗口外壳可整体接管）
 * @returns 注销函数（App 卸载调用）
 */
export function registerDevtoolsShortcut(): () => void {
  const onKeydown = (event: KeyboardEvent): void => {
    // 编辑器 keymap 已消费的按键不得重复触发（TASK 10#3 清单外同型缺口收口，
    // settings-shortcuts.ts 同款先例：prosemirror-view 命中仅 preventDefault 不阻断传播）
    if (event.defaultPrevented) return;
    // 仅 Shift+F12 命中；无 Shift 的 F12 留给浏览器默认行为
    if (!(event.shiftKey && event.key === "F12")) return;
    event.preventDefault();
    // 开合结果无需消费；失败（构建不支持/IPC 异常）仅记录不打断交互
    void toggleDevtools().catch((e: unknown) => {
      console.error("[MarkWell] DevTools 切换失败", e);
    });
  };
  window.addEventListener("keydown", onKeydown);
  return () => window.removeEventListener("keydown", onKeydown);
}
