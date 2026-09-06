// 主题状态机（08 spec §5 提供面：themeStore——主题列表/当前亮暗主题/自定义 CSS 状态）
//
// 职责：设置读取（settings.theme 组）→ 目录扫描（list_themes）→ asset 授权（复用 07
// allow_asset_directory，递归放行主题目录含 fonts/）→ 注入驱动（theme-css）→
// .markwell-dark 根类激活（08 自建运行时激活，消费 crepe-overrides 暗色段）。
// 明暗源 = 系统（matchMedia prefers-color-scheme：Task 12 封装求值/订阅，
// Task 13 在 init 接入真值与 change 联动）。不调用 setTheme 钉死窗口主题（D-3）。
import { defineStore } from "pinia";
import { ref } from "vue";
import { convertFileSrc } from "@tauri-apps/api/core";
import { allowThemeAssetDirectory, listThemes, watchThemes } from "../../services/theme-io";
import type { ThemeMeta } from "../../services/theme-io";
import { loadSettings, updateSettings } from "../../services/settings";
import { applyThemeCss } from "./theme-css";
import { currentSystemDark, watchSystemColorScheme } from "./color-scheme";

/** 明暗模式（settings.theme 两组键的选择器） */
export type ThemeMode = "light" | "dark";

/** 内置主题兜底名（存量主题名被删时按模式回落；与 Rust BUILT_IN_THEMES 同名） */
const BUILTIN_FALLBACK: Record<ThemeMode, string> = {
  light: "markwell-light",
  dark: "markwell-dark",
};

