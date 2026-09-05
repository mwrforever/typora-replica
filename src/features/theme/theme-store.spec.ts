// src/features/theme/theme-store.spec.ts
// 主题状态机基座（08 spec §5 themeStore）：初始化装配/明暗选择持久化/内置回落。
// theme-io/settings/@tauri-apps/api core 三层 mock；applyThemeCss 走真实 DOM（jsdom head）。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

const mocks = vi.hoisted(() => ({
  listThemes: vi.fn(),
  watchThemes: vi.fn(),
  allowDir: vi.fn(),
  loadSettings: vi.fn(),
  updateSettings: vi.fn(),
  convert: vi.fn((p: string) => `http://asset.localhost/${encodeURIComponent(p)}`),
  errorSpy: vi.fn(),
}));
vi.mock("../../services/theme-io", () => ({
  listThemes: mocks.listThemes,
  watchThemes: mocks.watchThemes,
  allowThemeAssetDirectory: mocks.allowDir,
  openThemeFolder: vi.fn(),
  toggleDevtools: vi.fn(),
}));
vi.mock("../../services/settings", () => ({
  loadSettings: mocks.loadSettings,
  updateSettings: mocks.updateSettings,
}));
vi.mock("@tauri-apps/api/core", () => ({ convertFileSrc: mocks.convert }));

import { useThemeStore } from "./theme-store";

const LIST = {
  dir: "C:\\Users\\t\\AppData\\Roaming\\com.markwell.app\\themes",
  hasBaseUserCss: true,
  themes: [
    {
      name: "markwell-dark",
      fileName: "markwell-dark.css",
      label: "Markwell Dark",
      hasUserCss: false,
    },
    {
      name: "markwell-light",
      fileName: "markwell-light.css",
      label: "Markwell Light",
      hasUserCss: true,
    },
    { name: "solar-mint", fileName: "solar-mint.css", label: "Solar Mint", hasUserCss: false },
  ],
};
const SETTINGS = { theme: { lightTheme: "markwell-light", darkTheme: "markwell-dark" } };

