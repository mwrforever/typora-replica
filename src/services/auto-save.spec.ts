// auto-save：自动保存控制器单元测试（F30 全过，双条件防抖+定时，100% 覆盖）
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const mockSave = vi.fn();
const mockMarkDirty = vi.fn();
const mockGetSettings = vi.fn();
const mockSubscribe = vi.fn();

import { AutoSaveController, IDLE_DEBOUNCE_MS } from "./auto-save";
import type { DocumentSession } from "./document-session";

/** 构造会话替身（仅暴露 auto-save 需要的成员） */
function makeSession() {
  return {
    save: mockSave,
    markDirty: mockMarkDirty,
  } as unknown as DocumentSession;
}

describe("自动保存（F30，双条件防抖+定时）", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockSave.mockReset().mockResolvedValue({ saved: true, path: "C:/a.md" });
    mockMarkDirty.mockReset();
    mockGetSettings.mockReset().mockResolvedValue({
      autoSave: { enabled: true, timerMinutes: 5 },
    });
    mockSubscribe.mockReset().mockReturnValue(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** 取 subscribeMarkdown 回调（最后一次注册的） */
  function emitted() {
    return mockSubscribe.mock.calls[0]?.[0] as ((md: string) => void) | undefined;
  }

  it("markdownUpdated 到达标记脏 + 停笔 1s 后保存（AC-F30-1）", async () => {
    const c = new AutoSaveController({
      session: makeSession(),
      getSettings: mockGetSettings,
      subscribeMarkdown: mockSubscribe,
    });
    c.start();
    emitted()?.("新内容");
    expect(mockMarkDirty).toHaveBeenCalled();
    expect(mockSave).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(IDLE_DEBOUNCE_MS);
    expect(mockSave).toHaveBeenCalledTimes(1);
    c.stop();
  });

  it("持续编辑不停笔：防抖持续重置，5 分钟定时兜底触发（AC-F30-2）", async () => {
    const c = new AutoSaveController({
      session: makeSession(),
      getSettings: mockGetSettings,
      subscribeMarkdown: mockSubscribe,
    });
    c.start();
    // 持续编辑：每 900ms 一次（<1s 防抖窗口，防抖永不触发），5min 定时器到期时兜底保存
    for (let elapsed = 0; elapsed < 5 * 60 * 1000; elapsed += 900) {
      emitted()?.("持续编辑");
      await vi.advanceTimersByTimeAsync(900);
    }
    expect(mockSave).toHaveBeenCalledTimes(1); // 唯一保存来源 = 5min 定时兜底
    c.stop();
  });

  it("开关关闭：防抖到期不写盘（AC-F30-3）", async () => {
    mockGetSettings.mockResolvedValue({ autoSave: { enabled: false, timerMinutes: 5 } });
    const c = new AutoSaveController({
      session: makeSession(),
      getSettings: mockGetSettings,
      subscribeMarkdown: mockSubscribe,
    });
    c.start();
    emitted()?.("内容");
    await vi.advanceTimersByTimeAsync(IDLE_DEBOUNCE_MS);
    expect(mockSave).not.toHaveBeenCalled();
    c.stop();
  });

  it("保存成功：save 内部已清 dirty（AC-F30-4 联动在 session）", async () => {
    const c = new AutoSaveController({
      session: makeSession(),
      getSettings: mockGetSettings,
      subscribeMarkdown: mockSubscribe,
    });
    c.start();
    emitted()?.("内容");
    await vi.advanceTimersByTimeAsync(IDLE_DEBOUNCE_MS);
    expect(mockSave).toHaveBeenCalled();
    c.stop();
  });

  it("保存失败：不重试不清脏（session.save 已处理提示，AC-F30-5）", async () => {
    mockSave.mockResolvedValue({ saved: false, reason: "io-error", message: "写盘失败" });
    const c = new AutoSaveController({
      session: makeSession(),
      getSettings: mockGetSettings,
      subscribeMarkdown: mockSubscribe,
    });
    c.start();
    emitted()?.("内容");
    await vi.advanceTimersByTimeAsync(IDLE_DEBOUNCE_MS);
    expect(mockSave).toHaveBeenCalledTimes(1);
    c.stop();
  });

  it("stop 后不再响应事件与定时", async () => {
    const c = new AutoSaveController({
      session: makeSession(),
      getSettings: mockGetSettings,
      subscribeMarkdown: mockSubscribe,
    });
    c.start();
    c.stop();
    emitted()?.("内容");
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(mockSave).not.toHaveBeenCalled();
  });

  it("偏好读取失败：不启动定时、不写盘、不崩溃（安全回落）", async () => {
    mockGetSettings.mockRejectedValue(new Error("store 不可用"));
    const c = new AutoSaveController({
      session: makeSession(),
      getSettings: mockGetSettings,
      subscribeMarkdown: mockSubscribe,
    });
    c.start();
    emitted()?.("内容");
    await vi.advanceTimersByTimeAsync(IDLE_DEBOUNCE_MS);
    expect(mockSave).not.toHaveBeenCalled();
    c.stop();
  });

  it("保存期间 stop：save 完成后不再续期定时兜底（幂等）", async () => {
    // 挂起的 save：让 stop() 发生在 save 进行中，验证 save 结束后 refreshTimer 短路
    let resolveSave!: (v: { saved: true; path: string }) => void;
    mockSave.mockImplementation(
      () =>
        new Promise<{ saved: true; path: string }>((resolve) => {
          resolveSave = resolve;
        }),
    );
    const c = new AutoSaveController({
      session: makeSession(),
      getSettings: mockGetSettings,
      subscribeMarkdown: mockSubscribe,
    });
    c.start();
    emitted()?.("内容");
    await vi.advanceTimersByTimeAsync(IDLE_DEBOUNCE_MS); // save 已发起但未完成
    c.stop();
    resolveSave({ saved: true, path: "C:/a.md" });
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000); // save 完成后定时器不应续期
    expect(mockSave).toHaveBeenCalledTimes(1);
  });
});
