// 窗口域 keyBinding 动态快捷键核心单测（10#1 执行接线；宪法 A.6 核心域 100%）
//
// 覆盖三类场景：正常路径（custom 窗口域条目按键触发命令映射）、边界条件
// （修饰位精确匹配 / 字母键大小写归一 / 符号与具名主键 / 空集注册）、异常场景
// （非法组合 / 窗口保留组合 / 映射表外命令 / defaultPrevented 守卫 / 重注册不泄漏）。
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  matchesShortcutEvent,
  registerWindowKeybindingShortcuts,
} from "./window-keybinding-shortcuts";
import type { MenuShortcutEntry } from "../settings/shortcut-binding";

/** 构造合并条目（shortcut-binding 产物形状；仅声明测试关注字段） */
function entry(overrides: Partial<MenuShortcutEntry>): MenuShortcutEntry {
  return {
    commandId: "Always on Top",
    label: "窗口置顶",
    domain: "window",
    combo: "",
    source: "default",
    ...overrides,
  };
}

/** 经 jsdom 派发真实 keydown（走 window 监听链路，非直呼回调） */
function pressKey(init: {
  key: string;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  defaultPrevented?: boolean;
}): void {
  const event = new KeyboardEvent("keydown", {
    key: init.key,
    ctrlKey: init.ctrlKey ?? false,
    shiftKey: init.shiftKey ?? false,
    altKey: init.altKey ?? false,
    bubbles: true,
    cancelable: true,
  });
  if (init.defaultPrevented) {
    event.preventDefault();
  }
  window.dispatchEvent(event);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("matchesShortcutEvent：canonical 键名与事件匹配", () => {
  it("Mod-Shift-p 命中 Ctrl+Shift+P（Shift 参与时 event.key 为大写，字母归一比对）", () => {
    const event = new KeyboardEvent("keydown", { key: "P", ctrlKey: true, shiftKey: true });
    expect(matchesShortcutEvent(event, "Mod-Shift-p")).toBe(true);
  });

  it("修饰位不齐不命中：Ctrl+P 不触发 Mod-Shift-p（防单 Ctrl 误触）", () => {
    const event = new KeyboardEvent("keydown", { key: "p", ctrlKey: true });
    expect(matchesShortcutEvent(event, "Mod-Shift-p")).toBe(false);
  });

  it("无 Ctrl canonical 与事件修饰缺失双向不命中（needCtrl false 分支）", () => {
    // canonical 无 Mod 段（Shift 单修饰形态，parse 层不产出，纯函数防御面）
    expect(
      matchesShortcutEvent(new KeyboardEvent("keydown", { key: "p", shiftKey: true }), "Shift-p"),
    ).toBe(true);
    expect(matchesShortcutEvent(new KeyboardEvent("keydown", { key: "p" }), "Shift-p")).toBe(false);
    expect(
      matchesShortcutEvent(new KeyboardEvent("keydown", { key: "p", ctrlKey: true }), "Shift-p"),
    ).toBe(false);
  });

  it("Alt 修饰段命中与缺失（needAlt 双分支）", () => {
    expect(
      matchesShortcutEvent(
        new KeyboardEvent("keydown", { key: "1", ctrlKey: true, altKey: true }),
        "Mod-Alt-1",
      ),
    ).toBe(true);
    expect(
      matchesShortcutEvent(new KeyboardEvent("keydown", { key: "1", ctrlKey: true }), "Mod-Alt-1"),
    ).toBe(false);
  });

  it("多余修饰不命中：Ctrl+Alt+P 不触发 Mod-Shift-p（修饰集精确比对）", () => {
    const event = new KeyboardEvent("keydown", {
      key: "P",
      ctrlKey: true,
      shiftKey: true,
      altKey: true,
    });
    expect(matchesShortcutEvent(event, "Mod-Shift-p")).toBe(false);
  });

  it("具名主键原样比对：Mod-F12 命中 F12、不命中 F11（canonical 事件键名口径）", () => {
    expect(
      matchesShortcutEvent(new KeyboardEvent("keydown", { key: "F12", ctrlKey: true }), "Mod-F12"),
    ).toBe(true);
    expect(
      matchesShortcutEvent(new KeyboardEvent("keydown", { key: "F11", ctrlKey: true }), "Mod-F12"),
    ).toBe(false);
  });

  it("符号主键原样比对：Mod-- 命中 Ctrl+-（负号主键 canonical 形态无 split 陷阱）", () => {
    expect(
      matchesShortcutEvent(new KeyboardEvent("keydown", { key: "-", ctrlKey: true }), "Mod--"),
    ).toBe(true);
  });
});

describe("registerWindowKeybindingShortcuts：注册与执行", () => {
  it("窗口域 custom 条目按键触发命令映射（10#1 主链路：Ctrl+Shift+P → 置顶命令）", () => {
    const run = vi.fn();
    const cleanup = registerWindowKeybindingShortcuts(
      [entry({ source: "custom", combo: "Ctrl+Shift+P" })],
      run,
    );
    pressKey({ key: "P", ctrlKey: true, shiftKey: true });
    expect(run).toHaveBeenCalledExactlyOnceWith("Always on Top");
    cleanup();
  });

  it("default 条目不注册：默认组合由既有窗口快捷键服务负责，按键不产生执行", () => {
    const run = vi.fn();
    const cleanup = registerWindowKeybindingShortcuts(
      [entry({ commandId: "New Tab", combo: "Ctrl+N", source: "default" })],
      run,
    );
    pressKey({ key: "n", ctrlKey: true });
    expect(run).not.toHaveBeenCalled();
    cleanup();
  });

  it("editor 域条目不注册（执行通路归 01 keymap 注入，本服务只接窗口域）", () => {
    const run = vi.fn();
    const cleanup = registerWindowKeybindingShortcuts(
      [entry({ commandId: "Bold", domain: "editor", source: "custom", combo: "Ctrl+J" })],
      run,
    );
    pressKey({ key: "j", ctrlKey: true });
    expect(run).not.toHaveBeenCalled();
    cleanup();
  });

  it("触发后 preventDefault 拦截默认行为并短路（同键多绑定不重复执行）", () => {
    const run = vi.fn();
    const cleanup = registerWindowKeybindingShortcuts(
      [entry({ source: "custom", combo: "Ctrl+Shift+P" })],
      run,
    );
    const event = new KeyboardEvent("keydown", {
      key: "P",
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(run).toHaveBeenCalledOnce();
    cleanup();
  });

  it("defaultPrevented 守卫：编辑器 keymap 已消费的按键不重复触发（TASK 10#3 同款）", () => {
    const run = vi.fn();
    const cleanup = registerWindowKeybindingShortcuts(
      [entry({ source: "custom", combo: "Ctrl+Shift+P" })],
      run,
    );
    pressKey({ key: "P", ctrlKey: true, shiftKey: true, defaultPrevented: true });
    expect(run).not.toHaveBeenCalled();
    cleanup();
  });

  it("注销后按键不再触发（重注册模型的旧集收口）", () => {
    const run = vi.fn();
    const cleanup = registerWindowKeybindingShortcuts(
      [entry({ source: "custom", combo: "Ctrl+Shift+P" })],
      run,
    );
    cleanup();
    pressKey({ key: "P", ctrlKey: true, shiftKey: true });
    expect(run).not.toHaveBeenCalled();
  });

  it("未绑定的按键不触发任何命令（注册集内组合不匹配即忽略）", () => {
    const run = vi.fn();
    const cleanup = registerWindowKeybindingShortcuts(
      [entry({ source: "custom", combo: "Ctrl+Shift+P" })],
      run,
    );
    pressKey({ key: "k", ctrlKey: true, shiftKey: true });
    pressKey({ key: "P", ctrlKey: true });
    expect(run).not.toHaveBeenCalled();
    cleanup();
  });

  it("重注册不泄漏：旧集注销 + 新集生效，同组合仅执行一次（配置变化重注册语义）", () => {
    const run = vi.fn();
    const first = registerWindowKeybindingShortcuts(
      [entry({ source: "custom", combo: "Ctrl+Shift+P" })],
      run,
    );
    first();
    const second = registerWindowKeybindingShortcuts(
      [entry({ source: "custom", combo: "Ctrl+Shift+P" })],
      run,
    );
    pressKey({ key: "P", ctrlKey: true, shiftKey: true });
    expect(run).toHaveBeenCalledExactlyOnceWith("Always on Top");
    second();
  });

  it("空条目集返回安全注销函数（启动装载前 entries 全 default 的空闲形态）", () => {
    const cleanup = registerWindowKeybindingShortcuts([], vi.fn());
    expect(() => cleanup()).not.toThrow();
  });
});

describe("registerWindowKeybindingShortcuts：非法面告警跳过（AC-C1-4 口径）", () => {
  it("窗口保留组合告警跳过（custom 与既有窗口快捷键同键会双重执行，如 New Tab=Ctrl+N）", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const run = vi.fn();
    const cleanup = registerWindowKeybindingShortcuts(
      [entry({ commandId: "New Tab", combo: "Ctrl+N", source: "custom" })],
      run,
    );
    pressKey({ key: "n", ctrlKey: true });
    expect(run).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Ctrl+N"));
    cleanup();
  });

  it("非法组合告警跳过（无 Ctrl 修饰等 parseShortcutCombo 拒绝面）", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const cleanup = registerWindowKeybindingShortcuts(
      [entry({ source: "custom", combo: "Shift+P" })],
      vi.fn(),
    );
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Shift+P"));
    cleanup();
  });

  it("映射表外命令告警跳过（catalog 扩展先于执行映射落地的过渡形态）", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const cleanup = registerWindowKeybindingShortcuts(
      [entry({ commandId: "Unknown Command", source: "custom", combo: "Ctrl+Shift+P" })],
      vi.fn(),
    );
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Unknown Command"));
    cleanup();
  });
});
