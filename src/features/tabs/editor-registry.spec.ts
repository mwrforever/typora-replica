// 实例注册表（04：LRU 判定/adopt 门面切换/激活期 autoSave 订阅管理）
//
// 说明：fake crepe 带 on 桩（真实 editorManager.adopt 经 setupEditorEvents 调用
// crepe.on 注册监听，纯 {} 会抛 TypeError）；autoSave 以 vi.fn 桩验证订阅启停编排
// （双通道：start/stop 完整起停，startSuspended/suspend/resume 12 退出聚合暂停通道）。
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  activateInstance,
  clearRegistryForTest,
  getActiveFrontMatter,
  getActiveSession,
  getInstance,
  recycleLeastRecent,
  registerInstance,
  resumeActiveAutoSave,
  suspendAllAutoSave,
  unregisterInstance,
} from "./editor-registry";
import type { RegisteredInstance } from "./editor-registry";

function fakeInstance(id: number): RegisteredInstance {
  return {
    crepe: { on: vi.fn() } as never,
    frontMatter: null,
    session: {} as never,
    autoSave: {
      start: vi.fn(),
      stop: vi.fn(),
      startSuspended: vi.fn(),
      suspend: vi.fn(),
      resume: vi.fn(),
    } as never,
    lastActivatedAt: id,
  };
}

