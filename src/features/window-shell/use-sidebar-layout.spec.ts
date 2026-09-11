// 侧栏宽度拖拽 composable 测试（12 窗口外壳 W1，AC-M-23 交互状态机）
//
// 覆盖：初始宽度回落/取持久化值、拖拽增量换算与越界收敛、松开仅在实际变化时
// 持久化、松开后宽度回落跟随持久化来源、拖拽中重复 mousedown 防重入、
// 作用域销毁清理 document 监听。
// 不依赖组件：composable 在 effectScope 内直接调用（对齐组件 setup 的活动作用域，
// onScopeDispose 语义可验）。
import { describe, expect, it, vi } from "vitest";
import { effectScope, type EffectScope } from "vue";
import { SIDEBAR_WIDTH_DEFAULT, SIDEBAR_WIDTH_MAX, SIDEBAR_WIDTH_MIN } from "./sidebar-layout";
import { useSidebarLayout, type SidebarLayoutOptions } from "./use-sidebar-layout";

/** 派发 document 级鼠标事件（拖拽监听登记在 document，拖出组件仍持续生效） */
function fireMouse(type: string, clientX: number): void {
  document.dispatchEvent(new MouseEvent(type, { clientX, bubbles: true }));
}

/** 在活动作用域内装配状态机（对齐组件 setup 环境；scope 供销毁语义用例显式停止） */
function setupLayout(options: SidebarLayoutOptions): {
  api: ReturnType<typeof useSidebarLayout>;
  scope: EffectScope;
} {
  const scope = effectScope();
  const api = scope.run(() => useSidebarLayout(options))!;
  return { api, scope };
}

describe("useSidebarLayout 侧栏宽度拖拽状态机", () => {
  it("无持久化值时宽度回落默认 260，有值时取持久化值", () => {
    const idle = setupLayout({ storedWidth: () => undefined, onPersist: vi.fn() });
    expect(idle.api.width.value).toBe(SIDEBAR_WIDTH_DEFAULT);
    expect(idle.api.dragging.value).toBe(false);

    const stored = setupLayout({ storedWidth: () => 360, onPersist: vi.fn() });
    expect(stored.api.width.value).toBe(360);
  });

  it("拖拽按 clientX 增量换算宽度（mousedown 记起点，mousemove 实时收敛）", () => {
    const onPersist = vi.fn();
    const { api } = setupLayout({ storedWidth: () => 260, onPersist });
    api.startDrag(new MouseEvent("mousedown", { clientX: 100 }));
    expect(api.dragging.value).toBe(true);
    fireMouse("mousemove", 160); // 右移 60px → 260 + 60
    expect(api.width.value).toBe(320);
    expect(onPersist).not.toHaveBeenCalled(); // 拖拽中不落盘
  });

  it("拖拽越界收敛：右拖过头收 480、左拖过头收 180（AC-M-23 边界）", () => {
    const { api } = setupLayout({ storedWidth: () => 400, onPersist: vi.fn() });
    api.startDrag(new MouseEvent("mousedown", { clientX: 0 }));
    fireMouse("mousemove", 1000);
    expect(api.width.value).toBe(SIDEBAR_WIDTH_MAX);
    fireMouse("mouseup", 1000);
    // 同一 state 上再开一次拖拽验证下界（上一轮已松开复位）
    api.startDrag(new MouseEvent("mousedown", { clientX: 0 }));
    fireMouse("mousemove", -1000);
    expect(api.width.value).toBe(SIDEBAR_WIDTH_MIN);
    fireMouse("mouseup", -1000);
  });

  it("松开时仅宽度相对持久化值变化才回调 onPersist，且回调收敛后的合法宽度", () => {
    const onPersist = vi.fn();
    const { api } = setupLayout({ storedWidth: () => 260, onPersist });
    // 未移动直接松开：无变化不落盘（避免无意义写盘）
    api.startDrag(new MouseEvent("mousedown", { clientX: 0 }));
    fireMouse("mouseup", 0);
    expect(onPersist).not.toHaveBeenCalled();
    // 移动 +60 后松开：持久化 320
    api.startDrag(new MouseEvent("mousedown", { clientX: 0 }));
    fireMouse("mousemove", 60);
    fireMouse("mouseup", 60);
    expect(onPersist).toHaveBeenCalledWith(320);
  });

  it("松开后宽度回落跟随持久化来源（持久化落地后新值生效）", () => {
    let storedWidth: number | undefined = 260;
    const { api } = setupLayout({
      storedWidth: () => storedWidth,
      onPersist: (w) => {
        storedWidth = w; // 模拟 settingsStore.updateGui 落地后的快照刷新
      },
    });
    api.startDrag(new MouseEvent("mousedown", { clientX: 0 }));
    fireMouse("mousemove", 60);
    fireMouse("mouseup", 60);
    expect(api.dragging.value).toBe(false);
    expect(api.width.value).toBe(320); // 持久化值回填（非停留拖拽残值）
  });

  it("拖拽中重复 mousedown 防重入（不重置起点造成跳变）", () => {
    const { api } = setupLayout({ storedWidth: () => 260, onPersist: vi.fn() });
    api.startDrag(new MouseEvent("mousedown", { clientX: 0 }));
    fireMouse("mousemove", 50); // 起点 clientX=0
    // 拖拽中再次 mousedown：忽略，起点不重置——后续增量仍基于原起点
    api.startDrag(new MouseEvent("mousedown", { clientX: 500 }));
    fireMouse("mousemove", 510);
    // 起点未被重置：260 + 510 = 770 → 收敛 480；若起点被重置则应为 270
    expect(api.width.value).toBe(480);
  });

  it("作用域销毁清理 document 监听（卸载中途拖拽不再改宽度）", () => {
    const { api, scope } = setupLayout({ storedWidth: () => 260, onPersist: vi.fn() });
    api.startDrag(new MouseEvent("mousedown", { clientX: 0 }));
    scope.stop(); // 模拟组件卸载
    fireMouse("mousemove", 60); // 监听已移除，宽度不动
    expect(api.width.value).toBe(260);
    expect(api.dragging.value).toBe(true); // 拖拽态未被 mouseup 复位（监听已亡，无副作用即可）
  });
});
