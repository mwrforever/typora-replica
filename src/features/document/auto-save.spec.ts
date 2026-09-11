// auto-save：自动保存控制器单元测试（F30 全过，双条件防抖+定时，100% 覆盖）
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const mockSave = vi.fn();
const mockMarkDirty = vi.fn();
const mockGetSettings = vi.fn();
const mockSubscribe = vi.fn();

import { AutoSaveController, IDLE_DEBOUNCE_MS } from "./auto-save";
import type { DocumentSession } from "./document-session";

/** 构造会话替身（仅暴露 auto-save 需要的成员；dirty 默认 true=编辑过） */
function makeSession(dirty = true) {
  return {
    save: mockSave,
    markDirty: mockMarkDirty,
    dirty,
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

  /** 取 subscribeMarkdown 回调（最新注册的——stop 后 resume 重订时旧回调已退订） */
  function emitted() {
    return mockSubscribe.mock.calls.at(-1)?.[0] as ((md: string) => void) | undefined;
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

  it("干净文档定时到期不写盘（A 修复：无编辑不重写磁盘）", async () => {
    const c = new AutoSaveController({
      session: makeSession(false),
      getSettings: mockGetSettings,
      subscribeMarkdown: mockSubscribe,
    });
    c.start();
    // 无任何编辑：5 分钟定时兜底到期时脏状态为 false，不得触发写盘
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(mockSave).not.toHaveBeenCalled();
    c.stop();
  });

  it("停笔定时器到期前文档已切换（openFile 清 dirty）：不落错文件（B 修复）", async () => {
    const session = makeSession();
    const c = new AutoSaveController({
      session,
      getSettings: mockGetSettings,
      subscribeMarkdown: mockSubscribe,
    });
    c.start();
    emitted()?.("A 文档内容"); // 编辑 A 停笔，1s 定时器启动
    // 定时器到期前打开 B（openFile 清除脏状态）；到期时不得把 A 内容写盘
    session.dirty = false;
    await vi.advanceTimersByTimeAsync(IDLE_DEBOUNCE_MS);
    expect(mockSave).not.toHaveBeenCalled();
    c.stop();
  });

  it("BUG-1 保存进行中再次触发：让位不并发，完成后补跑一次", async () => {
    // 第一次 save 挂起（模拟慢写盘）；第二次请求在途时不得并发发起写盘
    let resolveSave!: (v: { saved: true; path: string }) => void;
    mockSave
      .mockImplementationOnce(
        () => new Promise<{ saved: true; path: string }>((resolve) => (resolveSave = resolve)),
      )
      .mockResolvedValue({ saved: true, path: "C:/a.md" });
    const c = new AutoSaveController({
      session: makeSession(),
      getSettings: mockGetSettings,
      subscribeMarkdown: mockSubscribe,
    });
    c.start();
    emitted()?.("第一轮编辑");
    await vi.advanceTimersByTimeAsync(IDLE_DEBOUNCE_MS); // 第一次 save 发起（挂起）
    expect(mockSave).toHaveBeenCalledTimes(1);
    // 保存期间新编辑触发防抖到期：in-flight 让位（savePending 标记），不得并发发起
    emitted()?.("第二轮编辑");
    await vi.advanceTimersByTimeAsync(IDLE_DEBOUNCE_MS);
    expect(mockSave).toHaveBeenCalledTimes(1); // 仍只有一次（挂起中）
    // 第一次完成：补跑一次覆盖保存期间的新编辑（内容已含最新）
    resolveSave({ saved: true, path: "C:/a.md" });
    await vi.advanceTimersByTimeAsync(10);
    expect(mockSave).toHaveBeenCalledTimes(2);
    c.stop();
  });

  it("BUG-1 保存进行中多次请求只补跑一次", async () => {
    let resolveSave!: (v: { saved: true; path: string }) => void;
    mockSave
      .mockImplementationOnce(
        () => new Promise<{ saved: true; path: string }>((resolve) => (resolveSave = resolve)),
      )
      .mockResolvedValue({ saved: true, path: "C:/a.md" });
    const c = new AutoSaveController({
      session: makeSession(),
      getSettings: mockGetSettings,
      subscribeMarkdown: mockSubscribe,
    });
    c.start();
    emitted()?.("编辑");
    await vi.advanceTimersByTimeAsync(IDLE_DEBOUNCE_MS);
    expect(mockSave).toHaveBeenCalledTimes(1);
    // 保存期间连续两次防抖到期：多个请求合并为一次补跑
    emitted()?.("编辑 2");
    await vi.advanceTimersByTimeAsync(IDLE_DEBOUNCE_MS);
    emitted()?.("编辑 3");
    await vi.advanceTimersByTimeAsync(IDLE_DEBOUNCE_MS);
    resolveSave({ saved: true, path: "C:/a.md" });
    await vi.advanceTimersByTimeAsync(10);
    expect(mockSave).toHaveBeenCalledTimes(2); // 总调用 = 首次 + 补跑一次
    c.stop();
  });

  it("暂停通道（12 退出聚合）：suspend 后编辑仍标脏但停笔防抖不启动（不写盘）", async () => {
    const c = new AutoSaveController({
      session: makeSession(),
      getSettings: mockGetSettings,
      subscribeMarkdown: mockSubscribe,
    });
    c.start();
    c.suspend();
    emitted()?.("弹窗期编辑");
    // 标脏订阅保持活跃：markDirty 照常触达（复核聚合的置脏来源）
    expect(mockMarkDirty).toHaveBeenCalledTimes(1);
    // 保存定时器挂起：停笔防抖不再启动，停笔再久也不写盘
    await vi.advanceTimersByTimeAsync(IDLE_DEBOUNCE_MS);
    expect(mockSave).not.toHaveBeenCalled();
    c.stop();
  });

  it("暂停通道挂起 5 分钟兜底定时器：suspend 前已运转的兜底同样不落盘", async () => {
    const c = new AutoSaveController({
      session: makeSession(),
      getSettings: mockGetSettings,
      subscribeMarkdown: mockSubscribe,
    });
    c.start();
    emitted()?.("编辑"); // 停笔防抖到期前挂起
    c.suspend();
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(mockSave).not.toHaveBeenCalled();
    c.stop();
  });

  it("暂停后恢复：保存定时器重启而订阅不重订（subscribe 仅一次）", async () => {
    const c = new AutoSaveController({
      session: makeSession(),
      getSettings: mockGetSettings,
      subscribeMarkdown: mockSubscribe,
    });
    c.start();
    c.suspend();
    c.resume();
    // 订阅未停不重订：防双订阅导致一次编辑触发两条防抖链
    expect(mockSubscribe).toHaveBeenCalledTimes(1);
    emitted()?.("恢复后编辑");
    await vi.advanceTimersByTimeAsync(IDLE_DEBOUNCE_MS);
    expect(mockSave).toHaveBeenCalledTimes(1);
    c.stop();
  });

  it("运行中重复 resume：无副作用（不重订订阅、不重启定时器读取偏好）", async () => {
    const c = new AutoSaveController({
      session: makeSession(),
      getSettings: mockGetSettings,
      subscribeMarkdown: mockSubscribe,
    });
    c.start();
    const readsAfterStart = mockGetSettings.mock.calls.length;
    c.resume();
    c.resume();
    // 非暂停态 resume 为 no-op：不触发 refreshTimer 的偏好读取
    expect(mockSubscribe).toHaveBeenCalledTimes(1);
    expect(mockGetSettings.mock.calls.length).toBe(readsAfterStart);
    c.stop();
  });

  it("暂停期以暂停态启动（startSuspended）：订阅活跃、双定时器均不运转", async () => {
    const c = new AutoSaveController({
      session: makeSession(),
      getSettings: mockGetSettings,
      subscribeMarkdown: mockSubscribe,
    });
    // 12 退出聚合暂停期的激活切换：控制器此前从未启动（后台标签完整停止态）
    c.startSuspended();
    expect(mockSubscribe).toHaveBeenCalledTimes(1);
    emitted()?.("弹窗期编辑");
    expect(mockMarkDirty).toHaveBeenCalledTimes(1);
    // 停笔防抖与 5 分钟兜底都不得启动（refreshTimer 暂停守卫短路）
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(mockSave).not.toHaveBeenCalled();
    c.stop();
  });

  it("暂停期激活切换后恢复：resume 切回运行态，保存链路照常（AC 不变量回位）", async () => {
    const c = new AutoSaveController({
      session: makeSession(),
      getSettings: mockGetSettings,
      subscribeMarkdown: mockSubscribe,
    });
    c.startSuspended();
    c.resume();
    // 从暂停态恢复：只重启定时器，订阅不重订
    expect(mockSubscribe).toHaveBeenCalledTimes(1);
    emitted()?.("恢复后编辑");
    await vi.advanceTimersByTimeAsync(IDLE_DEBOUNCE_MS);
    expect(mockSave).toHaveBeenCalledTimes(1);
    c.stop();
  });

  it("完全停止态 suspend 安全跳过；resume 完整启动（订阅+定时器）", async () => {
    const c = new AutoSaveController({
      session: makeSession(),
      getSettings: mockGetSettings,
      subscribeMarkdown: mockSubscribe,
    });
    // 从未启动：suspend 无可挂起资源（退订/清定时器均空操作），不得置暂停态
    c.suspend();
    c.resume();
    // resume 走完整启动：重新订阅 + 定时兜底就绪，编辑后停笔即保存
    expect(mockSubscribe).toHaveBeenCalledTimes(1);
    emitted()?.("恢复后编辑");
    await vi.advanceTimersByTimeAsync(IDLE_DEBOUNCE_MS);
    expect(mockSave).toHaveBeenCalledTimes(1);
    c.stop();
  });

  it("暂停期抑制 in-flight 保存的补跑：save 完成后的 savePending 不落盘", async () => {
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
    emitted()?.("第一轮编辑");
    await vi.advanceTimersByTimeAsync(IDLE_DEBOUNCE_MS); // 首次保存发起（挂起中）
    emitted()?.("第二轮编辑"); // 保存期间的编辑请求
    await vi.advanceTimersByTimeAsync(IDLE_DEBOUNCE_MS); // in-flight 让位 → savePending
    c.suspend(); // 弹窗期开始（此刻首次保存仍在途）
    resolveSave({ saved: true, path: "C:/a.md" });
    await vi.advanceTimersByTimeAsync(IDLE_DEBOUNCE_MS);
    // 补跑被暂停守卫拦截：弹窗期零写盘（残余触发由 next 编辑/兜底接管）
    expect(mockSave).toHaveBeenCalledTimes(1);
    c.stop();
  });

  it("运行中重复 start：订阅不重订（防双订阅双写盘）", async () => {
    const c = new AutoSaveController({
      session: makeSession(),
      getSettings: mockGetSettings,
      subscribeMarkdown: mockSubscribe,
    });
    c.start();
    c.start();
    expect(mockSubscribe).toHaveBeenCalledTimes(1);
    emitted()?.("编辑");
    await vi.advanceTimersByTimeAsync(IDLE_DEBOUNCE_MS);
    // 双订阅缺陷回归钉：一次编辑只触发一次保存
    expect(mockSave).toHaveBeenCalledTimes(1);
    c.stop();
  });

  it("stop 复位暂停态：suspend 后 stop 再 resume 走完整启动而非残留挂起", async () => {
    const c = new AutoSaveController({
      session: makeSession(),
      getSettings: mockGetSettings,
      subscribeMarkdown: mockSubscribe,
    });
    c.start();
    c.suspend();
    c.stop();
    c.resume();
    expect(mockSubscribe).toHaveBeenCalledTimes(2); // 首次 + stop 后完整重启
    emitted()?.("编辑");
    await vi.advanceTimersByTimeAsync(IDLE_DEBOUNCE_MS);
    expect(mockSave).toHaveBeenCalledTimes(1);
    c.stop();
  });
});
