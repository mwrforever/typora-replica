// 原生菜单装配 composable（12 窗口外壳 W2；AC-M-1~4 运行时链路）
//
// 职责：以响应式数据源（快捷键条目/主题/导出条目）构建菜单树 + 路由表并挂载原生
// 菜单；动态子菜单变化经 detached watch 触发整树重建（B.2.4：非组件层订阅必须
// detached: true 且自持取消函数）：
// - Themes 主题列表变化 → 重建（AC-M-4 安装新主题后菜单更新）；
// - keyBinding 覆盖变化（menuShortcutEntries）→ 重建（菜单 label 实时文本）；
// - 导出项列表变化 → 重建（File → Export 实时性，X7）；
// - 最近文件列表为非响应式服务，暴露 refreshRecent 供打开文件后触发重建。
// 菜单构建/挂载失败仅记录告警（菜单缺失不阻断编辑主链路）。
import { watch } from "vue";
import { setWindowMenu } from "../../services/menu-io";
import { getExportMenuEntries } from "../export/export-commands";
import { useExportStore } from "../export/export-store";
import { useSettingsStore } from "../settings/settings-store";
import { useThemeStore } from "../theme/theme-store";
import type { ThemeMode } from "../theme/theme-store";
import { RecentFiles } from "../../services/recent-files";
import { buildMenuTree } from "./menu-tree";
import { createMenuRouter } from "./menu-router";
import { useViewModes } from "./view-modes";
import type { MenuRouterDeps } from "./menu-router";

/** 原生菜单装配选项（路由依赖注入；数据源 store 由本 composable 自取——模块单例） */
export interface UseNativeMenuOptions {
  /** 菜单路由依赖（App 装配层注入各模块锁定接口回调） */
  deps: MenuRouterDeps;
}

/** 原生菜单装配句柄（App 卸载收尾） */
export interface NativeMenuHandle {
  /** 手动重建菜单（非响应式数据源变化后调用；失败保持上一版菜单） */
  rebuild: () => Promise<void>;
  /** 重新拉取最近文件并重建（打开文件成功后调用） */
  refreshRecent: () => Promise<void>;
  /** 停止全部响应式订阅（App 卸载调用；幂等） */
  cleanup: () => void;
}

/**
 * 装配原生菜单（App onMounted 调用一次；须在 settingsStore.load() 之后——菜单 label
 * 依赖 menuShortcutEntries 的 keyBinding 合并结果）
 *
 * @param options 路由依赖注入
 * @returns 装配句柄（rebuild/refreshRecent/cleanup）
 */
export function useNativeMenu(options: UseNativeMenuOptions): NativeMenuHandle {
  const settings = useSettingsStore();
  const theme = useThemeStore();
  const exportStore = useExportStore();
  /** 视图模式单例（12 W5：专注/打字机勾选态数据源，toggle 经路由依赖注入） */
  const viewModes = useViewModes();
  /** 最近文件路径缓存（非响应式服务；refreshRecent 刷新后重建） */
  let recentPaths: string[] = [];

  /** 构建路由表 + 菜单树并挂载（重建共用工步；树与路由同输入源保证 id 一致，
   * id 覆盖无孤儿由 menu-router.spec 以真实树行为级核对钉住） */
  const buildAndSet = async (): Promise<void> => {
    const mode: ThemeMode = theme.systemDark ? "dark" : "light";
    const input = {
      shortcutEntries: settings.menuShortcutEntries,
      exportEntries: getExportMenuEntries(),
      themes: theme.themes,
      activeThemeName: theme.resolveActiveTheme(mode)?.name,
      activeMode: mode,
      recentPaths,
      focusEnabled: viewModes.focusEnabled.value,
      typewriterEnabled: viewModes.typewriterEnabled.value,
    };
    const router = createMenuRouter(options.deps, {
      exportEntries: input.exportEntries,
      activeMode: input.activeMode,
    });
    await setWindowMenu(buildMenuTree(input), (id) => router.run(id));
  };

  /** 重建错误兜底（watch/外部 void 消费，拒绝态在此收敛为告警，保持上一版菜单） */
  const rebuildGuarded = (): Promise<void> =>
    buildAndSet().catch((e: unknown) => {
      console.error("[MarkWell] 原生菜单重建失败（保持上一版菜单）", e);
    });

  // 首次拉取最近文件后完成首次挂载（读取失败回落空列表，不阻断装配）
  void new RecentFiles()
    .list()
    .then((items) => items.map((item) => item.path))
    .catch(() => [])
    .then((paths) => {
      recentPaths = paths;
      return rebuildGuarded();
    });

  // 动态子菜单重建订阅：composable 非组件层订阅，句柄自持并在 cleanup 统一停止
  //（B.2.4 非组件层订阅纪律；watch 无 detached 选项——Vue watch 以显式停止等效收口）
  const handles: Array<() => void> = [
    // AC-M-4：主题列表热刷新（安装/删除主题）→ Themes 子菜单重建
    watch(
      () => theme.themes,
      () => void rebuildGuarded(),
    ),
    // keyBinding 覆盖变化 → label 快捷键实时文本重建（10#1 展示流接线点）
    watch(
      () => settings.menuShortcutEntries,
      () => void rebuildGuarded(),
    ),
    // 导出项变化（增删/改序/启停/改名）→ Export 子菜单重建（X7 实时性）
    watch(
      () => JSON.stringify(exportStore.items),
      () => void rebuildGuarded(),
    ),
    // 专注/打字机开关变化（12 W5 F8/F9 toggle）→ View 菜单勾选态重建（AC-M-10~12）
    watch([viewModes.focusEnabled, viewModes.typewriterEnabled], () => void rebuildGuarded()),
  ];

  return {
    rebuild: rebuildGuarded,
    refreshRecent: async () => {
      recentPaths = await new RecentFiles()
        .list()
        .then((items) => items.map((item) => item.path))
        .catch(() => []);
      await rebuildGuarded();
    },
    cleanup: () => {
      for (const handle of handles.splice(0)) handle();
    },
  };
}
