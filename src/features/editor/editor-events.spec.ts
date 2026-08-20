// 事件桥：markdownUpdated（防抖 300ms）/ updated（防抖 200ms）/ selectionUpdated（即时）
// 跨模块接口（02 自动保存/05 大纲/11 统计消费），100% 覆盖
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Crepe } from "@milkdown/crepe";
import type { Ctx } from "@milkdown/kit/ctx";
import type { ListenerManager } from "@milkdown/kit/plugin/listener";
import { makeTestEditor } from "../../test/editor-test-utils";
import {
  attachEditorEvents,
  destroyEditorEvents,
  detachEditorEvents,
  setupEditorEvents,
} from "./editor-events";

describe("编辑器事件桥", () => {
  /** 当前用例登记事件的 Crepe（afterEach 定向解绑；多实例用例在用例内自行销毁，不登记） */
  let crepeUnderTest: Crepe | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    // 定向清理当前实例（Map 按 crepe 键解绑，重复 detach 幂等）
    if (crepeUnderTest) detachEditorEvents(crepeUnderTest);
    crepeUnderTest = undefined;
    vi.useRealTimers();
  });

  it("markdownUpdated 防抖 300ms 后携带最新 markdown 触发", async () => {
    const te = await makeTestEditor();
    crepeUnderTest = te.crepe;
    const cb = vi.fn();
    attachEditorEvents(te.crepe, { onMarkdownUpdated: cb });

    te.insertText("第一次");
    te.insertText("第二次");
    // 防抖窗口内不应触发
    expect(cb).not.toHaveBeenCalled();
    // 底层 listener 插件自身有 200ms 内部防抖，再叠加本桥 300ms：总窗口 500ms
    vi.advanceTimersByTime(500);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenLastCalledWith(expect.stringContaining("第二次"));
  });

  it("updated 防抖 200ms 后携带文档对象触发", async () => {
    const te = await makeTestEditor();
    crepeUnderTest = te.crepe;
    const cb = vi.fn();
    attachEditorEvents(te.crepe, { onDocUpdated: cb });

    te.insertText("内容");
    // 底层 listener 插件自身有 200ms 内部防抖，再叠加本桥 200ms：总窗口 400ms
    vi.advanceTimersByTime(400);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenLastCalledWith(expect.objectContaining({ type: expect.anything() }));
  });

  it("selectionUpdated 即时触发（无防抖）", async () => {
    const te = await makeTestEditor("文本");
    crepeUnderTest = te.crepe;
    const cb = vi.fn();
    attachEditorEvents(te.crepe, { onSelectionUpdated: cb });

    te.setSelection(0, 1);
    expect(cb).toHaveBeenCalled();
  });

  it("detachEditorEvents 后事件不再触发（含未登记实例幂等 detach）", async () => {
    const te = await makeTestEditor();
    crepeUnderTest = te.crepe;
    const cb = vi.fn();
    attachEditorEvents(te.crepe, { onMarkdownUpdated: cb });
    detachEditorEvents(te.crepe);
    // 未登记实例的 detach 为 no-op（Map 无该 crepe 键，幂等不抛错）
    detachEditorEvents(te.crepe);
    te.insertText("内容");
    // 跨越底层插件 200ms 与本桥 300ms 的完整窗口，验证解绑后不再回调
    vi.advanceTimersByTime(1000);
    expect(cb).not.toHaveBeenCalled();
  });

  it("selectionUpdated 解绑后不再触发（O-8 对称登记）", async () => {
    const te = await makeTestEditor("文本");
    const cb = vi.fn();
    attachEditorEvents(te.crepe, { onSelectionUpdated: cb });
    detachEditorEvents(te.crepe);
    // listener 无法解绑，解绑仅置取消标记：残留事件投递被阻断
    te.setSelection(0, 1);
    expect(cb).not.toHaveBeenCalled();
  });

  it("多实例：销毁一个实例的防抖不影响另一实例（04 P0 回归）", async () => {
    // 真实 Crepe 的 on() 会以 ListenerManager 立即调用注册回调；伪造实例时 mock on()
    // 同步注入假 ListenerManager（与真实行为一致），避免真实实例的多实例开销
    // （事件桥仅依赖 crepe.on 一个入口）
    vi.useRealTimers();
    /** 假实例：on() 立即注入假 api，并登记 markdownUpdated 处理器供用例手动触发 */
    const makeFakeCrepe = () => {
      const api = {
        markdownUpdated: (fn: Parameters<ListenerManager["markdownUpdated"]>[0]) => {
          api.markdownUpdatedHandler = fn;
        },
        markdownUpdatedHandler: undefined as
          Parameters<ListenerManager["markdownUpdated"]>[0] | undefined,
      };
      const crepe = {} as Crepe;
      crepe.on = ((cb) => {
        cb(api as unknown as ListenerManager);
        return crepe;
      }) as Crepe["on"];
      return { crepe, api };
    };
    const crepeA = makeFakeCrepe();
    const crepeB = makeFakeCrepe();
    const eventsA: string[] = [];
    const eventsB: string[] = [];
    setupEditorEvents(crepeA.crepe, { onMarkdownUpdated: (md) => eventsA.push(md) });
    setupEditorEvents(crepeB.crepe, { onMarkdownUpdated: (md) => eventsB.push(md) });
    // 销毁 A：仅取消 A 的防抖，B 的注册与计时不受影响
    destroyEditorEvents(crepeA.crepe);
    // 手动触发 B 的 markdownUpdated 防抖链（ctx 参数在桥内被忽略，仅取 markdown 载荷）
    crepeB.api.markdownUpdatedHandler?.({} as Ctx, "b1", "");
    // 防抖 300ms 后到达（真实计时器）
    await new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(eventsB).toEqual(["b1"]);
        expect(eventsA).toEqual([]);
        resolve();
      }, 350);
    });
  });
});
