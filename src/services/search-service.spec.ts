// search-service：全局搜索命令桥单元测试（隔离 Tauri 运行时，100% 覆盖）
//
// 沿 file-io.spec 的 @tauri-apps/api/core mock 惯例；Channel 工厂提供可赋值的
// onmessage 字段即可满足事件投递语义。invoke 调用记录经 hoisted 容器收集，
// 错误路径经可换桩 rejectNext 注入（vi.mock 工厂闭包内不可直接改写外部 let，
// 与 store spec 的 service 桩同款写法）。
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  /** 每次 invoke 的 [cmd, args] 记录 */
  invokes: [] as Array<{ cmd: string; args?: Record<string, unknown> }>,
  /** 可换拒绝桩：非空时下一次 invoke 以该值拒绝并自清（无效正则等错误路径） */
  rejectNext: undefined as unknown,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...a: unknown[]) => {
    h.invokes.push({ cmd: a[0] as string, args: a[1] as Record<string, unknown> | undefined });
    if (h.rejectNext !== undefined) {
      const err = h.rejectNext;
      h.rejectNext = undefined;
      return Promise.reject(err);
    }
    return Promise.resolve(undefined);
  },
  Channel: class {
    onmessage: unknown = undefined;
  },
}));

import { cancelGlobalSearch, startGlobalSearch } from "./search-service";
import { FileIoError } from "./file-io";

beforeEach(() => {
  h.invokes.length = 0;
  h.rejectNext = undefined;
});

describe("search-service 命令桥", () => {
  it("startGlobalSearch 经 Channel 注册批量回调并透传 root/query/opts/maxResults", async () => {
    const batches: unknown[][] = [];
    const onBatch = (evs: unknown[]) => batches.push(evs);
    await startGlobalSearch(
      "C:/ws",
      "关键词",
      { caseSensitive: true, wholeWord: false, regexp: false },
      onBatch,
    );
    expect(h.invokes).toHaveLength(1);
    // wire 契约（spec §5.3①）：命令名 search_in_folder + 三开关快照 + 上限 50
    expect(h.invokes[0].cmd).toBe("search_in_folder");
    expect(h.invokes[0].args).toMatchObject({
      root: "C:/ws",
      query: "关键词",
      opts: { caseSensitive: true, wholeWord: false, regexp: false, maxResults: 50 },
    });
    // 实现侧 new Channel 后赋值 onmessage 再 invoke：args.channel 与之同一实例，
    // 回调注册语义按 onmessage 为函数断言（工厂构造期记录不到赋值后的字段）
    const channel = h.invokes[0].args?.channel as { onmessage: unknown };
    expect(channel.onmessage).toBeTypeOf("function");
  });

  it("cancelGlobalSearch 幂等调用 cancel_search（无任务亦成功）", async () => {
    await cancelGlobalSearch();
    expect(h.invokes).toHaveLength(1);
    expect(h.invokes[0].cmd).toBe("cancel_search");
  });

  it("invoke 拒绝字符串错误时抛 FileIoError（中文消息透传）", async () => {
    h.rejectNext = "无效的搜索表达式: unclosed group";
    await expect(
      startGlobalSearch(
        "C:/ws",
        "(",
        { caseSensitive: false, wholeWord: false, regexp: true },
        () => {},
      ),
    ).rejects.toThrow(FileIoError);
    h.rejectNext = "无效的搜索表达式: unclosed group";
    await expect(
      startGlobalSearch(
        "C:/ws",
        "(",
        { caseSensitive: false, wholeWord: false, regexp: true },
        () => {},
      ),
    ).rejects.toThrow("无效的搜索表达式");
  });

  it("invoke 拒绝 Error 实例时取 message 包装为 FileIoError", async () => {
    h.rejectNext = new Error("扫描目录失败: 拒绝访问");
    await expect(cancelGlobalSearch()).rejects.toThrow(FileIoError);
    h.rejectNext = new Error("扫描目录失败: 拒绝访问");
    await expect(
      startGlobalSearch(
        "C:/ws",
        "词",
        { caseSensitive: false, wholeWord: false, regexp: false },
        () => {},
      ),
    ).rejects.toThrow("扫描目录失败");
  });

  it("invoke 拒绝非字符串/非 Error 时给通用中文消息", async () => {
    h.rejectNext = { code: 1 };
    await expect(
      startGlobalSearch(
        "C:/ws",
        "词",
        { caseSensitive: false, wholeWord: false, regexp: false },
        () => {},
      ),
    ).rejects.toThrow("未知全局搜索错误");
    h.rejectNext = { code: 1 };
    await expect(cancelGlobalSearch()).rejects.toThrow(FileIoError);
  });
});
