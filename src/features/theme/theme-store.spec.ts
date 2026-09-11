// src/features/theme/theme-store.spec.ts
// 主题状态机基座（08 spec §5 themeStore）：初始化装配/明暗选择持久化/内置回落。
// theme-io/settings/@tauri-apps/api core 三层 mock；applyThemeCss 走真实 DOM（jsdom head）。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

const mocks = vi.hoisted(() => ({
  listThemes: vi.fn(),
  watchThemes: vi.fn(),
  // 默认恒 resolve：dispose/重复 init 的 fire-and-forget 退订在任意 describe 均安全
  unwatchThemes: vi.fn(async () => undefined),
  allowDir: vi.fn(),
  loadSettings: vi.fn(),
  updateSettings: vi.fn(),
  convert: vi.fn((p: string) => `http://asset.localhost/${encodeURIComponent(p)}`),
  errorSpy: vi.fn(),
  currentDark: vi.fn(() => false),
  // 退订函数须为 spy：dispose 用例对退订断言调用次数（普通函数无法 toHaveBeenCalledTimes）；
  // 泛型形式标注签名使 calls 元组携带 onChange 类型（strict/noUncheckedIndexedAccess 下
  // 空参数元组不可索引），且避免未用形参触发 no-unused-vars
  watchScheme: vi.fn<(onChange: (dark: boolean) => void) => () => void>(() => vi.fn()),
}));
vi.mock("../../services/theme-io", () => ({
  listThemes: mocks.listThemes,
  watchThemes: mocks.watchThemes,
  unwatchThemes: mocks.unwatchThemes,
  allowThemeAssetDirectory: mocks.allowDir,
  openThemeFolder: vi.fn(),
  toggleDevtools: vi.fn(),
}));
vi.mock("../../services/settings", () => ({
  loadSettings: mocks.loadSettings,
  updateSettings: mocks.updateSettings,
  // 失效事件常量（10 对接契约自 features/image 迁入 services）：mock 面须与真实模块导出对齐
  SETTINGS_INVALIDATED_EVENT: "markwell-settings-updated",
}));
vi.mock("@tauri-apps/api/core", () => ({ convertFileSrc: mocks.convert }));
vi.mock("./color-scheme", () => ({
  currentSystemDark: mocks.currentDark,
  watchSystemColorScheme: mocks.watchScheme,
}));

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

  it("watchFs=false 跳过热刷新订阅（12 W3 次窗口守卫）且其余装配环节不受影响", async () => {
    // New Window 次窗口（D1 裁决）：Rust 监视槽位进程级单槽，次窗口订阅会顶掉
    // 主窗口句柄——跳过订阅后主题列表/注入/色系等装配照常
    const store = useThemeStore();
    await store.init({ watchFs: false });
    expect(mocks.watchThemes).not.toHaveBeenCalled();
    expect(store.themes).toHaveLength(3);
    expect(document.getElementById("markwell-theme-link")).not.toBeNull();
  });

  it("watchFs=false 的次窗口 dispose 不退订共享监视槽位（防清掉主窗口的订阅）", async () => {
    // dispose 以 themeWatchActive 为门：次窗口从未订阅（标记恒 false），
    // 卸载时不得调用 unwatch_themes——否则进程级共享槽位被清，主窗口热刷新连带终止
    const store = useThemeStore();
    await store.init({ watchFs: false });
    store.dispose();
    expect(mocks.unwatchThemes).not.toHaveBeenCalled();
  });
});