describe("editorRegistry 实例注册表", () => {
  beforeEach(() => clearRegistryForTest());

  it("register/activate：停旧起新 + 更新 lastActivatedAt", () => {
    const a = fakeInstance(1);
    const b = fakeInstance(2);
    registerInstance("a", a);
    registerInstance("b", b);
    activateInstance("a");
    expect(a.autoSave.start).toHaveBeenCalledTimes(1);
    activateInstance("b");
    expect(a.autoSave.stop).toHaveBeenCalledTimes(1);
    expect(b.autoSave.start).toHaveBeenCalledTimes(1);
  });

  it("重复激活同一标签不重复 stop/start", () => {
    const a = fakeInstance(1);
    registerInstance("a", a);
    activateInstance("a");
    activateInstance("a");
    expect(a.autoSave.start).toHaveBeenCalledTimes(1);
  });

  it("recycleLeastRecent 返回最久未激活且排除指定 id", () => {
    const a = fakeInstance(10);
    const b = fakeInstance(20);
    const c = fakeInstance(30);
    registerInstance("a", a);
    registerInstance("b", b);
    registerInstance("c", c);
    expect(recycleLeastRecent("c")).toBe("a"); // a 最久
    expect(recycleLeastRecent("a")).toBe("b"); // 排除 a 后 b 最久
  });

  it("unregister 后不再参与激活与回收", () => {
    const a = fakeInstance(10);
    registerInstance("a", a);
    unregisterInstance("a");
    expect(recycleLeastRecent("x")).toBeUndefined();
  });

  it("getInstance：已登记返回实例，未登记返回 undefined", () => {
    const a = fakeInstance(1);
    registerInstance("a", a);
    expect(getInstance("a")).toBe(a);
    expect(getInstance("nope")).toBeUndefined();
  });

  it("getActiveSession：激活标签的会话；未激活/已注销返回 undefined", () => {
    const a = fakeInstance(1);
    const b = fakeInstance(2);
    registerInstance("a", a);
    registerInstance("b", b);
    expect(getActiveSession()).toBeUndefined(); // 从未激活
    activateInstance("a");
    expect(getActiveSession()).toBe(a.session);
    activateInstance("b");
    expect(getActiveSession()).toBe(b.session);
    // 注销激活标签后门面回落空态（adoptedTabId 清除）
    unregisterInstance("b");
    expect(getActiveSession()).toBeUndefined();
  });

  it("activateInstance 未登记 id：安全忽略（无 stop/start 副作用）", () => {
    const a = fakeInstance(1);
    registerInstance("a", a);
    activateInstance("nope");
    expect(a.autoSave.start).not.toHaveBeenCalled();
    expect(getActiveSession()).toBeUndefined();
  });

  it("getActiveFrontMatter：从未激活任何标签时返回 null", () => {
    // 07 图片链路在无激活标签时不得拿到 undefined（契约：null 表示「无」）
    const a = fakeInstance(1);
    registerInstance("a", a);
    expect(getActiveFrontMatter()).toBeNull();
  });

  it("getActiveFrontMatter：激活标签的 FM 内文原样返回（图片路径解析基准）", () => {
    // typora-root-url / typora-copy-images-to 解析依赖激活标签的 FM 原文，
    // 直呼真实现验证 adopt 后读取器与登记实例同源
    const fm = "---\ntypora-root-url: docs\n---";
    const a = { ...fakeInstance(1), frontMatter: fm };
    registerInstance("a", a);
    activateInstance("a");
    expect(getActiveFrontMatter()).toBe(fm);
  });

  it("getActiveFrontMatter：无 front matter 的文档返回 null 而非 undefined", () => {
    // frontMatter 为 null 的实例经 ?? 回落后仍须是 null（调用方按 null 判空）
    const a = fakeInstance(1); // fakeInstance 默认 frontMatter: null
    registerInstance("a", a);
    activateInstance("a");
    expect(getActiveFrontMatter()).toBeNull();
  });

  it("注销激活中的标签后 getActiveFrontMatter 同步回落 null", () => {
    // 同时钉住 unregisterInstance 对激活中标签的 adoptedTabId 清除分支：
    // 注销后读取器不得再返回已关闭文档的 FM 残留
    const fm = "---\nkey: value\n---";
    const a = { ...fakeInstance(1), frontMatter: fm };
    registerInstance("a", a);
    activateInstance("a");
    expect(getActiveFrontMatter()).toBe(fm);
    unregisterInstance("a");
    expect(getActiveFrontMatter()).toBeNull();
  });

  it("suspendAllAutoSave：全实例只挂起保存定时器（不完整停止，12 退出聚合暂停）", () => {
    const a = fakeInstance(1);
    const b = fakeInstance(2);
    registerInstance("a", a);
    registerInstance("b", b);
    activateInstance("a");
    suspendAllAutoSave();
    // 双通道拆分钉：suspend 只停保存定时器，标脏订阅保持活跃（弹窗期编辑仍置脏）——
    // 不得调用完整 stop（否则复核聚合失效，弹窗期编辑随 destroy 丢失）
    expect(a.autoSave.suspend).toHaveBeenCalled();
    expect(b.autoSave.suspend).toHaveBeenCalled();
    expect(a.autoSave.stop).not.toHaveBeenCalled();
    expect(b.autoSave.stop).not.toHaveBeenCalled();
  });

  it("resumeActiveAutoSave：仅恢复激活标签；无激活标签安全返回", () => {
    const a = fakeInstance(1);
    const b = fakeInstance(2);
    registerInstance("a", a);
    registerInstance("b", b);
    resumeActiveAutoSave(); // 从未激活：adoptedTabId 为 undefined → no-op
    expect(a.autoSave.resume).not.toHaveBeenCalled();
    expect(b.autoSave.resume).not.toHaveBeenCalled();
    activateInstance("a");
    resumeActiveAutoSave();
    expect(a.autoSave.resume).toHaveBeenCalledTimes(1); // 仅激活标签恢复
    expect(b.autoSave.resume).not.toHaveBeenCalled(); // 非激活标签不重启
  });

  it("退出聚合暂停期激活新标签：以暂停态启动（不变量 confirming ⇒ 已暂停不被轮换打破）", () => {
    const a = fakeInstance(1);
    const b = fakeInstance(2);
    registerInstance("a", a);
    registerInstance("b", b);
    activateInstance("a");
    suspendAllAutoSave();
    activateInstance("b");
    // 暂停屏蔽位生效：弹窗期 Ctrl+Tab 轮换不得让新标签恢复保存定时器，
    // 但须以暂停态建立标脏订阅（弹窗期对它的编辑仍要置脏供复核聚合）
    expect(b.autoSave.start).not.toHaveBeenCalled();
    expect(b.autoSave.startSuspended).toHaveBeenCalledTimes(1);
  });

  it("暂停期激活的新标签在恢复后切回运行态（resume 统一回位）", () => {
    const a = fakeInstance(1);
    const b = fakeInstance(2);
    registerInstance("a", a);
    registerInstance("b", b);
    activateInstance("a");
    suspendAllAutoSave();
    activateInstance("b");
    resumeActiveAutoSave();
    // 恢复：解除屏蔽位并 resume 暂停期激活切换的标签（回运行态）
    expect(b.autoSave.resume).toHaveBeenCalledTimes(1);
    // 屏蔽位已解除：再次激活切换回归正常完整启动（首次激活 + 本次 = 2 次）
    activateInstance("a");
    expect(a.autoSave.start).toHaveBeenCalledTimes(2);
    expect(a.autoSave.startSuspended).not.toHaveBeenCalled();
  });
});