describe("themeStore 基座", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    document.head.innerHTML = "";
    document.documentElement.className = "";
    vi.clearAllMocks();
    mocks.listThemes.mockResolvedValue(LIST);
    mocks.loadSettings.mockResolvedValue(SETTINGS);
    mocks.updateSettings.mockImplementation(
      async (patch: { theme?: Partial<{ lightTheme: string; darkTheme: string }> }) => ({
        theme: { ...SETTINGS.theme, ...patch.theme },
      }),
    );
    vi.spyOn(console, "error").mockImplementation(mocks.errorSpy);
    vi.spyOn(Date, "now").mockReturnValue(1_000);
  });

  it("init 装配：列表/设置镜像 + asset 授权 + 亮色主题 link 挂载（AC-T1-1/1-2 状态侧）", async () => {
    const store = useThemeStore();
    await store.init();
    expect(store.themes).toHaveLength(3);
    expect(store.lightTheme).toBe("markwell-light");
    expect(store.hasBaseUserCss).toBe(true);
    expect(store.assetBase).toBe(`http://asset.localhost/${encodeURIComponent(LIST.dir)}`);
    expect(mocks.allowDir).toHaveBeenCalledWith(LIST.dir); // 07 命令复用（递归含 fonts/，AC-T8-1 证据之一）
    const link = document.getElementById("markwell-theme-link") as HTMLLinkElement;
    expect(link.getAttribute("href")).toBe(`${store.assetBase}/markwell-light.css?t=1000`);
    // 系统亮色（mock 默认无暗色态）→ 不激活 .markwell-dark 根类
    expect(document.documentElement.classList.contains("markwell-dark")).toBe(false);
  });

  it("init 时 asset 授权失败仅记录错误且主题仍注入（降级链路）", async () => {
    mocks.allowDir.mockRejectedValueOnce(new Error("拒绝"));
    const store = useThemeStore();
    await store.init();
    expect(mocks.errorSpy).toHaveBeenCalled();
    expect(document.getElementById("markwell-theme-link")).not.toBeNull();
  });

  it("init 时设置读取失败仅记录错误且 init 恒 resolve（不产生 unhandled rejection）", async () => {
    // register.ts 以 void 调 init：设置/扫描任一腿拒绝都必须在 init 内部接管，
    // 否则启动期 unhandled promise rejection（批审 Important-1）
    mocks.loadSettings.mockRejectedValueOnce(new Error("store 插件异常"));
    const store = useThemeStore();
    await expect(store.init()).resolves.toBeUndefined();
    expect(mocks.errorSpy).toHaveBeenCalled();
  });

  it("selectTheme 持久化并立即重挂（AC-T1-2）", async () => {
    const store = useThemeStore();
    await store.init();
    await store.selectTheme("light", "solar-mint");
    expect(mocks.updateSettings).toHaveBeenCalledWith({ theme: { lightTheme: "solar-mint" } });
    const link = document.getElementById("markwell-theme-link") as HTMLLinkElement;
    expect(link.getAttribute("href")).toContain("/solar-mint.css?t=");
  });

  it("selectTheme dark 写入 darkTheme 键（明暗分离存储，AC-T5-1 状态侧）", async () => {
    const store = useThemeStore();
    await store.init();
    await store.selectTheme("dark", "solar-mint");
    expect(mocks.updateSettings).toHaveBeenCalledWith({ theme: { darkTheme: "solar-mint" } });
    expect(store.darkTheme).toBe("solar-mint");
  });

  it("resolveActiveTheme：设置名失效回落内置同名主题（内置也缺则 undefined）", async () => {
    const store = useThemeStore();
    await store.init();
    expect(store.resolveActiveTheme("light")?.name).toBe("markwell-light");
    // 设置值指向已删除主题 → 回落内置
    store.lightTheme = "deleted-theme";
    expect(store.resolveActiveTheme("light")?.name).toBe("markwell-light");
    // 内置也缺失 → undefined（主题层移除，默认样式兜底；宪法 A.1.2.3 新增 API 用 undefined）
    store.themes = [];
    expect(store.resolveActiveTheme("light")).toBeUndefined();
  });
});

