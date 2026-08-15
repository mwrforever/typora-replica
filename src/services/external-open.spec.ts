// external-open：系统浏览器打开封装的单元测试（隔离 Tauri 运行时）
import { beforeEach, describe, expect, it, vi } from "vitest";

// 模拟 Tauri opener 插件（jsdom 无 Tauri 运行时，invoke 不可用）
vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(),
}));
import { openUrl } from "@tauri-apps/plugin-opener";
import { openExternalUrl } from "./external-open";

describe("external-open 系统浏览器打开封装", () => {
  beforeEach(() => {
    vi.mocked(openUrl).mockClear();
  });

  it("openExternalUrl 转交 opener.openUrl 打开目标 URL", async () => {
    await openExternalUrl("https://example.com");
    expect(vi.mocked(openUrl)).toHaveBeenCalledWith("https://example.com");
  });

  it("opener 失败时向上抛出（调用方感知失败，不静默吞错）", async () => {
    vi.mocked(openUrl).mockRejectedValueOnce(new Error("opener 不可用"));
    await expect(openExternalUrl("https://example.com")).rejects.toThrow("opener 不可用");
  });
});