export const useThemeStore = defineStore("theme", () => {
  /** 主题列表（list_themes 扫描结果；Themes 菜单数据源，12 菜单装配消费） */
  const themes = ref<ThemeMeta[]>([]);
  /** 亮色模式主题名（settings.theme.lightTheme 镜像） */
  const lightTheme = ref("");
  /** 暗色模式主题名（settings.theme.darkTheme 镜像） */
  const darkTheme = ref("");
  /** 当前系统暗色（init 读 matchMedia 真值 + change 订阅镜像；AC-T5-1 明暗源） */
  const systemDark = ref(false);
  /** 主题目录 asset 基准 URL（convertFileSrc(dir)，尾随分隔符归一） */
  const assetBase = ref("");
  /** base.user.css 是否存在（Rust 扫描，4 层第 3 层开关） */
  const hasBaseUserCss = ref(false);

  /** 按名精确查找主题（主题名经 Rust 命名规则保证小写） */
  function byName(name: string): ThemeMeta | undefined {
    return themes.value.find((t) => t.name === name);
  }

  /**
   * 解析当前模式激活主题：设置值优先 → 内置同模式兜底 → undefined（无主题层，默认样式兜底）
   * @param mode 明暗模式
   * @returns 激活主题；undefined = 无激活主题（宪法 A.1.2.3，不用 null）
   */
  function resolveActiveTheme(mode: ThemeMode): ThemeMeta | undefined {
    const wanted = mode === "light" ? lightTheme.value : darkTheme.value;
    return byName(wanted) ?? byName(BUILTIN_FALLBACK[mode]);
  }

  /** 按当前系统色系重挂 CSS 链 + 切换 .markwell-dark 根类（唯一注入出口） */
  function applyCurrent(): void {
    const theme = resolveActiveTheme(systemDark.value ? "dark" : "light");
    applyThemeCss({
      themesAssetBase: assetBase.value,
      theme,
      hasBaseUserCss: hasBaseUserCss.value,
      cacheBust: Date.now(),
    });
    // .markwell-dark 运行时激活（08 自建）：crepe-overrides 暗色段随根类生效；
    // 主题 CSS 双选择器段（D-4）凭注入顺序覆盖其上
    document.documentElement.classList.toggle("markwell-dark", systemDark.value);
  }

  /**
   * 初始化（App 装配经 register 以 void 调一次）：设置 + 目录扫描并行 → 镜像状态 →
   * asset 授权 → 首次注入。任一环节失败均在本函数内接管拒绝（init 恒 resolve，
   * 调用方永不产生 unhandled rejection）：
   * - 授权失败仅记录并继续注入（主题 CSS 将被 asset 协议拒绝，界面回落默认样式）；
   * - 设置读取/目录扫描失败（store 插件异常、主题目录创建失败等）无数据可注入，
   *   仅记录并整体降级（跳过注入），不中断编辑主链路。
   */
  async function init(): Promise<void> {
    try {
      const [settings, list] = await Promise.all([loadSettings(), listThemes()]);
      lightTheme.value = settings.theme.lightTheme;
      darkTheme.value = settings.theme.darkTheme;
      themes.value = list.themes;
      hasBaseUserCss.value = list.hasBaseUserCss;
      assetBase.value = convertFileSrc(list.dir).replace(/[/\\]+$/, "");
      systemDark.value = currentSystemDark();
      // 订阅系统色系（AC-T5-1）：切换即镜像 + 重挂对应主题（明暗分离选择，Task 5 存储）
      stopColorScheme = watchSystemColorScheme((dark) => {
        systemDark.value = dark;
        applyCurrent();
      });
      try {
        await allowThemeAssetDirectory(list.dir);
      } catch (e) {
        console.error("[MarkWell] 主题目录 asset 授权失败（主题降级为默认样式）", e);
      }
      applyCurrent();
      // 热刷新订阅（AC-T3-1/2）：失败仅记录——降级为重启可见（官方基线行为，D-5）
      try {
        await watchThemes(scheduleRefresh);
      } catch (e) {
        console.error("[MarkWell] 主题热刷新订阅失败（降级为重启可见）", e);
      }
    } catch (e) {
      console.error("[MarkWell] 主题初始化失败（设置读取/目录扫描，主题降级为默认样式）", e);
    }
  }

  /**
   * 选择主题（12 菜单/10 设置页消费）：持久化到 settings.theme 组 → 镜像 → 立即重挂
   * @param mode 明暗模式（明暗分离存储）
   * @param name 主题名（文件名词干；须来自 themes 列表）
   */
  async function selectTheme(mode: ThemeMode, name: string): Promise<void> {
    const patch = mode === "light" ? { lightTheme: name } : { darkTheme: name };
    const next = await updateSettings({ theme: patch });
    lightTheme.value = next.theme.lightTheme;
    darkTheme.value = next.theme.darkTheme;
    applyCurrent();
  }

  /** 防抖定时器（目录事件风暴合并；dispose 清理防悬挂回调；undefined=无待触发定时器） */
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;

  /** 系统色系退订函数（init 订阅、dispose 释放；undefined=未订阅，宪法 A.1.2.3） */
  let stopColorScheme: (() => void) | undefined;

  /** 目录事件 → 300ms 尾沿防抖刷新（Rust 侧另有 100ms 合并窗口，此处合并前端风暴） */
  function scheduleRefresh(): void {
    if (refreshTimer !== undefined) {
      clearTimeout(refreshTimer);
    }
    refreshTimer = setTimeout(() => {
      refreshTimer = undefined;
      void refresh();
    }, 300);
  }

  /**
   * 重扫目录 + 重挂链（?t= 取当前时间戳穿透 WebView 缓存；AC-T3-1/2）。
   * 恒 resolve（对齐 init 同形态）：目录扫描拒绝（瞬时 IO 异常等）仅记录降级，
   * 保持当前主题与列表不变——防抖回调 void 消费与后续模块 await 均不产生
   * unhandled rejection。
   */
  async function refresh(): Promise<void> {
    try {
      const list = await listThemes();
      themes.value = list.themes;
      hasBaseUserCss.value = list.hasBaseUserCss;
      applyCurrent();
    } catch (e) {
      console.error("[MarkWell] 热刷新失败（主题列表扫描），保持当前主题与列表不变", e);
    }
  }

  /** 清理可释放资源（App 卸载/测试收尾调用；Rust 监视槽位随应用生命周期存活） */
  function dispose(): void {
    if (refreshTimer !== undefined) {
      clearTimeout(refreshTimer);
      refreshTimer = undefined;
    }
    // 色系退订幂等：重复调用/未订阅时 optional chain 落空，零副作用
    stopColorScheme?.();
    stopColorScheme = undefined;
  }

  return {
    themes,
    lightTheme,
    darkTheme,
    systemDark,
    assetBase,
    hasBaseUserCss,
    init,
    selectTheme,
    refresh,
    dispose,
    resolveActiveTheme,
  };
});
