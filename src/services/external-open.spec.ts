// external-open：系统浏览器打开封装的单元测试（隔离 Tauri 运行时）
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 模拟 Tauri opener 插件（jsdom 无 Tauri 运行时，invoke 不可用）
vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(),
}));
import { openUrl } from "@tauri-apps/plugin-opener";
import { openExternalUrl } from "./external-open";

/** 以可写方式访问 window 上的 Tauri 运行时常量（jsdom 缺省不存在） */
const windowAny = window as unknown as Record<string, unknown>;

describe("external-open 系统浏览器打开封装", () => {
  beforeEach(() => {
    vi.mocked(openUrl).mockClear();
  });

  afterEach(() => {
    // 还原 Tauri 环境标记，避免用例间串扰（jsdom 无原生 __TAURI_INTERNALS__）
    delete windowAny.__TAURI_INTERNALS__;
  });

  it("Tauri 环境 openExternalUrl 转交 opener.openUrl 打开目标 URL", async () => {
    windowAny.__TAURI_INTERNALS__ = {};
    await openExternalUrl("https://example.com");
    expect(vi.mocked(openUrl)).toHaveBeenCalledWith("https://example.com");
  });

  it("纯 Web 环境（无 Tauri 运行时）回落 window.open 打开链接", async () => {
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    await openExternalUrl("https://example.com");
    // 兜底打开携带 noopener/noreferrer（新窗口无 opener 引用、不泄漏 Referer）
    expect(openSpy).toHaveBeenCalledWith("https://example.com", "_blank", "noopener,noreferrer");
    expect(vi.mocked(openUrl)).not.toHaveBeenCalled();
    openSpy.mockRestore();
  });

  it("Tauri 环境 opener 失败时向上抛出（调用方感知失败，不静默吞错）", async () => {
    windowAny.__TAURI_INTERNALS__ = {};
    vi.mocked(openUrl).mockRejectedValueOnce(new Error("opener 不可用"));
    await expect(openExternalUrl("https://example.com")).rejects.toThrow("opener 不可用");
  });

  it.each([
    "javascript:alert(1)",
    "file:///C:/Windows/win.ini",
    "data:text/html,<script>alert(1)</script>",
    "ftp://example.com/file",
  ])("协议白名单：%s 拒绝打开（不调 openUrl 也不调 window.open）", async (url) => {
    windowAny.__TAURI_INTERNALS__ = {};
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    await openExternalUrl(url);
    expect(vi.mocked(openUrl)).not.toHaveBeenCalled();
    expect(openSpy).not.toHaveBeenCalled();
    openSpy.mockRestore();
  });

  it("畸形 URL（不可解析）拒绝打开", async () => {
    windowAny.__TAURI_INTERNALS__ = {};
    await openExternalUrl("://bad-url");
    expect(vi.mocked(openUrl)).not.toHaveBeenCalled();
  });
});
