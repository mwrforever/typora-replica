// keyBinding 装配服务测试（注入编排 / 非法告警忽略 / 同键去重 / 菜单展示数据合并）
import { beforeEach, describe, expect, it, vi } from "vitest";

const warnSpy = vi.fn();
vi.spyOn(console, "warn").mockImplementation((...a: unknown[]) => warnSpy(...a));

// 01 域注入以真实 keymaps.ts 模块消费（registry 可观测）；不 mock——注入真实落注册表
import { applyKeyBindings, getMenuShortcutEntries } from "./shortcut-binding";
import { listEditorKeymaps } from "../editor/keymaps";

describe("applyKeyBindings 启动注入（AC-C1-2/3/4）", () => {
  beforeEach(() => {
    warnSpy.mockClear();
  });

  it("编辑器域命令注入 01 注册表（priority 300）", () => {
    const before = listEditorKeymaps().length;
    applyKeyBindings({ "Code Fences": "Ctrl+Alt+K" });
    const entry = listEditorKeymaps().at(-1)!;
    expect(listEditorKeymaps().length).toBe(before + 1);
    expect(entry.priority).toBe(300);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("AC-C1-4 非法组合告警忽略不崩溃", () => {
    applyKeyBindings({ Bold: "Shift+B" });
    expect(listEditorKeymaps().some((e) => e.key === "Shift-b" || e.key === "b")).toBe(false);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("非法快捷键"));
  });

  it("窗口域/目录外命令告警忽略（执行接线归 12，披露 1）", () => {
    applyKeyBindings({ "Always on Top": "Ctrl+Shift+P" });
    expect(listEditorKeymaps().some((e) => e.key === "Mod-Shift-p" && e.priority === 300)).toBe(
      false,
    );
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Always on Top"));
  });

  it("窗口保留组合专门告警（与窗口快捷键冲突文案区分于非法组合，M-1②）且不注入", () => {
    applyKeyBindings({ Bold: "Ctrl+S" });
    expect(listEditorKeymaps().some((e) => e.key === "Mod-s" && e.priority === 300)).toBe(false);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("窗口快捷键冲突"));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Bold"));
  });

  it("同键多命令去重：后配置覆盖先配置（registry 无注销机制，注入前收敛）", () => {
    applyKeyBindings({ Bold: "Ctrl+J", Italic: "Ctrl+J" });
    const bound = listEditorKeymaps().filter((e) => e.key === "Mod-j" && e.priority === 300);
    expect(bound).toHaveLength(1);
  });

  it("同键多命令去重时被淘汰的先配置命令补告警（含 commandId 与 pmKey，Low-5）", () => {
    applyKeyBindings({ Bold: "Ctrl+J", Italic: "Ctrl+J" });
    // 仅保留后配置的 Italic；被淘汰的 Bold 必须可诊断（此前为静默丢弃）
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Mod-j"));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Bold"));
  });

  it("空 keyBinding 零注入零告警（未配置场景）", () => {
    const before = listEditorKeymaps().length;
    applyKeyBindings({});
    expect(listEditorKeymaps().length).toBe(before);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

describe("getMenuShortcutEntries 菜单展示数据（AC-C1-1 接口面）", () => {
  it("默认表全量返回（默认组合 + source=default）", () => {
    const entries = getMenuShortcutEntries({});
    expect(entries.length).toBeGreaterThanOrEqual(14);
    const heading1 = entries.find((e) => e.commandId === "Heading 1")!;
    expect(heading1.combo).toBe("Ctrl+1");
    expect(heading1.source).toBe("default");
    expect(heading1.domain).toBe("editor");
  });

  it("keyBinding 覆盖后 combo 替换且 source=custom（12 菜单据此渲染）", () => {
    const entries = getMenuShortcutEntries({ "Always on Top": "Ctrl+Shift+P" });
    const alwaysOnTop = entries.find((e) => e.commandId === "Always on Top")!;
    expect(alwaysOnTop.combo).toBe("Ctrl+Shift+P");
    expect(alwaysOnTop.source).toBe("custom");
    expect(alwaysOnTop.domain).toBe("window");
  });

  it("无默认快捷键的窗口命令未配置时 combo 为空串（12 侧不渲染快捷键段）", () => {
    const entries = getMenuShortcutEntries({});
    expect(entries.find((e) => e.commandId === "Always on Top")!.combo).toBe("");
  });
});

// 启动时序契约（AC-C1-2 重启生效的装配评审锚点）：App.vue onMounted 中
// 「await settingsStore.load() → applyKeyBindings(...) → 启动决策 → tabs.createUntitled()」
// 四行顺序保证双层装载与 keyBinding 注入先于首标签编辑器 create()（applyEditorKeymaps
// 在 config 阶段消费注册表）——纯函数面无可断言的 App 时序，装配顺序由代码评审 +
// E2E 冒烟兜底；此处可断言面为注入幂等性（装载链路重放不得叠加注册）。
describe("启动时序契约（装配评审锚点）", () => {
  it("applyKeyBindings 幂等性：重复调用不产生重复注册（同键去重收敛）", () => {
    const countOf = (key: string) =>
      listEditorKeymaps().filter((e) => e.key === key && e.priority === 300).length;
    applyKeyBindings({ Bold: "Ctrl+J" });
    applyKeyBindings({ Bold: "Ctrl+J" });
    expect(countOf("Mod-j")).toBe(1);
  });
});
