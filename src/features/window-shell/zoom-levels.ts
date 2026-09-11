// 缩放档位纯函数（12 窗口外壳 W3，AC-M-14；spec §2「范围自定 50%-200%」档位口径）
//
// 档位集为实现侧自定（披露：±10% 起步、大倍率步进放宽的典型编辑器刻度），恒定
// 单一事实源：菜单缩放、快捷键缩放、未来状态栏缩放指示均消费本集。
// 纯函数无 IO 无副作用，核心域单测 100%（spec §4：缩放档位状态机）。

/** 缩放档位集（百分比；100 = 原始尺寸） */
export const ZOOM_LEVELS: readonly number[] = [50, 67, 75, 90, 100, 110, 125, 150, 175, 200];

/** 缩放下界（spec 50%；与 Rust set_webview_zoom 的 0.5 双端钳制同值） */
export const ZOOM_MIN_PERCENT = 50;

/** 缩放上界（spec 200%；与 Rust set_webview_zoom 的 2.0 双端钳制同值） */
export const ZOOM_MAX_PERCENT = 200;

/** 默认缩放档（原始尺寸） */
export const ZOOM_DEFAULT_PERCENT = 100;

/**
 * 放大一档：取档位集中第一个大于当前档的档位；已在最大档时保持不变（AC-M-14 钳制）
 * @param currentPercent 当前档位（百分比；状态机恒持有档位集内的值）
 * @returns 放大后的档位
 */
export function nextZoomIn(currentPercent: number): number {
  return ZOOM_LEVELS.find((level) => level > currentPercent) ?? ZOOM_MAX_PERCENT;
}

/**
 * 缩小一档：取档位集中小于当前档的最大档位；已在最小档时保持不变（AC-M-14 钳制）
 * @param currentPercent 当前档位（百分比）
 * @returns 缩小后的档位
 */
export function nextZoomOut(currentPercent: number): number {
  let result = ZOOM_MIN_PERCENT;
  for (const level of ZOOM_LEVELS) {
    if (level < currentPercent) result = level;
  }
  return result;
}

/**
 * 档位百分比 → WebView setZoom 系数（IPC 契约：1.0 = 100%）
 * @param percent 档位百分比（如 110）
 * @returns setZoom 系数（如 1.1）
 */
export function zoomToScale(percent: number): number {
  return percent / 100;
}
