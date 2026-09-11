// 侧栏布局纯函数测试（12 窗口外壳 W1）
//
// 覆盖：clampSidebarWidth 区间收敛（下界/上界/界内/非法值回落默认）。
// 宽度区间与默认值是 AC-M-23 拖拽持久化的边界契约。
import { describe, expect, it } from "vitest";
import {
  SIDEBAR_WIDTH_DEFAULT,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
  clampSidebarWidth,
} from "./sidebar-layout";

describe("clampSidebarWidth 侧栏宽度区间收敛", () => {
  it("界内宽度原样保留", () => {
    expect(clampSidebarWidth(260)).toBe(260);
    expect(clampSidebarWidth(321)).toBe(321);
  });

  it("低于下界收敛到 180、高于上界收敛到 480（拖拽越界收敛）", () => {
    expect(clampSidebarWidth(SIDEBAR_WIDTH_MIN - 100)).toBe(SIDEBAR_WIDTH_MIN);
    expect(clampSidebarWidth(SIDEBAR_WIDTH_MAX + 100)).toBe(SIDEBAR_WIDTH_MAX);
  });

  it("边界值恰好保留（180 与 480 为合法宽度）", () => {
    expect(clampSidebarWidth(SIDEBAR_WIDTH_MIN)).toBe(SIDEBAR_WIDTH_MIN);
    expect(clampSidebarWidth(SIDEBAR_WIDTH_MAX)).toBe(SIDEBAR_WIDTH_MAX);
  });

  it("非有限值（NaN/Infinity）回落默认宽度 260（存量脏数据防御）", () => {
    expect(clampSidebarWidth(Number.NaN)).toBe(SIDEBAR_WIDTH_DEFAULT);
    expect(clampSidebarWidth(Number.POSITIVE_INFINITY)).toBe(SIDEBAR_WIDTH_DEFAULT);
  });
});
