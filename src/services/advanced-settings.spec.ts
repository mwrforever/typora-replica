// conf.user.json 高级设置 IPC 封装测试（wire 契约钉死 + 错误形态 + 客户端键白名单）
import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

import {
  ADVANCED_SETTING_KEYS,
  AdvancedSettingsError,
  DEFAULT_ADVANCED_SETTINGS,
  readAdvancedSettings,
  resetAdvancedSettings,
  openAdvancedSettings,
  writeAdvancedSetting,
} from "./advanced-settings";

describe("readAdvancedSettings", () => {
  beforeEach(() => invokeMock.mockClear());

  it("invoke read_advanced_settings 且透传 Rust DTO 序列化形状", async () => {
    invokeMock.mockResolvedValueOnce({
      defaultFontFamily: { sansSerif: "Microsoft YaHei" },
      autoHideMenuBar: false,
      searchService: [],
      monocolorEmoji: false,
      flags: {},
      autoSaveTimer: 5,
      keyBinding: { "Always on Top": "Ctrl+Shift+P" },
    });
    const s = await readAdvancedSettings();
    expect(invokeMock).toHaveBeenCalledWith("read_advanced_settings");
    expect(s.keyBinding["Always on Top"]).toBe("Ctrl+Shift+P");
    expect(s.autoSaveTimer).toBe(5);
  });

  it("Rust 拒绝（中文 string 错误）包装为 AdvancedSettingsError 上抛", async () => {
    invokeMock.mockRejectedValueOnce(
      "conf.user.json 不是合法 JSON（已保留原文件）: expected value",
    );
    // 单次调用捕获拒绝值：mockRejectedValueOnce 仅对首调生效，二次调用会落回默认 resolve
    const error = await readAdvancedSettings().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AdvancedSettingsError);
    expect((error as AdvancedSettingsError).message).toContain("已保留原文件");
  });

  it("invoke 抛 Error 实例（非 string）时取其 message 包装", async () => {
    invokeMock.mockRejectedValueOnce(new Error("IPC 通道不可用"));
    const error = await readAdvancedSettings().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AdvancedSettingsError);
    expect((error as AdvancedSettingsError).message).toBe("IPC 通道不可用");
  });

  it("非 Error 非 string 的未知拒绝同样可读呈现", async () => {
    invokeMock.mockRejectedValueOnce(undefined);
    await expect(readAdvancedSettings()).rejects.toThrow("读取高级设置失败");
  });
});

describe("writeAdvancedSetting", () => {
  beforeEach(() => invokeMock.mockClear());

  it("invoke write_advanced_settings 携带 key/value 双参数（camelCase wire）", async () => {
    await writeAdvancedSetting("autoHideMenuBar", true);
    expect(invokeMock).toHaveBeenCalledWith("write_advanced_settings", {
      key: "autoHideMenuBar",
      value: true,
    });
  });

  it("Rust 拒绝（string 错误）同样包装为 AdvancedSettingsError 上抛", async () => {
    invokeMock.mockRejectedValueOnce("keyBinding 值必须为字符串映射（原文件保留原样）");
    const error = await writeAdvancedSetting("keyBinding", 123).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AdvancedSettingsError);
    expect((error as AdvancedSettingsError).message).toContain("原文件保留原样");
  });

  it("白名单外键客户端直接拒绝（不发起 invoke）", async () => {
    await expect(writeAdvancedSetting("notInWhitelist" as never, true)).rejects.toThrow(
      "非法的高级设置键",
    );
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("七键白名单常量与 Rust 键清单同源（逐键钉死）", () => {
    expect([...ADVANCED_SETTING_KEYS]).toEqual([
      "defaultFontFamily",
      "autoHideMenuBar",
      "searchService",
      "monocolorEmoji",
      "flags",
      "autoSaveTimer",
      "keyBinding",
    ]);
  });
});

describe("resetAdvancedSettings / openAdvancedSettings", () => {
  beforeEach(() => invokeMock.mockClear());

  it("reset 调用 reset_advanced_settings", async () => {
    await resetAdvancedSettings();
    expect(invokeMock).toHaveBeenCalledWith("reset_advanced_settings");
  });

  it("open 调用 open_advanced_settings", async () => {
    await openAdvancedSettings();
    expect(invokeMock).toHaveBeenCalledWith("open_advanced_settings");
  });
});

describe("DEFAULT_ADVANCED_SETTINGS", () => {
  it("与 Rust 默认模板逐键一致（合并快照回退基准）", () => {
    expect(DEFAULT_ADVANCED_SETTINGS).toEqual({
      defaultFontFamily: {},
      autoHideMenuBar: false,
      searchService: [],
      monocolorEmoji: false,
      flags: {},
      autoSaveTimer: 5,
      keyBinding: {},
    });
  });
});
