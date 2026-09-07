// 设置快照 store 测试（合并快照唯一入口 / 失效事件广播 / write-through / Reset / 开合）
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

// store 插件内存 mock（settings.spec.ts 同构；loadSettings 桩恒回默认值——本文件用例
// 只断言 updateSettings 写入 memory 的持久化面，不依赖读回路径）
const memory = vi.hoisted(() => new Map<string, unknown>());
vi.mock("../../services/settings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../services/settings")>();
  return {
    ...actual,
    loadSettings: vi.fn(async () => ({ ...actual.DEFAULT_SETTINGS })),
    updateSettings: vi.fn(async (patch: Record<string, unknown>) => {
      for (const [k, v] of Object.entries(patch)) memory.set(k, v);
      return { ...actual.DEFAULT_SETTINGS, ...patch };
    }),
  };
});
const readAdvancedMock = vi.hoisted(() => vi.fn());
const writeAdvancedMock = vi.hoisted(() => vi.fn(async () => undefined));
const resetAdvancedMock = vi.hoisted(() => vi.fn(async () => undefined));
const openAdvancedMock = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("../../services/advanced-settings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../services/advanced-settings")>();
  return {
    ...actual,
    readAdvancedSettings: readAdvancedMock,
    writeAdvancedSetting: writeAdvancedMock,
    resetAdvancedSettings: resetAdvancedMock,
    openAdvancedSettings: openAdvancedMock,
  };
});

import { useSettingsStore } from "./settings-store";
import { DEFAULT_SETTINGS } from "../../services/settings";

describe("useSettingsStore 装载与合并快照", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    memory.clear();
    readAdvancedMock.mockReset();
  });

  it("load 并行装载双层设置（GUI + conf.user.json）", async () => {
    readAdvancedMock.mockResolvedValueOnce({
      ...advancedSettingsStub(),
      autoSaveTimer: 10,
    });
    const store = useSettingsStore();
    expect(store.gui).toBeUndefined();
    await store.load();
    expect(store.gui?.launch.mode).toBe(DEFAULT_SETTINGS.launch.mode);
    expect(store.advanced?.autoSaveTimer).toBe(10);
    expect(store.advancedError).toBeUndefined();
  });

  it("merged 合并快照：conf.user.json autoSaveTimer 覆盖面板间隔（手改文件重启后生效口径）", async () => {
    readAdvancedMock.mockResolvedValueOnce({
      ...advancedSettingsStub(),
      autoSaveTimer: 10,
    });
    const store = useSettingsStore();
    await store.load();
    expect(store.merged.autoSave.timerMinutes).toBe(10); // 高级覆盖
    expect(store.merged.autoSave.enabled).toBe(true); // 其余字段取面板值
  });

  it("高级读取失败不阻断：回退默认高级值 + advancedError 提示（合并回退面板值）", async () => {
    // 静默降级告警（load 失败回退路径的 console.warn 不进测试输出，保持输出整洁）
    vi.spyOn(console, "warn").mockImplementation(() => {});
    readAdvancedMock.mockRejectedValueOnce(
      new Error("conf.user.json 不是合法 JSON（已保留原文件）"),
    );
    const store = useSettingsStore();
    await store.load();
    expect(store.advancedError).toContain("已保留原文件");
    expect(store.advanced?.autoSaveTimer).toBe(5); // DEFAULT_ADVANCED_SETTINGS
    expect(store.merged.autoSave.timerMinutes).toBe(5);
  });

  it("未装载时 merged 回落 DEFAULT_SETTINGS（消费方启动窗口期安全）", () => {
    const store = useSettingsStore();
    expect(store.merged).toEqual(DEFAULT_SETTINGS);
  });
});

