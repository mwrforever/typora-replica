// 原生菜单 IPC 封装测试（@tauri-apps/api menu 交互收敛；核心服务 100%）
//
// mock @tauri-apps/api 的 menu/core/window 三个通道：捕获 Menu.new 收到的选项树、
// setAsWindowMenu 挂载调用与 invoke 命令参数；action 回调以直调方式验证路由闭环。
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  menuNew: vi.fn(),
  setAsWindowMenu: vi.fn(),
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/menu", () => ({
  Menu: {
    new: (opts: unknown) => {
      mocks.menuNew(opts);
      return Promise.resolve({ setAsWindowMenu: mocks.setAsWindowMenu });
    },
  },
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ label: "main" }),
}));

import { setNativeMenuVisible, setWindowMenu } from "./menu-io";
import type { MenuNode } from "./menu-io";

describe("setWindowMenu（菜单树 → Tauri Menu 挂载）", () => {
  beforeEach(() => {
    mocks.menuNew.mockClear();
    mocks.setAsWindowMenu.mockClear();
  });

  it("全树形转换：子菜单/项/勾选项/分隔线/预定义项逐类映射", async () => {
    const tree: MenuNode[] = [
      {
        kind: "submenu",
        id: "menu.file",
        label: "文件",
        items: [
          { kind: "item", id: "file.save", label: "保存\tCtrl+S", enabled: true },
          { kind: "item", id: "file.print", label: "打印", enabled: false },
          {
            kind: "check-item",
            id: "themes.select.dark",
            label: "暗色",
            enabled: true,
            checked: true,
          },
          { kind: "separator" },
          { kind: "predefined", item: "Cut", label: "剪切" },
          { kind: "predefined", item: "Copy" },
        ],
      },
    ];
    await setWindowMenu(tree, () => undefined);
    expect(mocks.menuNew).toHaveBeenCalledWith({
      items: [
        {
          id: "menu.file",
          text: "文件",
          items: [
            {
              id: "file.save",
              text: "保存\tCtrl+S",
              enabled: true,
              action: expect.any(Function),
            },
            {
              id: "file.print",
              text: "打印",
              enabled: false,
              action: expect.any(Function),
            },
            {
              id: "themes.select.dark",
              text: "暗色",
              enabled: true,
              checked: true,
              action: expect.any(Function),
            },
            { item: "Separator" },
            { item: "Cut", text: "剪切" },
            // 无 label 的预定义项不携带 text 键（用系统默认文案）
            { item: "Copy" },
          ],
        },
      ],
    });
  });

  it("菜单项 action 携 id 回传 onAction（menuRouter 派发闭环）", async () => {
    const onAction = vi.fn();
    const tree: MenuNode[] = [
      { kind: "item", id: "file.new", label: "新建", enabled: true },
      {
        kind: "check-item",
        id: "themes.select.light",
        label: "亮色",
        enabled: true,
        checked: false,
      },
    ];
    await setWindowMenu(tree, onAction);
    const options = mocks.menuNew.mock.calls[0]![0] as {
      items: Array<{ action: (id: string) => void }>;
    };
    options.items[0]!.action("file.new");
    options.items[1]!.action("themes.select.light");
    expect(onAction).toHaveBeenNthCalledWith(1, "file.new");
    expect(onAction).toHaveBeenNthCalledWith(2, "themes.select.light");
  });

  it("菜单项一律不设原生 accelerator（抢键红线）", async () => {
    const tree: MenuNode[] = [
      { kind: "item", id: "file.save", label: "保存\tCtrl+S", enabled: true },
    ];
    await setWindowMenu(tree, () => undefined);
    const payload = JSON.stringify(mocks.menuNew.mock.calls[0]![0]);
    expect(payload).not.toContain("accelerator");
  });

  it("挂载经 setAsWindowMenu 绑定当前窗口（返回 Menu 实例）", async () => {
    const menu = await setWindowMenu([], () => undefined);
    expect(mocks.setAsWindowMenu).toHaveBeenCalledWith({ label: "main" });
    expect(menu).toEqual({ setAsWindowMenu: mocks.setAsWindowMenu });
  });
});

describe("setNativeMenuVisible（AC-M-5 显隐切换 IPC）", () => {
  beforeEach(() => {
    mocks.invoke.mockClear();
  });

  it("true/false 分别以 visible 参数调用 set_native_menu_visible 命令", async () => {
    mocks.invoke.mockResolvedValue(undefined);
    await setNativeMenuVisible(true);
    expect(mocks.invoke).toHaveBeenCalledWith("set_native_menu_visible", { visible: true });
    await setNativeMenuVisible(false);
    expect(mocks.invoke).toHaveBeenCalledWith("set_native_menu_visible", { visible: false });
  });

  it("Rust 命令 reject 时异常上抛（调用方记录告警）", async () => {
    mocks.invoke.mockRejectedValue(new Error("菜单栏显隐切换失败: 平台错误"));
    await expect(setNativeMenuVisible(true)).rejects.toThrow("平台错误");
  });
});
