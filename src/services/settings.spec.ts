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
    // 四开关全关对齐 Typora 用户实测（07 spec P2/P3：不改变用户既有插入习惯）
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

  it("theme 组缺失键逐层回落默认（亮暗各内置主题名）", async () => {
    // 无存储键（beforeEach 已清空）→ theme 组逐字段回落默认值：
    // 默认名与 Rust BUILT_IN_THEMES 预置文件同名，首启即可解析到主题
    const s = await loadSettings();
    expect(s.theme).toEqual(DEFAULT_SETTINGS.theme);
    expect(s.theme.lightTheme).toBe("markwell-light");
    expect(s.theme.darkTheme).toBe("markwell-dark");
  });

  it("updateSettings 增量合并 theme 字段且不影响其他组", async () => {
    const s = await updateSettings({ theme: { lightTheme: "solar-mint" } });
    expect(s.theme.lightTheme).toBe("solar-mint");
    expect(s.theme.darkTheme).toBe("markwell-dark"); // 未触及键保持
    expect(s.autoSave.enabled).toBe(true); // 其他组不受影响
    const reloaded = await loadSettings();
    expect(reloaded.theme).toEqual({ lightTheme: "solar-mint", darkTheme: "markwell-dark" }); // 整组写回独立键 theme
  });

  it("export 组缺失键逐层回落默认（位置 auto/大纲关/页眉页脚空/h1 分页关）", async () => {
    // 无存储键（beforeEach 已清空）→ export 组逐字段回落默认值：
    // 默认关闭 Include Outline 与 h1 分页（不改变用户最小导出预期，09 spec）
    const s = await loadSettings();
    expect(s.export).toEqual({
      locationMode: "auto",
      customDir: "",
      includeOutline: false,
      pdfHeader: "",
      pdfFooter: "",
      pdfPageBreakH1: false,
      yamlOverrides: false,
      htmlAppendHeadBody: false,
      htmlThemeOverride: "",
      pdfMarginIn: 0.4,
    });
  });

  it("updateSettings 增量合并 export 字段且部分补丁语义保持（未触及键不丢）", async () => {
    // 只改位置模式与自定义目录（单组增量）——includeOutline 等未触及键回落当前默认关，
    // 不要求调用方整组传入；整组写回独立键 export（与 loadSettings 读取键对称）
    const s = await updateSettings({ export: { locationMode: "custom", customDir: "D:/out" } });
    expect(s.export.locationMode).toBe("custom");
    expect(s.export.customDir).toBe("D:/out");
    expect(s.export.includeOutline).toBe(false); // 部分补丁：未触及键保持默认关
    const reloaded = await loadSettings();
    expect(reloaded.export).toEqual({
      locationMode: "custom",
      customDir: "D:/out",
      includeOutline: false,
      pdfHeader: "",
      pdfFooter: "",
      pdfPageBreakH1: false,
      yamlOverrides: false,
      htmlAppendHeadBody: false,
      htmlThemeOverride: "",
      pdfMarginIn: 0.4,
    }); // 已写回 store
  });

  // ── 10 设置面板新键组（12.1-12.5 全集存储面）──

  it("appearance 组缺失键逐层回落默认（状态栏开/字号跟随主题/阅读速度 200/打字机点击居中开）", async () => {
    // 无存储键（beforeEach 已清空）→ appearance 组逐字段回落默认值
    const s = await loadSettings();
    // 逐字段钉死默认（toEqual 对 undefined 宽容，防静默漏字段）
    expect(s.appearance.showStatusBar).toBe(true);
    expect(s.appearance.fontSize).toBeUndefined(); // 跟随主题
    expect(s.appearance.readingSpeed).toBe(200);
    expect(s.appearance.typewriterClickCenter).toBe(true); // 官方默认（12 W5 AC-M-12）
  });

  it("appearance 字号设置后持久化保留（undefined 与数值双形态往返）", async () => {
    // 增量补丁只传 fontSize 与 readingSpeed——showStatusBar 未触及，深合并保持默认开
    await updateSettings({ appearance: { fontSize: 18, readingSpeed: 250 } });
    const reloaded = await loadSettings();
    expect(reloaded.appearance.fontSize).toBe(18);
    expect(reloaded.appearance.readingSpeed).toBe(250);
    expect(reloaded.appearance.showStatusBar).toBe(true); // 未触及键保持
  });

  it("打字机点击居中偏好关闭态持久化往返（12 W5 偏好存储面，AC-M-12）", async () => {
    await updateSettings({ appearance: { typewriterClickCenter: false } });
    const reloaded = await loadSettings();
    expect(reloaded.appearance.typewriterClickCenter).toBe(false);
  });

  it("editor 组默认全开（auto pair 括号与 Markdown 语法，01 实测口径）", async () => {
    const s = await loadSettings();
    expect(s.editor.autoPairBrackets).toBe(true);
    expect(s.editor.autoPairMarkdown).toBe(true);
  });

  it("markdown 组默认全关 + codeFence 子组六项默认（调研 §6 自定口径）", async () => {
    const s = await loadSettings();
    expect(s.markdown.inlineMath).toBe(false);
    expect(s.markdown.diagrams).toBe(false);
    expect(s.markdown.strictMode).toBe(false);
    expect(s.markdown.highlight).toBe(false);
    expect(s.markdown.superscript).toBe(false);
    expect(s.markdown.subscript).toBe(false);
    expect(s.markdown.spellcheck).toBe(false);
    expect(s.markdown.codeFence).toEqual({
      lineNumbers: false,
      wrapLongLines: false,
      shiftTabIndent: true,
      indentWidth: 4,
      defaultLanguage: "",
      useLastUsedLanguage: true,
    });
  });

  it("image.insertBehavior 默认仅本地（12.4 插入时行为）", async () => {
    const s = await loadSettings();
    expect(s.image.insertBehavior).toBe("local-only");
    await updateSettings({ image: { insertBehavior: "all" } });
    const reloaded = await loadSettings();
    expect(reloaded.image.insertBehavior).toBe("all");
    expect(reloaded.image.copyToFolderEnabled).toBe(false); // 既有键不受波及
  });

  it("export 预留键默认值（YAML 覆盖关/head-body 关/主题空/边距 0.4）", async () => {
    const s = await loadSettings();
    expect(s.export.yamlOverrides).toBe(false);
    expect(s.export.htmlAppendHeadBody).toBe(false);
    expect(s.export.htmlThemeOverride).toBe("");
    expect(s.export.pdfMarginIn).toBe(0.4);
  });

  it("updateSettings 增量合并 markdown.codeFence 单字段且不影响其他组", async () => {
    // 只改缩进宽度（codeFence 子组单字段增量）——同组其余键与 inlineMath 等未触及键保持，
    // export 等其他组不受影响；codeFence 需嵌套深合并（浅合并会整组覆盖丢失 lineNumbers）
    const s = await updateSettings({ markdown: { codeFence: { indentWidth: 2 } } });
    expect(s.markdown.codeFence.indentWidth).toBe(2);
    expect(s.markdown.codeFence.lineNumbers).toBe(false); // 组内未触及键保持
    expect(s.markdown.inlineMath).toBe(false);
    expect(s.export.includeOutline).toBe(false); // 其他组不受影响
  });

  it("layout 组默认侧栏宽度 260（与 03 阶段固定宽度一致，12 外壳升级无感）", async () => {
    const s = await loadSettings();
    expect(s.layout.sidebarWidth).toBe(260);
  });

  it("layout.sidebarWidth 存量读取与增量写回（AC-M-23 持久化通道）", async () => {
    // 存量整组写入 → 逐字段读取（重启恢复路径）
    memory.set("layout", { sidebarWidth: 360 });
    expect((await loadSettings()).layout.sidebarWidth).toBe(360);
    // 拖拽结束增量写回（12 外壳 onPersist 消费口）→ 独立键落盘
    await updateSettings({ layout: { sidebarWidth: 420 } });
    expect(memory.get("layout")).toEqual({ sidebarWidth: 420 });
    expect((await loadSettings()).layout.sidebarWidth).toBe(420);
  });

  it("updateSettings 增量合并 layout 单字段且不影响其他组", async () => {
    await updateSettings({ appearance: { readingSpeed: 260 } });
    const s = await updateSettings({ layout: { sidebarWidth: 200 } });
    expect(s.layout.sidebarWidth).toBe(200);
    expect(s.appearance.readingSpeed).toBe(260); // 其他组不受影响
  });
});
