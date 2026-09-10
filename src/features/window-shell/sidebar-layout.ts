// 侧栏布局纯函数（12 窗口外壳 W1）
//
// 单一职责：侧栏宽度契约常量与区间收敛。拖拽交互状态机见 use-sidebar-layout；
// 面板开合/当前面板的领域状态归 03 fileTree store（外壳只消费不复制，B.2 职责边界）。
// 宽度持久化走 10 设置 layout 组（services/settings），AC-M-23。

/** 侧栏宽度下限（px；调研自定合理值，防拖到不可用） */
export const SIDEBAR_WIDTH_MIN = 180;

/** 侧栏宽度上限（px；防侧栏吞没中央编辑区） */
export const SIDEBAR_WIDTH_MAX = 480;

/** 侧栏默认宽度（px；与 03 阶段 SidebarPanel 固定宽度一致，外壳升级无感） */
export const SIDEBAR_WIDTH_DEFAULT = 260;

/**
 * 将任意候选宽度收敛到合法区间（AC-M-23 拖拽越界与存量脏数据防御）
 * @param width 候选宽度 px（来源：拖拽增量换算 / 设置存量读取）
 * @returns 合法宽度 px：界内原样、越界取最近边界、非有限值回落默认宽度
 */
export function clampSidebarWidth(width: number): number {
  // 存量脏数据（损坏的 store 值/异常换算结果）不可信，回落默认宽度而非取边界
  if (!Number.isFinite(width)) return SIDEBAR_WIDTH_DEFAULT;
  return Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, width));
}