describe("useSettingsStore 变更与事件广播", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    memory.clear();
    readAdvancedMock.mockReset();
    readAdvancedMock.mockResolvedValue({
      ...advancedSettingsStub(),
      autoSaveTimer: 5,
    });
  });

  it("updateGui 深合并写回 + gui 快照更新 + 广播失效事件（07 图片快照刷新契约）", async () => {
    const spy = vi.fn();
    window.addEventListener("markwell-settings-updated", spy);
    const store = useSettingsStore();
    await store.load();
    await store.updateGui({ outline: { collapsible: true } });
    expect(store.gui?.outline.collapsible).toBe(true);
    expect(spy).toHaveBeenCalledOnce();
    window.removeEventListener("markwell-settings-updated", spy);
  });

  it("updateAutoSaveTimer write-through：先写 conf autoSaveTimer 再写面板 autoSave（顺序钉死）", async () => {
    const store = useSettingsStore();
    await store.load();
    await store.updateAutoSaveTimer(15);
    expect(writeAdvancedMock).toHaveBeenCalledWith("autoSaveTimer", 15);
    expect(memory.get("autoSave")).toMatchObject({ timerMinutes: 15 });
    expect(store.merged.autoSave.timerMinutes).toBe(15);
  });

  it("未装载窗口期 updateAutoSaveTimer 不崩溃：conf 写入落盘且 merged 直取面板值", async () => {
    // 边界：load 前调用（装配时序外的防御路径）——advanced 未装载时 merged 走 gui 面，
    // 面板值仍写回持久层，不因高级快照缺失而中断
    const store = useSettingsStore();
    await store.updateAutoSaveTimer(15);
    expect(writeAdvancedMock).toHaveBeenCalledWith("autoSaveTimer", 15);
    expect(store.merged.autoSave.timerMinutes).toBe(15);
  });

  it("conf 写入失败时 updateAutoSaveTimer 上抛且面板值不写（双层一致性优先）", async () => {
    writeAdvancedMock.mockRejectedValueOnce(new Error("写入失败"));
    const store = useSettingsStore();
    await store.load();
    await expect(store.updateAutoSaveTimer(15)).rejects.toThrow("写入失败");
    expect(memory.get("autoSave")).toBeUndefined();
  });

  it("resetAdvanced 调用重置命令 + 高级快照回默认 + 广播失效", async () => {
    const spy = vi.fn();
    window.addEventListener("markwell-settings-updated", spy);
    const store = useSettingsStore();
    await store.load();
    await store.resetAdvanced();
    expect(resetAdvancedMock).toHaveBeenCalledOnce();
    expect(store.advanced?.autoHideMenuBar).toBe(false);
    expect(spy).toHaveBeenCalledOnce();
    window.removeEventListener("markwell-settings-updated", spy);
  });

  it("openConfFile 调用打开命令（12.6 入口）", async () => {
    const store = useSettingsStore();
    await store.openConfFile();
    expect(openAdvancedMock).toHaveBeenCalledOnce();
  });
});

describe("useSettingsStore 面板开合", () => {
  beforeEach(() => setActivePinia(createPinia()));

  it("open/close/togglePanel 状态机；首次打开触发 load，再次开关不重复装载", async () => {
    readAdvancedMock.mockResolvedValue({
      ...advancedSettingsStub(),
      autoSaveTimer: 5,
    });
    const store = useSettingsStore();
    store.togglePanel();
    expect(store.visible).toBe(true);
    await vi.waitFor(() => expect(store.gui).toBeDefined()); // 异步 load 完成
    store.togglePanel(); // 关闭
    expect(store.visible).toBe(false);
    store.togglePanel(); // 再开：loaded 已就绪不重复读
    expect(store.visible).toBe(true);
    expect(readAdvancedMock).toHaveBeenCalledOnce();
    store.close();
    expect(store.visible).toBe(false);
  });
});

/** 高级设置测试桩（默认值形状；用例按需覆盖 autoSaveTimer 等字段） */
function advancedSettingsStub(): Record<string, unknown> {
  return {
    defaultFontFamily: {},
    autoHideMenuBar: false,
    searchService: [],
    monocolorEmoji: false,
    flags: {},
    keyBinding: {},
  };
}
