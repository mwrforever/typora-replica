// 事件桥：markdownUpdated（防抖 300ms）/ updated（防抖 200ms）/ selectionUpdated（即时）
// 跨模块接口（02 自动保存/05 大纲/11 统计消费），100% 覆盖
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeTestEditor } from "../test/editor-test-utils";
import { attachEditorEvents, detachEditorEvents } from "./editor-events";

describe("编辑器事件桥", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    detachEditorEvents();
    vi.useRealTimers();
  });

  it("markdownUpdated 防抖 300ms 后携带最新 markdown 触发", async () => {
    const te = await makeTestEditor();
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
    const cb = vi.fn();
    attachEditorEvents(te.crepe, { onSelectionUpdated: cb });

    te.setSelection(0, 1);
    expect(cb).toHaveBeenCalled();
  });

  it("detachEditorEvents 后事件不再触发", async () => {
    const te = await makeTestEditor();
    const cb = vi.fn();
    attachEditorEvents(te.crepe, { onMarkdownUpdated: cb });
    detachEditorEvents();
    te.insertText("内容");
    // 跨越底层插件 200ms 与本桥 300ms 的完整窗口，验证解绑后不再回调
    vi.advanceTimersByTime(1000);
    expect(cb).not.toHaveBeenCalled();
  });
});
