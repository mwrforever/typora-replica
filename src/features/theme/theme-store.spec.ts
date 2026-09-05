// src/features/theme/theme-store.spec.ts
// 主题状态机基座（08 spec §5 themeStore）：初始化装配/明暗选择持久化/内置回落。
// theme-io/settings/@tauri-apps/api core 三层 mock；applyThemeCss 走真实 DOM（jsdom head）。
import { beforeEach, describe, expect, it, vi } from "vitest";
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
