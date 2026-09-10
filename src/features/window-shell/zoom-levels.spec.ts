// 缩放档位纯函数测试（12 W3，AC-M-14；核心域 100%）
//
// 钉住：档位集序列、放大/缩小的档位推进、50%-200% 双端钳制、百分比→setZoom 系数换算。
import { describe, expect, it } from "vitest";
import {
  ZOOM_DEFAULT_PERCENT,
  ZOOM_LEVELS,
  ZOOM_MAX_PERCENT,
  ZOOM_MIN_PERCENT,
  nextZoomIn,
  nextZoomOut,
  zoomToScale,
} from "./zoom-levels";

describe("缩放档位集（AC-M-14 范围口径）", () => {
  it("档位集以 100 为中心、两端为 spec 上下界 50/200", () => {
    expect(ZOOM_MIN_PERCENT).toBe(50);
    expect(ZOOM_MAX_PERCENT).toBe(200);
    expect(ZOOM_DEFAULT_PERCENT).toBe(100);
    expect(ZOOM_LEVELS).toContain(ZOOM_DEFAULT_PERCENT);
    // 档位严格递增（放大/缩小推进的单调性前提）
    for (let i = 1; i < ZOOM_LEVELS.length; i++) {
      expect(ZOOM_LEVELS[i]!).toBeGreaterThan(ZOOM_LEVELS[i - 1]!);
    }
  });
});

describe("放大一档（nextZoomIn）", () => {
  it("从中间档放大推进到下一档（100 → 110 → 125）", () => {
    expect(nextZoomIn(100)).toBe(110);
    expect(nextZoomIn(110)).toBe(125);
  });

  it("已在最大档 200 时保持不变（上界钳制）", () => {
    expect(nextZoomIn(200)).toBe(200);
  });
});

describe("缩小一档（nextZoomOut）", () => {
  it("从中间档缩小推进到下一档（100 → 90 → 75 → 67 → 50）", () => {
    expect(nextZoomOut(100)).toBe(90);
    expect(nextZoomOut(90)).toBe(75);
    expect(nextZoomOut(75)).toBe(67);
    expect(nextZoomOut(67)).toBe(50);
  });

  it("已在最小档 50 时保持不变（下界钳制）", () => {
    expect(nextZoomOut(50)).toBe(50);
  });
});

describe("百分比 → setZoom 系数（zoomToScale）", () => {
  it("100% 换算系数 1.0，110% 换算 1.1（IPC 契约 1.0 = 原始尺寸）", () => {
    expect(zoomToScale(100)).toBe(1);
    expect(zoomToScale(110)).toBe(1.1);
    expect(zoomToScale(50)).toBe(0.5);
    expect(zoomToScale(200)).toBe(2);
  });
});
