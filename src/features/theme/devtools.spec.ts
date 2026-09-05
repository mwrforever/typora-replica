// Shift+F12 窗口级快捷键（08 T7；app-shortcuts.spec 同款 KeyboardEvent 派发手法）
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ toggle: vi.fn() }));
vi.mock("../../services/theme-io", () => ({ toggleDevtools: mocks.toggle }));

import { registerDevtoolsShortcut } from "./devtools";

describe("Shift+F12 DevTools 快捷键（AC-T7-1 前端段）", () => {
  beforeEach(() => {
    mocks.toggle.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("Shift+F12 触发 DevTools 切换命令并阻止默认", () => {
    mocks.toggle.mockResolvedValue(true);
    const cleanup = registerDevtoolsShortcut();
    const ev = new KeyboardEvent("keydown", { key: "F12", shiftKey: true, cancelable: true });
    const prevented = !window.dispatchEvent(ev);
    expect(mocks.toggle).toHaveBeenCalledTimes(1);
    expect(prevented).toBe(true);
    cleanup();
  });

  it("无 Shift 修饰的 F12 不触发（留给浏览器默认行为）", () => {
    const cleanup = registerDevtoolsShortcut();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "F12" }));
    expect(mocks.toggle).not.toHaveBeenCalled();
    cleanup();
  });

  it("命令失败仅记录错误不崩溃", async () => {
    mocks.toggle.mockRejectedValueOnce(new Error("构建不支持"));
    const cleanup = registerDevtoolsShortcut();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "F12", shiftKey: true }));
    await vi.waitFor(() => expect(console.error).toHaveBeenCalled());
    cleanup();
  });

  it("注销后不再触发", () => {
    const cleanup = registerDevtoolsShortcut();
    cleanup();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "F12", shiftKey: true }));
    expect(mocks.toggle).not.toHaveBeenCalled();
  });
});
