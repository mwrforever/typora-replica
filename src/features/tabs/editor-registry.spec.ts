// 实例注册表（04：LRU 判定/adopt 门面切换/激活期 autoSave 订阅管理）
//
// 说明：fake crepe 带 on 桩（真实 editorManager.adopt 经 setupEditorEvents 调用
// crepe.on 注册监听，纯 {} 会抛 TypeError）；autoSave 以 vi.fn 桩验证订阅启停编排。
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  activateInstance,
  clearRegistryForTest,
  getActiveSession,
  getInstance,
  recycleLeastRecent,
  registerInstance,
  unregisterInstance,
} from "./editor-registry";
import type { RegisteredInstance } from "./editor-registry";

function fakeInstance(id: number): RegisteredInstance {
  return {
    crepe: { on: vi.fn() } as never,
    frontMatter: null,
    session: {} as never,
    autoSave: { start: vi.fn(), stop: vi.fn() } as never,
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
});
