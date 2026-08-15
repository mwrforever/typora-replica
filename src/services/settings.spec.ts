// settings：偏好设置（store 插件持久化）单元测试（隔离 Tauri 运行时，100% 覆盖）
import { beforeEach, describe, expect, it, vi } from "vitest";

// mock store 插件：内存 Map 模拟持久化。
// 注意：memory 必须经 vi.hoisted 创建——vi.mock 工厂在模块导入阶段（spec 顶层
// const 求值之前）即被调用，若引用普通顶层 const 会触发 TDZ 错误（vitest 已知约束）
const memory = vi.hoisted(() => new Map<string, unknown>());
vi.mock("@tauri-apps/plugin-store", () => ({
  load: vi.fn(async () => ({
    get: async (key: string) => memory.get(key),
    set: async (key: string, value: unknown) => {
      memory.set(key, value);
    },
  })),
}));

import { loadSettings, updateSettings, DEFAULT_SETTINGS } from "./settings";

describe("偏好设置（store 持久化）", () => {
  beforeEach(() => {
    memory.clear();
  });

  it("无存量配置时回落默认值（自动保存默认开）", async () => {
    const s = await loadSettings();
    expect(s.autoSave.enabled).toBe(true);
    expect(s.autoSave.timerMinutes).toBe(5);
    expect(s.defaultLineEnding).toBe("lf");
    expect(s.launch.mode).toBe("restore-folder");
    // 与 DEFAULT_SETTINGS 基准完全一致（toEqual 忽略 undefined 键）
    expect(s).toEqual(DEFAULT_SETTINGS);
  });

  it("存量配置部分缺失时逐键回落默认", async () => {
    memory.set("autoSave", { enabled: false, timerMinutes: 3 });
    const s = await loadSettings();
    expect(s.autoSave.enabled).toBe(false);
    expect(s.autoSave.timerMinutes).toBe(3);
    expect(s.defaultLineEnding).toBe("lf"); // 缺失键回落
  });

  it("launch 存量完整时逐字段读取（custom-folder 模式全量）", async () => {
    memory.set("launch", {
      mode: "custom-folder",
      customPath: "C:/docs",
      lastFolder: "C:/docs",
      lastFile: "C:/docs/a.md",
    });
    const s = await loadSettings();
    expect(s.launch.mode).toBe("custom-folder");
    expect(s.launch.customPath).toBe("C:/docs");
    expect(s.launch.lastFolder).toBe("C:/docs");
    expect(s.launch.lastFile).toBe("C:/docs/a.md");
  });

  it("updateSettings 深合并并写回", async () => {
    const s1 = await updateSettings({ defaultLineEnding: "crlf" });
    expect(s1.defaultLineEnding).toBe("crlf");
    expect(s1.autoSave.enabled).toBe(true); // 未触及键保持
    const s2 = await loadSettings();
    expect(s2.defaultLineEnding).toBe("crlf");
  });

  it("updateSettings 未触及 defaultLineEnding 时回落当前值", async () => {
    const s = await updateSettings({ autoSave: { enabled: false, timerMinutes: 2 } });
    expect(s.autoSave.enabled).toBe(false);
    expect(s.autoSave.timerMinutes).toBe(2);
    expect(s.defaultLineEnding).toBe("lf"); // patch 未含该键 → 保持默认
    const reloaded = await loadSettings();
    expect(reloaded.autoSave.enabled).toBe(false); // 已写回 store
  });
});
