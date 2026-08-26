// src/features/image/register.spec.ts
// 装配层：注册表注入生效/context 快照组装/设置失效事件联动/失败回落通道
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getUploadHandler, setUploadHandler } from "../editor/image-upload";

const { invokeMock, loadStoreMock, getActiveSessionMock, getActiveFrontMatterMock } = vi.hoisted(
  () => ({
    /** Tauri IPC 桩（save_image / allow_asset_directory 全走此处） */
    invokeMock: vi.fn(),
    /** plugin-store load 桩：loadSettings 调用计数（设置快照重拉验证依据） */
    loadStoreMock: vi.fn(),
    getActiveSessionMock: vi.fn(() => undefined),
    getActiveFrontMatterMock: vi.fn((): string | null => null),
  }),
);

// 隔离 Tauri IPC：convertFileSrc 仅类型占位（本装配层不直接消费）
vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
  convertFileSrc: vi.fn((p: string) => `asset:${p}`),
}));

// 隔离 editor-registry：活动会话/FM 读取器由各用例控制返回值
vi.mock("../tabs/editor-registry", () => ({
  getActiveSession: getActiveSessionMock,
  getActiveFrontMatter: getActiveFrontMatterMock,
}));

// plugin-store 底座隔离：store.get 恒 undefined → 走真实 loadSettings 默认值合并逻辑，
// 设置快照的「预加载/事件失效重拉」以 load 调用次数观测
vi.mock("@tauri-apps/plugin-store", () => ({
  load: (...a: unknown[]) => loadStoreMock(...a),
}));

/** 构造非合成名 PNG 文件（真实名保留语义，绕开时间戳改名分流） */
function pngFile(): File {
  return new File([new Uint8Array([137, 80, 78, 71])], "photo.png", { type: "image/png" });
}

describe("registerImageFeature", () => {
  beforeEach(async () => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue({
      absolutePath: "C:\\docs\\markwell-images\\photo.png",
      relativeSrc: null,
    });
    loadStoreMock.mockReset();
    loadStoreMock.mockResolvedValue({ get: vi.fn(async () => undefined) });
    getActiveSessionMock.mockReturnValue(undefined);
    getActiveFrontMatterMock.mockReturnValue(null);
    setUploadHandler(undefined);
    // 清态：设置快照为 register.ts 模块级状态，跨用例残留会让「重拉」断言失真——
    // 经真实失效事件清空并触发重拉（同时预热动态导入，用例内 import 命中缓存）
    const { SETTINGS_INVALIDATED_EVENT } = await import("./register");
    window.dispatchEvent(new Event(SETTINGS_INVALIDATED_EVENT));
  });

  it("注册后 getUploadHandler 返回处理器（重复装配幂等不叠加）", async () => {
    const { registerImageFeature, SETTINGS_INVALIDATED_EVENT } = await import("./register");
    // 事件名是 10 设置模块的对接契约，字面量回归防误改
    expect(SETTINGS_INVALIDATED_EVENT).toBe("markwell-settings-updated");
    registerImageFeature();
    registerImageFeature();
    expect(getUploadHandler()).toBeTypeOf("function");
  });

  it("处理器经 getContext 拉取活动会话目录（未打开文档时 documentSaved=false）", async () => {
    const { registerImageFeature } = await import("./register");
    registerImageFeature();
    await getUploadHandler()!(pngFile());
    // 无激活会话：docDir/targetDir 均 undefined（serde None → Rust 落临时目录），
    // 真实文件名保留（合成名才换时间戳），字节经数组通道传输
    expect(invokeMock).toHaveBeenCalledWith(
      "save_image",
      expect.objectContaining({
        bytes: [137, 80, 78, 71],
        name: "photo.png",
        mime: "image/png",
        targetDir: undefined,
        docDir: undefined,
      }),
    );
  });

  it("已保存文档：currentDir/frontMatter 透传，设置失效事件后快照重新拉取", async () => {
    const { registerImageFeature, SETTINGS_INVALIDATED_EVENT } = await import("./register");
    registerImageFeature();
    const sessionNotify = vi.fn();
    // as never：hoisted 桩推断返回 undefined，会话桩仅消费 currentDir/notify 消费面
    getActiveSessionMock.mockReturnValue({
      currentDir: "C:\\docs",
      notify: sessionNotify,
    } as never);
    // 文档级 typora-copy-images-to 相对值以 docDir 为拼接基准（决策序最高优先）
    getActiveFrontMatterMock.mockReturnValue("typora-copy-images-to: assets");
    const handler = getUploadHandler()!;
    await handler(pngFile());
    expect(invokeMock).toHaveBeenCalledWith(
      "save_image",
      expect.objectContaining({ docDir: "C:\\docs", targetDir: "C:\\docs/assets" }),
    );
    // 快照为同步读取（01 注册表 getSettings 同步签名）：上传不触发 store 重拉；
    // 失效事件清空快照并立刻重拉（beforeEach 的失效预加载已计入基线，取增量断言）
    const loadsBaseline = loadStoreMock.mock.calls.length;
    await handler(pngFile());
    expect(loadStoreMock.mock.calls.length).toBe(loadsBaseline);
    window.dispatchEvent(new Event(SETTINGS_INVALIDATED_EVENT));
    await vi.waitFor(() => expect(loadStoreMock.mock.calls.length).toBe(loadsBaseline + 1));
  });

  it("存盘失败经激活会话 notify 上报并回落 blob 占位（AC-P2-5 接线）", async () => {
    const { registerImageFeature } = await import("./register");
    const sessionNotify = vi.fn();
    getActiveSessionMock.mockReturnValue({
      currentDir: "C:\\docs",
      notify: sessionNotify,
    } as never);
    invokeMock.mockRejectedValueOnce(new Error("disk full"));
    // 工厂在创建处理器时即 bind 当时的 createObjectURL——桩必须先于装配替换
    // （本环境 jsdom 已原生实现返回 blob:nodedata:* 随机串，setup 桩不生效）
    const original = URL.createObjectURL;
    URL.createObjectURL = vi.fn(() => "blob:test/photo.png");
    try {
      registerImageFeature();
      const src = await getUploadHandler()!(pngFile());
      expect(src).toBe("blob:test/photo.png");
      expect(sessionNotify).toHaveBeenCalledWith(
        expect.objectContaining({
          level: "error",
          message: expect.stringContaining("图片存盘失败"),
        }),
      );
    } finally {
      URL.createObjectURL = original;
    }
  });
});
