// autoHideMenuBar Alt 单按切换状态机测试（AC-M-5；核心域 100%）
//
// 合成 KeyboardEvent 直发 window（与 app-shortcuts.spec 同口径）；IPC 以 spy 注入。
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAutoHideMenu } from "./use-auto-hide-menu";

function pressAlt(init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key: "Alt",
    cancelable: true,
    bubbles: true,
    ...init,
  });
  window.dispatchEvent(event);
  return event;
}

describe("useAutoHideMenu（AC-M-5 Alt 单按切换）", () => {
  let cleanup: (() => void) | undefined;
  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
  });

  it("开启 autoHideMenuBar 后 Alt 单键切换显隐（可见→隐藏→恢复）", () => {
    const setMenuVisible = vi.fn(() => Promise.resolve());
    const handle = useAutoHideMenu({ isEnabled: () => true, setMenuVisible });
    cleanup = handle.cleanup;
    pressAlt();
    expect(setMenuVisible).toHaveBeenCalledWith(false);
    expect(handle.visible()).toBe(false);
    pressAlt();
    expect(setMenuVisible).toHaveBeenLastCalledWith(true);
    expect(handle.visible()).toBe(true);
  });

  it("设置键未开启时 Alt 不响应（AC-M-5「开启」前提门控）", () => {
    const setMenuVisible = vi.fn(() => Promise.resolve());
    const handle = useAutoHideMenu({ isEnabled: () => false, setMenuVisible });
    cleanup = handle.cleanup;
    pressAlt();
    pressAlt();
    expect(setMenuVisible).not.toHaveBeenCalled();
    expect(handle.visible()).toBe(true);
  });

  it("启用开关实时读法：运行期开启后 Alt 立即生效（设置面板热切换路径）", () => {
    let enabled = false;
    const setMenuVisible = vi.fn(() => Promise.resolve());
    const handle = useAutoHideMenu({ isEnabled: () => enabled, setMenuVisible });
    cleanup = handle.cleanup;
    pressAlt();
    expect(setMenuVisible).not.toHaveBeenCalled();
    enabled = true;
    pressAlt();
    expect(setMenuVisible).toHaveBeenCalledWith(false);
  });

  it("Alt 组合键 / 长按 repeat / 编辑器已消费事件不触发切换", () => {
    const setMenuVisible = vi.fn(() => Promise.resolve());
    const handle = useAutoHideMenu({ isEnabled: () => true, setMenuVisible });
    cleanup = handle.cleanup;
    pressAlt({ ctrlKey: true });
    pressAlt({ shiftKey: true });
    pressAlt({ metaKey: true });
    pressAlt({ repeat: true });
    // 模拟上游已消费事件：preventDefault 必须先于派发（真实链路为 keymap 命中时消费）
    const consumed = new KeyboardEvent("keydown", { key: "Alt", cancelable: true, bubbles: true });
    consumed.preventDefault();
    window.dispatchEvent(consumed);
    expect(setMenuVisible).not.toHaveBeenCalled();
    expect(handle.visible()).toBe(true);
  });

  it("非 Alt 按键不触发", () => {
    const setMenuVisible = vi.fn(() => Promise.resolve());
    const handle = useAutoHideMenu({ isEnabled: () => true, setMenuVisible });
    cleanup = handle.cleanup;
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "a", cancelable: true }));
    expect(setMenuVisible).not.toHaveBeenCalled();
  });

  it("IPC 失败回滚可见性标记并告警（下轮取反基准正确）", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const setMenuVisible = vi.fn(() => Promise.reject(new Error("平台失败")));
    const handle = useAutoHideMenu({ isEnabled: () => true, setMenuVisible });
    cleanup = handle.cleanup;
    pressAlt();
    expect(handle.visible()).toBe(false); // 先落标记（快速连按按最终态收敛）
    await vi.waitFor(() => {
      expect(handle.visible()).toBe(true); // 失败回滚
      expect(error).toHaveBeenCalledWith(
        expect.stringContaining("autoHideMenuBar"),
        expect.any(Error),
      );
    });
  });

  it("cleanup 后 Alt 不再触发（App 卸载收尾）", () => {
    const setMenuVisible = vi.fn(() => Promise.resolve());
    const handle = useAutoHideMenu({ isEnabled: () => true, setMenuVisible });
    handle.cleanup();
    pressAlt();
    expect(setMenuVisible).not.toHaveBeenCalled();
  });
});
