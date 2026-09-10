// 窗口控制状态机（12 窗口外壳 W3；AC-M-13/14/15/16/17 前端编排）
//
// 职责：缩放档位推进（zoom-levels 纯函数）+ 全屏态与菜单栏显隐联动 + 置顶/新窗口
// 的 IPC 编排 + 启动期全屏态同步。IPC 依赖由装配层注入（services/window-io 封装），
// 本层不直接 import invoke——纯状态编排可核心 100% 单测（spec §4）。
//
// 与 W2 autoHideMenuBar Alt 状态机的交互契约（AC-M-13）：
// - 全屏进入：applyMenuVisible(false) 隐藏菜单栏（无条件，不受 autoHideMenuBar 设置门控）；
// - 全屏退出：applyMenuVisible(true) 恢复显示（spec「退出恢复」口径）；
// - 全屏期间 Alt 单按唤出/隐藏菜单仍由 Alt 状态机独立生效（调研报告六节确认「支持」）；
//   两条路径共用同一可见性标记（Alt 状态机 handle.applyVisible），互不抢状态。
import { ref } from "vue";
import { ZOOM_DEFAULT_PERCENT, nextZoomIn, nextZoomOut, zoomToScale } from "./zoom-levels";

/** 窗口控制状态机依赖（IPC 面由装配层注入 services/window-io 封装） */
export interface WindowControlsOptions {
  /** 全屏切换 IPC（返回切换后的全屏态） */
  toggleFullscreenIpc: () => Promise<boolean>;
  /** 全屏态读取 IPC（启动同步用） */
  readFullscreenIpc: () => Promise<boolean>;
  /** 置顶切换 IPC（返回切换后的置顶态） */
  toggleAlwaysOnTopIpc: () => Promise<boolean>;
  /** WebView 缩放 IPC（scale 系数，1.0 = 100%） */
  setZoomIpc: (scale: number) => Promise<void>;
  /** 新建窗口 IPC（返回新窗口 label） */
  createWindowIpc: () => Promise<string>;
  /** 菜单栏显隐应用（全屏联动出口；装配层接 Alt 状态机 applyVisible） */
  applyMenuVisible: (visible: boolean) => void;
}

/** 窗口控制命令句柄（菜单 action 与快捷键共用同一方法——AC-M-3 单一执行路径） */
export interface WindowControlsController {
  /** 当前缩放档（百分比；仅测试/调试消费） */
  zoomPercent: () => number;
  /** 当前全屏态（仅测试/调试消费） */
  fullscreen: () => boolean;
  /** 当前置顶态（仅测试/调试消费） */
  alwaysOnTop: () => boolean;
  /** 放大一档（AC-M-14；上界 200% 钳制在 zoom-levels） */
  zoomIn: () => void;
  /** 缩小一档（下界 50% 钳制） */
  zoomOut: () => void;
  /** 恢复原始尺寸（100%） */
  zoomReset: () => void;
  /** 切换全屏并联动菜单栏显隐（AC-M-13） */
  toggleFullscreen: () => void;
  /** 切换置顶（AC-M-15） */
  toggleAlwaysOnTop: () => void;
  /** 新建窗口（AC-M-16） */
  newWindow: () => void;
  /** 启动期同步全屏态（AC-M-17：恢复的全屏态对齐菜单栏隐藏；App 装配调用一次） */
  syncFullscreenAtStartup: () => Promise<void>;
}

/**
 * 创建窗口控制状态机（App 装配层调用一次；每窗口独立实例——多窗口各自持状态）
 * @param options IPC 面与菜单栏联动出口注入
 * @returns 控制器句柄
 */
export function createWindowControls(options: WindowControlsOptions): WindowControlsController {
  /** 当前缩放档（初始原始尺寸；IPC 失败回滚的基准） */
  const zoomPercent = ref(ZOOM_DEFAULT_PERCENT);
  /** 当前全屏态（初始非全屏；启动同步会修正恢复态） */
  const fullscreen = ref(false);
  /** 当前置顶态（新窗口恒非置顶） */
  const alwaysOnTop = ref(false);

  /**
   * 缩放档应用共步：先落档位再发 IPC（快速连按按最终态收敛）；
   * IPC 失败回滚档位，保证下一次缩放仍按真实档位推进。
   * 并发守卫：仅当当前镜像仍指向本次尝试的目标档（期间无更新档位落盘）才回滚
   *——连按下旧尝试的失败晚于新尝试成功返回时，回滚会以陈旧 prev 覆盖新档位
   *（镜像与 WebView 实际缩放失步，后续推进按错位基准计算），此时忽略陈旧失败
   */
  const applyZoom = (nextPercent: number): void => {
    const prev = zoomPercent.value;
    zoomPercent.value = nextPercent;
    options.setZoomIpc(zoomToScale(nextPercent)).catch((e: unknown) => {
      if (zoomPercent.value === nextPercent) zoomPercent.value = prev;
      console.error(`[MarkWell] 缩放设置失败（${prev}% → ${nextPercent}%）`, e);
    });
  };

  return {
    zoomPercent: () => zoomPercent.value,
    fullscreen: () => fullscreen.value,
    alwaysOnTop: () => alwaysOnTop.value,
    zoomIn: () => applyZoom(nextZoomIn(zoomPercent.value)),
    zoomOut: () => applyZoom(nextZoomOut(zoomPercent.value)),
    zoomReset: () => applyZoom(ZOOM_DEFAULT_PERCENT),
    toggleFullscreen: () => {
      options
        .toggleFullscreenIpc()
        .then((next) => {
          fullscreen.value = next;
          // AC-M-13 菜单栏联动：进入全屏隐藏（false），退出恢复（true）。
          // 显隐 IPC 失败的回滚由 applyVisible（Alt 状态机）内部兜底
          options.applyMenuVisible(!next);
        })
        .catch((e: unknown) => {
          // 全屏切换失败：状态不镜像、菜单栏不动，告警留痕
          console.error("[MarkWell] 全屏切换失败（状态未变更）", e);
        });
    },
    toggleAlwaysOnTop: () => {
      options
        .toggleAlwaysOnTopIpc()
        .then((next) => {
          alwaysOnTop.value = next;
        })
        .catch((e: unknown) => {
          console.error("[MarkWell] 窗口置顶切换失败（状态未变更）", e);
        });
    },
    newWindow: () => {
      // 新窗口 label 仅日志价值（多标签状态在各窗口内闭环），失败告警留痕
      options.createWindowIpc().catch((e: unknown) => {
        console.error("[MarkWell] 新窗口创建失败", e);
      });
    },
    syncFullscreenAtStartup: async () => {
      try {
        fullscreen.value = await options.readFullscreenIpc();
        // 重启恢复的全屏态同步菜单栏隐藏：spec「进入全屏自动隐藏菜单栏」
        // 的语义必须覆盖 window-state 恢复路径，否则恢复态下菜单栏悬于全屏之上
        if (fullscreen.value) options.applyMenuVisible(false);
      } catch (e: unknown) {
        console.error("[MarkWell] 启动期全屏态读取失败（按非全屏继续）", e);
      }
    },
  };
}
