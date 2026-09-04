// onUpload 编排层：目标决策序/文件名分流/policy 拼 src/失败回落（AC-P2 系列）
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../../services/settings";
import {
  createImageUploadHandler,
  pickTargetDir,
  resolveCopyTarget,
  type ImageDocContext,
} from "./upload-flow";

function makeFile(name: string, type = "image/png"): File {
  return new File(["fake"], name, { type });
}
const savedCtx: ImageDocContext = {
  documentSaved: true,
  docDir: "C:\\docs",
  frontMatter: null,
};

function makeDeps(overrides: Partial<Parameters<typeof createImageUploadHandler>[0]> = {}) {
  const invoke = vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
    if (cmd === "save_image") {
      const a = args as { docDir?: string; targetDir?: string };
      return {
        absolutePath: "C:\\docs\\out.png",
        relativeSrc: a.docDir ? "out.png" : null,
      };
    }
    throw new Error(`未知命令 ${cmd}`);
  });
  return {
    invoke,
    getContext: vi.fn(() => savedCtx),
    getSettings: vi.fn(() => DEFAULT_SETTINGS.image),
    notifyError: vi.fn(),
    ...overrides,
  };
}

describe("resolveCopyTarget", () => {
  it("绝对路径原样", () => {
    expect(resolveCopyTarget("D:\\imgs", "C:\\docs")).toBe("D:\\imgs");
  });
  it("相对值拼 docDir", () => {
    expect(resolveCopyTarget("imgs", "C:\\docs")).toBe("C:\\docs/imgs");
  });
  it("相对值无 docDir → undefined（降级临时目录链路）", () => {
    expect(resolveCopyTarget("imgs", undefined)).toBeUndefined();
  });
  it("空值 → undefined", () => {
    expect(resolveCopyTarget(undefined, "C:\\docs")).toBeUndefined();
  });
});

describe("pickTargetDir", () => {
  const settingsOn = {
    ...DEFAULT_SETTINGS.image,
    copyToFolderEnabled: true,
    copyTargetDir: "C:\\global",
  };
  it("frontmatter 配置优先于全局设置", () => {
    expect(
      pickTargetDir({ ...savedCtx, frontMatter: "typora-copy-images-to: fm-imgs" }, settingsOn),
    ).toBe("C:\\docs/fm-imgs");
  });
  it("无 frontmatter 时回落全局开关+目录", () => {
    expect(pickTargetDir(savedCtx, settingsOn)).toBe("C:\\global");
  });
  it("开关开但目录空串视为未配置", () => {
    expect(pickTargetDir(savedCtx, { ...settingsOn, copyTargetDir: "" })).toBeUndefined();
  });
  it("双无来源 → undefined（降级 Rust 临时目录链路）", () => {
    expect(pickTargetDir(savedCtx, DEFAULT_SETTINGS.image)).toBeUndefined();
  });
});

