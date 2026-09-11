// 窗口控制 IPC 封装测试（@tauri-apps/api core/window 交互收敛；核心服务 100%）
//
// mock core（invoke 命令名/参数捕获）与 window（getCurrentWindow().label）两通道：
// 断言命令名、camelCase 参数形状与返回泛型透传；isMainWindow 以 label 夹具双态验证。
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  label: "main",
  onCloseRequested: vi.fn(),
  destroy: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    label: mocks.label,
    onCloseRequested: mocks.onCloseRequested,
    destroy: mocks.destroy,
  }),
}));

import {
  createMainWindow,
  destroyCurrentWindow,
  isMainWindow,
  isWindowFullscreen,
  registerCloseRequested,
  setWebviewZoom,
  toggleAlwaysOnTop,
  toggleFullscreen,
} from "./window-io";

describe("窗口控制命令 invoke 契约", () => {
  beforeEach(() => {
    mocks.invoke.mockReset();
    mocks.onCloseRequested.mockReset();
    mocks.destroy.mockReset();
    mocks.label = "main";
  });

  it("toggle_fullscreen 无参数调用且布尔返回透传（AC-M-13 契约）", async () => {
    mocks.invoke.mockResolvedValue(true);
    await expect(toggleFullscreen()).resolves.toBe(true);
    expect(mocks.invoke).toHaveBeenCalledWith("toggle_fullscreen");
  });

  it("is_window_fullscreen 无参数调用且布尔返回透传（AC-M-17 启动对齐契约）", async () => {
    mocks.invoke.mockResolvedValue(false);
    await expect(isWindowFullscreen()).resolves.toBe(false);
    expect(mocks.invoke).toHaveBeenCalledWith("is_window_fullscreen");
  });

  it("toggle_always_on_top 无参数调用且布尔返回透传（AC-M-15 契约）", async () => {
    mocks.invoke.mockResolvedValue(true);
    await expect(toggleAlwaysOnTop()).resolves.toBe(true);
    expect(mocks.invoke).toHaveBeenCalledWith("toggle_always_on_top");
  });

  it("set_webview_zoom 以 camelCase scale 参数调用（AC-M-14 契约）", async () => {
    mocks.invoke.mockResolvedValue(undefined);
    await expect(setWebviewZoom(1.1)).resolves.toBeUndefined();
    expect(mocks.invoke).toHaveBeenCalledWith("set_webview_zoom", { scale: 1.1 });
  });

  it("create_main_window 返回新窗口 label（AC-M-16 契约）", async () => {
    mocks.invoke.mockResolvedValue("main-2");
    await expect(createMainWindow()).resolves.toBe("main-2");
    expect(mocks.invoke).toHaveBeenCalledWith("create_main_window");
  });

  it("命令 reject 原样上抛（调用方记录告警的拒绝形态契约）", async () => {
    mocks.invoke.mockRejectedValue("缩放设置失败: 平台错误");
    await expect(setWebviewZoom(1.5)).rejects.toBe("缩放设置失败: 平台错误");
  });
});

describe("isMainWindow（label 判定）", () => {
  it("label=main 判定为主窗口", () => {
    mocks.label = "main";
    expect(isMainWindow()).toBe(true);
  });

  it("label=main-N（New Window 次窗口）判定为非主窗口", () => {
    mocks.label = "main-2";
    expect(isMainWindow()).toBe(false);
  });
});

describe("退出聚合窗口通道（12 W6）", () => {
  it("registerCloseRequested：handler 原样注册并透传 unlisten（A.5.4 unlisten 自持）", async () => {
    const unlisten = () => undefined;
    mocks.onCloseRequested.mockResolvedValue(unlisten);
    const handler = () => undefined;
    const result = await registerCloseRequested(handler);
    expect(mocks.onCloseRequested).toHaveBeenCalledTimes(1);
    expect(mocks.onCloseRequested).toHaveBeenCalledWith(handler);
    expect(result).toBe(unlisten);
  });

  it("destroyCurrentWindow：调 destroy 而非 close（防 onCloseRequested 重入死循环）", async () => {
    mocks.destroy.mockResolvedValue(undefined);
    await expect(destroyCurrentWindow()).resolves.toBeUndefined();
    expect(mocks.destroy).toHaveBeenCalledTimes(1);
  });
});
