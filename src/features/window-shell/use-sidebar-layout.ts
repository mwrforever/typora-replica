// 侧栏宽度拖拽 composable（12 窗口外壳 W1，AC-M-23 交互状态机）
//
// 拖拽语义：mousedown 记起点（clientX + 当前宽度）→ document mousemove 按
// 「起始宽度 + 横向增量」实时收敛宽度 → mouseup 停止并仅在实际变化时回调持久化。
// 监听登记在 document（拖出窗口仍持续生效），作用域销毁时自动清理（onScopeDispose）。
// 宽度来源分双态：拖拽态取拖拽换算值，非拖拽态跟随持久化值（响应式来源经 getter 注入，
// toValue 归一——宪法 A.7.1）；持久化落地后快照刷新，宽度自动跟随新值（松开不残留拖拽值）。
import {
  computed,
  onScopeDispose,
  ref,
  toValue,
  type ComputedRef,
  type MaybeRefOrGetter,
} from "vue";
import { clampSidebarWidth, SIDEBAR_WIDTH_DEFAULT } from "./sidebar-layout";

/** useSidebarLayout 入参（参数对象化，宪法 A.7.1） */
export interface SidebarLayoutOptions {
  /** 已持久化的侧栏宽度 px（响应式来源，如设置快照 getter；undefined 回落默认宽度） */
  storedWidth: MaybeRefOrGetter<number | undefined>;
  /** 拖拽结束的持久化回调（仅宽度相对持久化值实际变化时触发；参数为收敛后的合法宽度） */
  onPersist: (width: number) => void;
}

/** useSidebarLayout 返回面（含多个 ref 的普通非响应式对象，宪法 A.7.2） */
export interface SidebarLayoutApi {
  /** 当前生效宽度 px：拖拽态取换算值，非拖拽态取持久化值（均已收敛） */
  width: ComputedRef<number>;
  /** 是否拖拽进行中 */
  dragging: ComputedRef<boolean>;
  /** 拖拽手柄 mousedown 入口（外壳容器 @mousedown 接线） */
  startDrag: (event: MouseEvent) => void;
}

/**
 * 侧栏宽度拖拽状态机（组件 setup 期调用一次）
 * @param options 持久化值来源与持久化回调（见 SidebarLayoutOptions）
 * @returns width/dragging/startDrag（见 SidebarLayoutApi）；非法持久化值已在读取口收敛
 */
export function useSidebarLayout(options: SidebarLayoutOptions): SidebarLayoutApi {
  /** 拖拽进行中的临时宽度（undefined = 非拖拽态，宽度跟随持久化来源） */
  const draggingWidth = ref<number | undefined>(undefined);
  /** 拖拽起点：mousedown 时的指针横坐标与起始宽度（增量换算基准） */
  let dragStartX = 0;
  let dragStartWidth = 0;

  /** 持久化宽度读取口：undefined 回落默认，越界/脏值收敛（消费侧无需再防） */
  const storedClamped = (): number =>
    clampSidebarWidth(toValue(options.storedWidth) ?? SIDEBAR_WIDTH_DEFAULT);

  /** 当前生效宽度：拖拽态取换算值（startDrag/move 口已收敛），否则取持久化值 */
  const width = computed(() => draggingWidth.value ?? storedClamped());

  /** 是否拖拽中（状态机可观察态：会话语义断言消费；外壳可据此加手柄拖拽视觉态） */
  const dragging = computed(() => draggingWidth.value !== undefined);

  /** document mousemove：按横向增量换算并收敛宽度（越界停在边界） */
  const onDragMove = (event: MouseEvent): void => {
    draggingWidth.value = clampSidebarWidth(dragStartWidth + (event.clientX - dragStartX));
  };

  /** document mouseup：解除监听、复位拖拽态，宽度实际变化才持久化（防无变化写盘） */
  const onDragEnd = (): void => {
    const finalWidth = width.value;
    draggingWidth.value = undefined; // 先复位：finalWidth 已取出，宽度源随即切回持久化值
    document.removeEventListener("mousemove", onDragMove);
    document.removeEventListener("mouseup", onDragEnd);
    if (finalWidth !== storedClamped()) {
      options.onPersist(finalWidth);
    }
  };

  /**
   * 拖拽手柄 mousedown 入口（外壳容器 @mousedown 接线）
   * @param event 手柄 mousedown 事件（preventDefault 防拖拽触发文本选择）
   */
  const startDrag = (event: MouseEvent): void => {
    // 防重入：拖拽中重复 mousedown 忽略（触摸/多键场景防起点重置跳变）
    if (draggingWidth.value !== undefined) return;
    event.preventDefault();
    dragStartX = event.clientX;
    dragStartWidth = width.value;
    draggingWidth.value = dragStartWidth;
    document.addEventListener("mousemove", onDragMove);
    document.addEventListener("mouseup", onDragEnd);
  };

  // 作用域销毁兜底：组件卸载中途拖拽（极端时序）不得残留 document 监听
  onScopeDispose(() => {
    document.removeEventListener("mousemove", onDragMove);
    document.removeEventListener("mouseup", onDragEnd);
  });

  return { width, dragging, startDrag };
}