describe("themeStore 热刷新（Task 10）", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setActivePinia(createPinia());
    document.head.innerHTML = "";
    document.documentElement.className = "";
    vi.clearAllMocks();
    mocks.listThemes.mockResolvedValue(LIST);
    mocks.loadSettings.mockResolvedValue(SETTINGS);
    mocks.updateSettings.mockImplementation(
      async (patch: { theme?: Partial<{ lightTheme: string; darkTheme: string }> }) => ({
        theme: { ...SETTINGS.theme, ...patch.theme },
      }),
    );
    vi.spyOn(console, "error").mockImplementation(mocks.errorSpy);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("目录变更事件 → 300ms 防抖后重扫并更新列表（AC-T3-1 数据侧）", async () => {
    const store = useThemeStore();
    await store.init();
    expect(store.themes).toHaveLength(3);
    // 捕获 watchThemes 订阅的批量回调
    const onEvents = mocks.watchThemes.mock.calls[0]?.[0] as
      ((events: unknown[]) => void) | undefined;
    expect(onEvents).toBeDefined(); // init 必须已订阅 watchThemes（RED：未订阅时此处失败）
    // 新主题落盘（模拟用户复制 css）→ 事件批量到达
    mocks.listThemes.mockResolvedValue({
      ...LIST,
      themes: [
        ...LIST.themes,
        {
          name: "solar-amber",
          fileName: "solar-amber.css",
          label: "Solar Amber",
          hasUserCss: false,
        },
      ],
    });
    onEvents?.([{ kind: "create", path: "C:\\t\\solar-amber.css" }]);
    await vi.advanceTimersByTimeAsync(300);
    expect(mocks.listThemes).toHaveBeenCalledTimes(2); // init 一次 + 刷新一次
    expect(store.themes.some((t) => t.name === "solar-amber")).toBe(true);
  });

  it("事件风暴合并为单次刷新（防抖尾沿重置）", async () => {
    const store = useThemeStore();
    await store.init();
    const onEvents = mocks.watchThemes.mock.calls[0]?.[0] as
      ((events: unknown[]) => void) | undefined;
    expect(onEvents).toBeDefined(); // init 必须已订阅 watchThemes（RED：未订阅时此处失败）
    onEvents?.([{ kind: "modify", path: "C:\\t\\a.css" }]);
    await vi.advanceTimersByTimeAsync(200);
    onEvents?.([{ kind: "modify", path: "C:\\t\\b.css" }]);
    await vi.advanceTimersByTimeAsync(200); // 距上次事件 200ms < 300ms，未触发
    expect(mocks.listThemes).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(100); // 尾沿到点
    expect(mocks.listThemes).toHaveBeenCalledTimes(2);
  });

  it("修改激活主题 → link href ?t= 更新（AC-T3-2）", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000);
    const store = useThemeStore();
    await store.init();
    const before = (document.getElementById("markwell-theme-link") as HTMLLinkElement).getAttribute(
      "href",
    );
    const onEvents = mocks.watchThemes.mock.calls[0]?.[0] as
      ((events: unknown[]) => void) | undefined;
    expect(onEvents).toBeDefined(); // init 必须已订阅 watchThemes（RED：未订阅时此处失败）
    vi.spyOn(Date, "now").mockReturnValue(2_000);
    onEvents?.([{ kind: "modify", path: `${LIST.dir}\\markwell-light.css` }]);
    await vi.advanceTimersByTimeAsync(300);
    const after = (document.getElementById("markwell-theme-link") as HTMLLinkElement).getAttribute(
      "href",
    );
    expect(after).not.toBe(before);
    expect(after).toContain("?t=2000");
  });

  it("dispose 清理待触发定时器（悬挂回调不再刷新）", async () => {
    const store = useThemeStore();
    await store.init();
    const onEvents = mocks.watchThemes.mock.calls[0]?.[0] as
      ((events: unknown[]) => void) | undefined;
    expect(onEvents).toBeDefined(); // init 必须已订阅 watchThemes（RED：未订阅时此处失败）
    onEvents?.([{ kind: "create", path: "C:\\t\\x.css" }]);
    store.dispose();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(mocks.listThemes).toHaveBeenCalledTimes(1); // 仅 init 那次
  });

  it("热刷新目录扫描失败恒 resolve 并降级保持旧列表（不产生 unhandled rejection）", async () => {
    const store = useThemeStore();
    await store.init();
    expect(store.themes).toHaveLength(3);
    // init 腿已消费成功值；刷新腿持续拒绝（模拟目录瞬时 IO 异常）
    mocks.listThemes.mockRejectedValue(new Error("目录瞬时 IO 异常"));
    const onEvents = mocks.watchThemes.mock.calls[0]?.[0] as
      ((events: unknown[]) => void) | undefined;
    expect(onEvents).toBeDefined();
    // 防抖回调 void 消费路径：刷新腿必须被尝试且拒绝被内部接管（否则 vitest 计 unhandled rejection）
    onEvents?.([{ kind: "modify", path: "C:\\t\\a.css" }]);
    await vi.advanceTimersByTimeAsync(300);
    expect(mocks.listThemes).toHaveBeenCalledTimes(2); // init 一次 + 刷新一次（刷新腿已尝试）
    expect(store.themes).toHaveLength(3); // 降级语义：旧列表原样保持
    // [MarkWell] 中文降级日志（经 console.error spy 接管断言）
    expect(mocks.errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("[MarkWell] 热刷新失败"),
      expect.anything(),
    );
    // 导出 API 恒 resolve（与 init 的 940a1f4 同形态断言；Task 13/14 直接 await 消费路径）
    await expect(store.refresh()).resolves.toBeUndefined();
  });

  it("watchThemes 订阅失败仅记录并降级（热刷新退化为重启可见——官方基线）", async () => {
    mocks.watchThemes.mockRejectedValueOnce(new Error("订阅失败"));
    const store = useThemeStore();
    await store.init();
    expect(mocks.errorSpy).toHaveBeenCalled();
    expect(document.getElementById("markwell-theme-link")).not.toBeNull(); // 首次注入不受影响
  });
});
