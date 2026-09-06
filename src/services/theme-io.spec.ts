// 主题域 IPC 收敛（08 spec §5）：命令名/wire 形状/错误规范化三面钉桩。
// mock invoke 层验证——不依赖 Rust 侧编译（命令实现见 Task 4/9/14）。
import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
  Channel: class {
    // 桩类型默认 undefined（宪法 A.1.2.3：新增代码表示「无」一律 undefined；
    // 本桩为我方 mock 而非第三方 API 对齐面，theme-io 仅对其赋值不读取初值）
    onmessage: ((events: unknown) => void) | undefined = undefined;
  },
}));

import {
  allowThemeAssetDirectory,
  listThemes,
  openThemeFolder,
  ThemeIoError,
  toggleDevtools,
  unwatchThemes,
  watchThemes,
} from "./theme-io";

describe("theme-io IPC 收敛", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("listThemes 单参无 args 调用并透传响应", async () => {
    const dto = { dir: "C:\\t", themes: [], hasBaseUserCss: false };
    invokeMock.mockResolvedValue(dto);
    await expect(listThemes()).resolves.toEqual(dto);
    expect(invokeMock).toHaveBeenCalledWith("list_themes");
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it("watchThemes 经 Channel 批量接收且 onmessage 已接线", async () => {
    invokeMock.mockResolvedValue(undefined);
    const onEvents = vi.fn();
    await watchThemes(onEvents);
    const [command, args] = invokeMock.mock.calls[0] as [
      string,
      { channel: { onmessage: unknown } },
    ];
    expect(command).toBe("watch_themes");
    expect(args.channel.onmessage).toBe(onEvents);
  });

  it("openThemeFolder / toggleDevtools / allowThemeAssetDirectory 命令与参数形状", async () => {
    invokeMock.mockResolvedValue(undefined);
    await openThemeFolder();
    expect(invokeMock).toHaveBeenLastCalledWith("open_theme_folder");
    await allowThemeAssetDirectory("C:\\t");
    expect(invokeMock).toHaveBeenLastCalledWith("allow_asset_directory", { dir: "C:\\t" });
    invokeMock.mockResolvedValue(true);
    await expect(toggleDevtools()).resolves.toBe(true);
    expect(invokeMock).toHaveBeenLastCalledWith("toggle_devtools");
  });

  it("unwatchThemes 无参调用退订命令（dispose/重复 init 前清 Rust 监视槽位）", async () => {
    invokeMock.mockResolvedValue(undefined);
    await expect(unwatchThemes()).resolves.toBeUndefined();
    expect(invokeMock).toHaveBeenCalledWith("unwatch_themes");
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it("字符串拒绝值规范化为 ThemeIoError（Rust Result Err 中文直传）", async () => {
    invokeMock.mockRejectedValue("主题目录不可读");
    const err = await listThemes().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ThemeIoError);
    expect((err as ThemeIoError).message).toBe("主题目录不可读");
  });

  it("Error 对象与非 Error 拒绝值分别取 message 与兜底文案", async () => {
    // vitest 4 toThrow 类型只收单参，简报两参形式（类型+message）拆为相邻两断言等价表达
    invokeMock.mockRejectedValue(new Error("boom"));
    await expect(listThemes()).rejects.toThrow(ThemeIoError);
    await expect(listThemes()).rejects.toThrow("boom");
    invokeMock.mockRejectedValue({ code: 1 });
    await expect(listThemes()).rejects.toThrow(ThemeIoError);
    await expect(listThemes()).rejects.toThrow("未知主题服务错误");
  });
});
