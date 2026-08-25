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

  it("outline.collapsible 默认回落 false，updateSettings 深合并写回", async () => {
    // 无存储键（beforeEach 已清空）→ outline 组逐字段回落默认值（AC-F22-1 默认 Flat）
    const loaded = await loadSettings();
    expect(loaded.outline.collapsible).toBe(false);
    await updateSettings({ outline: { collapsible: true } });
    // 深合并后整组写回独立键 outline（与 loadSettings 的读取键对称）
    expect(memory.get("outline")).toEqual({ collapsible: true });
    const reloaded = await loadSettings();
    expect(reloaded.outline.collapsible).toBe(true); // 存量命中路径（非回落分支）
  });

  it("outline 增量 patch 类型收口：仅传部分字段可编译且深合并保持存量", async () => {
    memory.set("outline", { collapsible: true });
    // 类型层回归钉（Task 8 收口）：patch.outline 须为纯 Partial——旧签名把 outline
    // 排除在 Omit 外（交集 OutlineSettings & Partial<OutlineSettings> 使 collapsible
    // 恒必填），下方显式类型声明在旧签名下无法通过 vue-tsc 编译
    const patch: Parameters<typeof updateSettings>[0] = { outline: {} };
    const s = await updateSettings(patch);
    expect(s.outline.collapsible).toBe(true); // 空 patch 深合并保持存量值
    expect(memory.get("outline")).toEqual({ collapsible: true }); // 写回不丢存量
  });

  it("image 组缺失键逐层回落默认（四开关全关+目标目录空）", async () => {
    // 无存储键（beforeEach 已清空）→ image 组逐字段回落默认值：
    // 四开关全关对齐 Typora 用户实测（AC-F23：不改变用户既有插入习惯）
    const s = await loadSettings();
    expect(s.image).toEqual(DEFAULT_SETTINGS.image);
    // 逐字段钉死五项默认，防止 toEqual 对 undefined 键的宽容造成静默漏字段
    expect(s.image.copyToFolderEnabled).toBe(false);
    expect(s.image.copyTargetDir).toBe("");
    expect(s.image.relativePathEnabled).toBe(false);
    expect(s.image.dotSlashPrefixEnabled).toBe(false);
    expect(s.image.urlEscapeEnabled).toBe(false);
  });

  it("updateSettings 增量合并 image 字段且不影响其他组", async () => {
    // 只开 copy to folder 总开关（单字段增量）——其余四字段回落当前值，
    // autoSave 等其他组不被波及；整组写回独立键 image（与 loadSettings 读取键对称）
    const s = await updateSettings({ image: { copyToFolderEnabled: true } });
    expect(s.image.copyToFolderEnabled).toBe(true);
    expect(s.image.relativePathEnabled).toBe(false); // 未触及键保持默认关
    expect(s.autoSave.enabled).toBe(true); // 其他组不受影响
    const reloaded = await loadSettings();
    expect(reloaded.image).toEqual({ ...DEFAULT_SETTINGS.image, copyToFolderEnabled: true }); // 已写回 store
  });
});
