// 实例注册表（04：LRU 判定/adopt 门面切换/激活期 autoSave 订阅管理）
//
// 说明：fake crepe 带 on 桩（真实 editorManager.adopt 经 setupEditorEvents 调用
// crepe.on 注册监听，纯 {} 会抛 TypeError）；autoSave 以 vi.fn 桩验证订阅启停编排。
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  activateInstance,
  clearRegistryForTest,
  getActiveFrontMatter,
  getActiveSession,
  getInstance,
  recycleLeastRecent,
  registerInstance,
  startActiveAutoSave,
  stopAllAutoSave,
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

  it("stopAllAutoSave：停全部实例自动保存（12 退出聚合弹窗期暂停）", () => {
    const a = fakeInstance(1);
    const b = fakeInstance(2);
    registerInstance("a", a);
    registerInstance("b", b);
    activateInstance("a");
    stopAllAutoSave();
    // 全实例（含非激活标签）一律 stop——confirming 期不写盘
    expect(a.autoSave.stop).toHaveBeenCalled();
    expect(b.autoSave.stop).toHaveBeenCalled();
  });

  it("startActiveAutoSave：仅恢复激活标签；无激活标签安全返回", () => {
    const a = fakeInstance(1);
    const b = fakeInstance(2);
    registerInstance("a", a);
    registerInstance("b", b);
    startActiveAutoSave(); // 从未激活：adoptedTabId 为 undefined → no-op
    expect(a.autoSave.start).not.toHaveBeenCalled();
    expect(b.autoSave.start).not.toHaveBeenCalled();
    activateInstance("a");
    startActiveAutoSave();
    expect(a.autoSave.start).toHaveBeenCalledTimes(2); // activate 一次 + 恢复一次
    expect(b.autoSave.start).not.toHaveBeenCalled(); // 非激活标签不重启
  });
});
