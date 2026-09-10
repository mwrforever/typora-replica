// 窗口控制状态机测试（12 W3；AC-M-13/14/15/16/17 前端编排面；核心域 100%）
//
// IPC 全部 vi.fn 注入，直呼控制器方法断言状态迁移与 IPC 派发：
// 缩放档推进/钳制/失败回滚、全屏切换与菜单栏显隐双向联动/失败不动菜单、
// 置顶切换/失败回滚、新窗口派发、启动期全屏态同步（含恢复态隐藏菜单与 IPC 失败降级）。
import { describe, expect, it, vi } from "vitest";
import { createWindowControls } from "./use-window-controls";

/** 依赖夹具（全 IPC vi.fn，成功态默认；单用例按需改写返回值）。
 * 返回类型推断（不显式标注 WindowControlsOptions 交叉类型——Mock 构造签名与
 * 交叉冲突，结构化兼容由调用点 createWindowControls(options) 校验）；无参实现
 * 可赋给带参签名（少参兼容），mock.calls 照常捕获实参 */
function makeOptions() {
  return {
    toggleFullscreenIpc: vi.fn(async () => true),
    readFullscreenIpc: vi.fn(async () => false),
    toggleAlwaysOnTopIpc: vi.fn(async () => true),
    setZoomIpc: vi.fn(async () => undefined),
    createWindowIpc: vi.fn(async () => "main-2"),
    applyMenuVisible: vi.fn(() => undefined),
  };
}

describe("缩放档位状态机（AC-M-14）", () => {
  it("放大一档：100 → 110，IPC 以 setZoom 系数 1.1 派发（整窗缩放含侧栏）", () => {
    const options = makeOptions();
    const controls = createWindowControls(options);
    controls.zoomIn();
    expect(controls.zoomPercent()).toBe(110);
    expect(options.setZoomIpc).toHaveBeenCalledWith(1.1);
  });

  it("缩小一档：100 → 90，IPC 系数 0.9；连续推进按最新档计算", () => {
    const options = makeOptions();
    const controls = createWindowControls(options);
    controls.zoomOut();
    expect(controls.zoomPercent()).toBe(90);
    controls.zoomIn();
    expect(controls.zoomPercent()).toBe(100);
  });

  it("上界钳制：200 档再放大保持 200（仍派发 2.0 幂等设置）", () => {
    const options = makeOptions();
    const controls = createWindowControls(options);
    controls.zoomIn();
    controls.zoomIn();
    controls.zoomIn();
    controls.zoomIn();
    controls.zoomIn();
    expect(controls.zoomPercent()).toBe(200);
    controls.zoomIn();
    expect(controls.zoomPercent()).toBe(200);
    expect(options.setZoomIpc).toHaveBeenLastCalledWith(2);
  });

  it("下界钳制：50 档再缩小保持 50", () => {
    const options = makeOptions();
    const controls = createWindowControls(options);
    controls.zoomOut();
    controls.zoomOut();
    controls.zoomOut();
    controls.zoomOut();
    expect(controls.zoomPercent()).toBe(50);
    controls.zoomOut();
    expect(controls.zoomPercent()).toBe(50);
  });

  it("恢复原始尺寸：任意档回到 100 并派发系数 1.0", () => {
    const options = makeOptions();
    const controls = createWindowControls(options);
    controls.zoomIn();
    controls.zoomReset();
    expect(controls.zoomPercent()).toBe(100);
    expect(options.setZoomIpc).toHaveBeenLastCalledWith(1);
  });

  it("缩放 IPC 失败：档位回滚，下一次缩放仍按真实档位推进", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const options = makeOptions();
    options.setZoomIpc.mockRejectedValueOnce(new Error("平台失败"));
    const controls = createWindowControls(options);
    controls.zoomIn(); // 失败：100 → 110 回滚
    expect(controls.zoomPercent()).toBe(110); // 同步落档（先落标记再 IPC）
    await vi.waitFor(() => {
      expect(options.setZoomIpc).toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalled();
    });
    expect(controls.zoomPercent()).toBe(100); // 回滚完成
    controls.zoomOut(); // 回滚后的 100 缩小 → 90（若未回滚会误推到 99 之外档）
    expect(controls.zoomPercent()).toBe(90);
    errorSpy.mockRestore();
  });

  it("连按且旧尝试失败晚于新尝试成功：镜像保持新档位不回滚（并发守卫）", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const options = makeOptions();
    // 手工控时：第一次缩放（A：100→110）的 IPC 拒绝晚于第二次（B：110→125）成功返回
    let rejectA!: (reason?: unknown) => void;
    let resolveB!: (value: PromiseLike<undefined> | undefined) => void;
    options.setZoomIpc
      .mockImplementationOnce(() => new Promise((_res, rej) => (rejectA = rej)))
      .mockImplementationOnce(() => new Promise((res) => (resolveB = res)));
    const controls = createWindowControls(options);
    controls.zoomIn(); // A：镜像 110，IPC 在途
    controls.zoomIn(); // B：镜像 125（prev=110），IPC 在途
    resolveB(undefined); // B 成功先返回（实际缩放收敛 125）
    await vi.waitFor(() => expect(controls.zoomPercent()).toBe(125));
    rejectA(new Error("A 晚到失败")); // A 的失败晚到：prev=110 若无条件回滚将覆盖 125
    await vi.waitFor(() => expect(errorSpy).toHaveBeenCalled());
    // 镜像仍指向 B 的目标档（125 ≠ A 的 110）→ 陈旧失败被忽略，镜像/实际不失步
    expect(controls.zoomPercent()).toBe(125);
    errorSpy.mockRestore();
  });
});