describe("themeStore 明暗联动（Task 13）", () => {
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

  it("init 读真实系统色系：暗色系统下启动即挂暗色主题并激活根类（AC-T5-1 初始态）", async () => {
    mocks.currentDark.mockReturnValue(true);
    const store = useThemeStore();
    await store.init();
    expect(store.systemDark).toBe(true);
    expect(document.documentElement.classList.contains("markwell-dark")).toBe(true);
    const link = document.getElementById("markwell-theme-link") as HTMLLinkElement;
    expect(link.getAttribute("href")).toContain("/markwell-dark.css?t=");
  });

  it("系统色系切换 → 对应主题自动应用与根类切换（AC-T5-1）", async () => {
    const store = useThemeStore();
    await store.init();
    // 捕获 watchSystemColorScheme 订阅的回调（Task 12 模块被 mock）
    const onChange = mocks.watchScheme.mock.calls[0]?.[0];
    expect(onChange).toBeDefined(); // init 必须已订阅系统色系（RED：未订阅时此处失败）
    onChange?.(true);
    expect(document.documentElement.classList.contains("markwell-dark")).toBe(true);
    expect(
      (document.getElementById("markwell-theme-link") as HTMLLinkElement).getAttribute("href"),
    ).toContain("/markwell-dark.css?t=");
    onChange?.(false);
    expect(document.documentElement.classList.contains("markwell-dark")).toBe(false);
    expect(
      (document.getElementById("markwell-theme-link") as HTMLLinkElement).getAttribute("href"),
    ).toContain("/markwell-light.css?t=");
  });

  it("暗色模式下明暗主题分设生效（设置值失效回落内置暗色）", async () => {
    mocks.currentDark.mockReturnValue(true);
    const store = useThemeStore();
    await store.init();
    store.darkTheme = "deleted-dark"; // 设置值失效场景
    expect(store.resolveActiveTheme("dark")?.name).toBe("markwell-dark"); // 内置兜底
  });

  it("dispose 退订系统色系监听（App 卸载链路）", async () => {
    const store = useThemeStore();
    await store.init();
    expect(mocks.watchScheme).toHaveBeenCalledTimes(1);
    const unsubscribe = mocks.watchScheme.mock.results[0]?.value;
    expect(unsubscribe).toBeDefined();
    store.dispose();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});

describe("热刷新退订通道（T9-1/T13-1：dispose 与重复 init 不泄漏）", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    document.head.innerHTML = "";
    document.documentElement.className = "";
    vi.clearAllMocks();
    vi.useFakeTimers();
    mocks.listThemes.mockResolvedValue(LIST);
    mocks.loadSettings.mockResolvedValue(SETTINGS);
    mocks.unwatchThemes.mockResolvedValue(undefined);
    mocks.watchThemes.mockResolvedValue(undefined);
    vi.spyOn(console, "error").mockImplementation(mocks.errorSpy);
    vi.spyOn(Date, "now").mockReturnValue(1_000);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("dispose 调用 unwatchThemes 清 Rust 监视槽位（watchThemes 订阅成功前提下）", async () => {
    const store = useThemeStore();
    await store.init();
    store.dispose();
    expect(mocks.unwatchThemes).toHaveBeenCalledTimes(1);
  });

  it("dispose 后迟到事件不再触发防抖刷新（disposed 守卫，App 卸载后零副作用）", async () => {
    const store = useThemeStore();
    await store.init();
    store.dispose();
    const callsBefore = mocks.listThemes.mock.calls.length;
    const onEvents = mocks.watchThemes.mock.calls[0]?.[0] as
      ((events: unknown[]) => void) | undefined;
    expect(onEvents).toBeDefined();
    onEvents?.([{ kind: "created", path: "x.css" }]);
    await vi.advanceTimersByTimeAsync(300);
    expect(mocks.listThemes.mock.calls.length).toBe(callsBefore);
  });

  it("未订阅（watchThemes 失败降级）时 dispose 不发退订命令（themeWatchActive false 分支）", async () => {
    const store = useThemeStore();
    mocks.watchThemes.mockRejectedValueOnce(new Error("订阅降级"));
    await store.init();
    store.dispose();
    expect(mocks.unwatchThemes).not.toHaveBeenCalled();
    // 幂等：未订阅状态下重复 dispose 零副作用
    expect(() => store.dispose()).not.toThrow();
  });

  it("dispose 退订失败仅记录降级（catch 日志分支，不影响清理完成）", async () => {
    const store = useThemeStore();
    await store.init();
    mocks.unwatchThemes.mockRejectedValueOnce(new Error("ipc 断开"));
    expect(() => store.dispose()).not.toThrow();
    // fire-and-forget 的 catch 在微任务轮次执行：flush 后断言日志
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("主题监视退订失败"),
      expect.anything(),
    );
  });

  it("重复 init 时旧订阅退订失败仅记录降级（重装配继续）", async () => {
    const store = useThemeStore();
    await store.init();
    mocks.unwatchThemes.mockRejectedValueOnce(new Error("ipc 断开"));
    await expect(store.init()).resolves.toBeUndefined();
    expect(mocks.errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("旧主题监视退订失败"),
      expect.anything(),
    );
    // 降级后重装配仍完成：新旧两份订阅都建立
    expect(mocks.watchThemes.mock.calls.length).toBe(2);
  });

  it("重复 init 不泄漏：二次 init 前退订旧 watch 订阅与旧色系订阅", async () => {
    const store = useThemeStore();
    await store.init();
    expect(mocks.unwatchThemes).not.toHaveBeenCalled();
    await store.init();
    // 二次 init 装配前：先 unwatch 旧 Rust 槽位（新订阅建立前）
    expect(mocks.unwatchThemes).toHaveBeenCalledTimes(1);
    // 旧色系订阅在重订阅前被退订（watchScheme 返回的 spy 被调用 1 次）
    const unsub = mocks.watchScheme.mock.results[0]?.value as (() => void) | undefined;
    expect(unsub).toBeDefined();
    expect(unsub).toHaveBeenCalledTimes(1);
    // 两条腿各自仍然只挂最新一份订阅
    expect(mocks.watchThemes.mock.calls.length).toBe(2);
    expect(mocks.watchScheme.mock.calls.length).toBe(2);
  });
});