describe("createImageUploadHandler", () => {
  it("AC-P2-1a 默认开关下已保存文档 → 目标目录正确且 src 为绝对路径", async () => {
    const deps = makeDeps();
    const src = await createImageUploadHandler(deps)(makeFile("photo.jpg", "image/jpeg"));
    const args = vi.mocked(deps.invoke).mock.calls[0][1] as Record<string, unknown>;
    // 未开 copy-to-folder：target_dir 走 Rust 临时目录缺省（undefined）
    expect(args.targetDir).toBeUndefined();
    expect(args.docDir).toBe("C:\\docs");
    expect(args.mime).toBe("image/jpeg");
    expect(src).toBe("C:\\docs\\out.png"); // relativePathEnabled 默认关 → 绝对
  });
  it("AC-P2-1b 全局开关开+relative 开 → 写目标目录且 src 为相对路径", async () => {
    const deps = makeDeps({
      getSettings: vi.fn(() => ({
        ...DEFAULT_SETTINGS.image,
        copyToFolderEnabled: true,
        copyTargetDir: "C:\\imgs",
        relativePathEnabled: true,
      })),
    });
    const src = await createImageUploadHandler(deps)(makeFile("photo.jpg"));
    const args = vi.mocked(deps.invoke).mock.calls[0][1] as Record<string, unknown>;
    expect(args.targetDir).toBe("C:\\imgs");
    expect(src).toBe("out.png");
  });
  it("AC-P2-2 合成剪贴板名 → name=null（Rust 生成时间戳名）", async () => {
    const deps = makeDeps();
    await createImageUploadHandler(deps)(makeFile("image.png"));
    const args = vi.mocked(deps.invoke).mock.calls[0][1] as Record<string, unknown>;
    expect(args.name).toBeNull();
  });
  it("真实文件名保留传递", async () => {
    const deps = makeDeps();
    await createImageUploadHandler(deps)(makeFile("照片.png"));
    const args = vi.mocked(deps.invoke).mock.calls[0][1] as Record<string, unknown>;
    expect(args.name).toBe("照片.png");
  });
  it("AC-P2-4 未保存文档 → docDir=None 且 src 绝对路径", async () => {
    const deps = makeDeps({
      getContext: vi.fn(() => ({ documentSaved: false, docDir: undefined, frontMatter: null })),
    });
    const src = await createImageUploadHandler(deps)(makeFile("a.png"));
    const args = vi.mocked(deps.invoke).mock.calls[0][1] as Record<string, unknown>;
    expect(args.docDir).toBeUndefined();
    expect(src).toBe("C:\\docs\\out.png"); // invoke stub 无 docDir 时 relativeSrc=null
  });
  it("frontmatter copy-images-to 优先于全局设置", async () => {
    const deps = makeDeps({
      getContext: vi.fn(() => ({
        ...savedCtx,
        frontMatter: "title: t\ntypora-copy-images-to: fm-imgs",
      })),
      getSettings: vi.fn(() => ({
        ...DEFAULT_SETTINGS.image,
        copyToFolderEnabled: true,
        copyTargetDir: "C:\\global",
      })),
    });
    await createImageUploadHandler(deps)(makeFile("a.png"));
    const args = vi.mocked(deps.invoke).mock.calls[0][1] as Record<string, unknown>;
    expect(args.targetDir).toBe("C:\\docs/fm-imgs");
  });
  it("AC-P2-5 存盘失败 → notifyError + blob 回落不崩溃", async () => {
    const deps = makeDeps({
      invoke: vi.fn(async () => {
        throw new Error("磁盘已满");
      }),
      createObjectUrl: vi.fn(() => "blob:fallback"),
    });
    const src = await createImageUploadHandler(deps)(makeFile("a.png"));
    expect(deps.notifyError).toHaveBeenCalledWith(expect.stringContaining("磁盘已满"));
    expect(src).toBe("blob:fallback");
  });
  it("mime 空类型文件回落 image/png（拖入未知类型场景）", async () => {
    const deps = makeDeps();
    await createImageUploadHandler(deps)(makeFile("x", ""));
    const args = vi.mocked(deps.invoke).mock.calls[0][1] as Record<string, unknown>;
    expect(args.mime).toBe("image/png");
  });
  it("非 Error 抛出物（IPC 字符串错误）同样归一提示并回落", async () => {
    const deps = makeDeps({
      invoke: vi.fn(async () => {
        throw "IPC 通道断开"; // 抛非 Error 值，覆盖「IPC 字符串错误归一」分支
      }),
      createObjectUrl: vi.fn(() => "blob:fallback"),
    });
    const src = await createImageUploadHandler(deps)(makeFile("a.png"));
    expect(deps.notifyError).toHaveBeenCalledWith(expect.stringContaining("IPC 通道断开"));
    expect(src).toBe("blob:fallback");
  });
  it("未注入 invoke/createObjectUrl 时走 Tauri 缺省通道，IPC 失败仍回落 blob 不崩溃", async () => {
    // jsdom 无 __TAURI_INTERNALS__，真实 tauriInvoke 必然抛错——恰好验证缺省链路
    // 的失败回落；jsdom 无 URL.createObjectURL，先补桩避免回落二次抛出
    // （vitest 按文件隔离环境，本桩不外溢其他 spec）
    URL.createObjectURL = vi.fn(() => "blob:default-stub");
    const deps = {
      getContext: vi.fn(() => savedCtx),
      getSettings: vi.fn(() => DEFAULT_SETTINGS.image),
      notifyError: vi.fn(),
    };
    const src = await createImageUploadHandler(deps)(makeFile("a.png"));
    expect(deps.notifyError).toHaveBeenCalledTimes(1);
    expect(vi.mocked(deps.notifyError).mock.calls[0][0]).toContain("图片存盘失败");
    expect(src).toBe("blob:default-stub");
  });
});