describe("全屏切换与菜单栏显隐联动（AC-M-13）", () => {
  it("进入全屏：全屏态镜像 true，菜单栏应用隐藏（false）", async () => {
    const options = makeOptions();
    options.toggleFullscreenIpc.mockResolvedValue(true);
    const controls = createWindowControls(options);
    controls.toggleFullscreen();
    // IPC 异步收敛后状态镜像 + 菜单栏联动
    await vi.waitFor(() => expect(controls.fullscreen()).toBe(true));
    expect(options.applyMenuVisible).toHaveBeenCalledWith(false);
  });

  it("退出全屏：全屏态镜像 false，菜单栏应用恢复显示（true）", async () => {
    const options = makeOptions();
    const controls = createWindowControls(options);
    controls.toggleFullscreen(); // 进入
    await vi.waitFor(() => expect(controls.fullscreen()).toBe(true));
    options.toggleFullscreenIpc.mockResolvedValue(false);
    controls.toggleFullscreen(); // 退出
    await vi.waitFor(() => expect(controls.fullscreen()).toBe(false));
    expect(options.applyMenuVisible).toHaveBeenLastCalledWith(true);
  });

  it("全屏 IPC 失败：状态不镜像、菜单栏不联动，告警留痕", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const options = makeOptions();
    options.toggleFullscreenIpc.mockRejectedValue(new Error("平台失败"));
    const controls = createWindowControls(options);
    controls.toggleFullscreen();
    await vi.waitFor(() => expect(errorSpy).toHaveBeenCalled());
    expect(controls.fullscreen()).toBe(false);
    expect(options.applyMenuVisible).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

describe("置顶切换（AC-M-15）", () => {
  it("开启置顶：置顶态镜像 true（仅当前窗口语义由 IPC 侧窗口注入保证）", async () => {
    const options = makeOptions();
    const controls = createWindowControls(options);
    controls.toggleAlwaysOnTop();
    await vi.waitFor(() => expect(controls.alwaysOnTop()).toBe(true));
  });

  it("取消置顶：置顶态镜像 false", async () => {
    const options = makeOptions();
    const controls = createWindowControls(options);
    options.toggleAlwaysOnTopIpc.mockResolvedValue(false);
    controls.toggleAlwaysOnTop();
    await vi.waitFor(() => expect(controls.alwaysOnTop()).toBe(false));
  });

  it("置顶 IPC 失败：状态不镜像，告警留痕", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const options = makeOptions();
    options.toggleAlwaysOnTopIpc.mockRejectedValue(new Error("平台失败"));
    const controls = createWindowControls(options);
    controls.toggleAlwaysOnTop();
    await vi.waitFor(() => expect(errorSpy).toHaveBeenCalled());
    expect(controls.alwaysOnTop()).toBe(false);
    errorSpy.mockRestore();
  });
});

describe("新建窗口（AC-M-16）", () => {
  it("派发创建 IPC（新窗口空文档/独立状态由独立 JS context 保证，本层只派发）", () => {
    const options = makeOptions();
    const controls = createWindowControls(options);
    controls.newWindow();
    expect(options.createWindowIpc).toHaveBeenCalledOnce();
  });

  it("创建 IPC 失败：告警留痕不崩溃", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const options = makeOptions();
    options.createWindowIpc.mockRejectedValue(new Error("创建失败"));
    const controls = createWindowControls(options);
    controls.newWindow();
    await vi.waitFor(() => expect(errorSpy).toHaveBeenCalled());
    errorSpy.mockRestore();
  });
});

describe("启动期全屏态同步（AC-M-17 前端对齐）", () => {
  it("恢复的全屏态：全屏镜像 true 且菜单栏应用隐藏（进入全屏即隐菜单覆盖恢复路径）", async () => {
    const options = makeOptions();
    options.readFullscreenIpc.mockResolvedValue(true);
    const controls = createWindowControls(options);
    await controls.syncFullscreenAtStartup();
    expect(controls.fullscreen()).toBe(true);
    expect(options.applyMenuVisible).toHaveBeenCalledWith(false);
  });

  it("非全屏启动：不触发菜单栏动作", async () => {
    const options = makeOptions();
    options.readFullscreenIpc.mockResolvedValue(false);
    const controls = createWindowControls(options);
    await controls.syncFullscreenAtStartup();
    expect(controls.fullscreen()).toBe(false);
    expect(options.applyMenuVisible).not.toHaveBeenCalled();
  });

  it("读取 IPC 失败：按非全屏继续（告警降级，不阻断装配）", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const options = makeOptions();
    options.readFullscreenIpc.mockRejectedValue(new Error("读取失败"));
    const controls = createWindowControls(options);
    await controls.syncFullscreenAtStartup();
    expect(controls.fullscreen()).toBe(false);
    expect(options.applyMenuVisible).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
