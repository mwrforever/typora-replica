// 插图入口分流测试：剪贴板 URL 直写 / 对话框批量导入 / 取消静默 / 多文件拖拽钉桩（AC-P1-1/2/3/4）
//
// 第一至三条与错误通道用轻量依赖桩直测 action 函数体逻辑（零 Tauri 依赖）；
// 第四、五条为集成钉桩，沿 E15 spec 的 fakeFileList 手法装配真实 Crepe 实例。
import { fireEvent } from "@testing-library/dom";
import { editorViewCtx } from "@milkdown/kit/core";
import type { Ctx } from "@milkdown/kit/ctx";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../../services/settings";
import type { ImageSettings } from "../../services/settings";
import { createMarkwellEditor } from "../editor/create-editor";
import { setUploadHandler } from "../editor/image-upload";
import { insertLocalImagesAction } from "./insert-local-image";
import type { InsertDeps } from "./insert-local-image";

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

/** 构造图片设置（缺省对齐全关默认值，用例按需覆写开关） */
function makeSettings(overrides: Partial<ImageSettings> = {}): ImageSettings {
  return { ...DEFAULT_SETTINGS.image, ...overrides };
}

/**
 * 构造 FileList 兼容对象（沿 E15 手法）：jsdom 无 DataTransfer/FileList 构造入口，
 * 而 Crepe 内置上传器按 files.length + files.item(i) 遍历（普通数组缺 item() 会抛错）。
 */
function fakeFileList(...files: File[]): FileList {
  return {
    length: files.length,
    item: (i: number) => files[i] ?? null,
    0: files[0],
    [Symbol.iterator]: function* () {
      yield* files;
    },
  } as unknown as FileList;
}

/**
 * 构造拖拽事件载荷（沿 E15 手法）：jsdom 无 DataTransfer，以普通对象充当；
 * getData 恒返回空串避免误入文本粘贴路径。
 */
function fakeDataTransfer(files: FileList): {
  files: FileList;
  types: string[];
  getData: () => string;
} {
  return { files, types: ["Files"], getData: () => "" };
}

describe("insertLocalImagesAction（轻量桩直测函数体）", () => {
  it("AC-P1-3 剪贴板图片 URL 直写 src，不开对话框", async () => {
    const insertImage = vi.fn();
    const showOpenDialog = vi.fn();
    const deps: InsertDeps = {
      readClipboard: async () => "https://a.com/x.png",
      showOpenDialog,
      insertImage,
      getContext: () => ({ documentSaved: false, frontMatter: null }),
      getSettings: () => makeSettings(),
    };
    // URL 直写路径不触碰文档上下文之外的任何 Tauri 能力；ctx 仅透传给注入的插入器
    const command = insertLocalImagesAction(deps)({} as unknown as Ctx);
    await vi.waitFor(() =>
      expect(insertImage).toHaveBeenCalledWith(expect.anything(), "https://a.com/x.png"),
    );
    expect(showOpenDialog).not.toHaveBeenCalled();
    // 恒返回 true 消费按键（异步流程后台执行的按键契约）
    expect(command({} as never)).toBe(true);
  });

  it("AC-P1-1 对话框选中 2 张 → import_local_images 批量导入并逐 DTO 按策略插入", async () => {
    const insertImage = vi.fn();
    // 非图片扩展名的 http 文本不得误入直写分支——必须走对话框链路
    const invoke = vi.fn(async () => [
      // 同级相对 src + ./ 前缀开 → 产 "./a.png"（策略组合覆盖）
      { absolutePath: "C:\\docs\\a.png", relativeSrc: "a.png" },
      // relativeSrc null（跨盘符不可算）→ 降级绝对路径
      { absolutePath: "C:\\pic\\b.png", relativeSrc: null },
    ]);
    const deps: InsertDeps = {
      readClipboard: async () => "https://a.com/page.html",
      showOpenDialog: async () => ["C:\\pic\\a.png", "C:\\pic\\b.png"],
      invoke,
      getContext: () => ({
        documentSaved: true,
        docDir: "C:\\docs",
        // frontmatter 相对值以 docDir 为拼接基准且优先于全局设置（pickTargetDir 同一口径）
        frontMatter: "typora-copy-images-to: assets",
      }),
      getSettings: () => makeSettings({ relativePathEnabled: true, dotSlashPrefixEnabled: true }),
      insertImage,
    };
    insertLocalImagesAction(deps)({} as unknown as Ctx);
    await vi.waitFor(() => expect(insertImage).toHaveBeenCalledTimes(2));
    // 目标决策复用 Task 6 pickTargetDir；docDir 直传 Rust 作相对 src 计算基准
    expect(invoke).toHaveBeenCalledWith("import_local_images", {
      paths: ["C:\\pic\\a.png", "C:\\pic\\b.png"],
      targetDir: "C:\\docs/assets",
      docDir: "C:\\docs",
    });
    // DTO1：同级相对路径命中 ./ 前缀开关；DTO2：跨盘符降级绝对路径
    expect(insertImage).toHaveBeenNthCalledWith(1, expect.anything(), "./a.png");
    expect(insertImage).toHaveBeenNthCalledWith(2, expect.anything(), "C:\\pic\\b.png");
  });

  it("对话框取消或空选 → 零副作用（invoke/insertImage 均不触发）", async () => {
    // 三态归一的两种「无选择」形态：null（用户取消）与 []（空多选）
    for (const noSelection of [null, [] as string[]]) {
      const invoke = vi.fn();
      const insertImage = vi.fn();
      const deps: InsertDeps = {
        readClipboard: async () => "",
        showOpenDialog: async () => noSelection,
        invoke,
        insertImage,
        getContext: () => ({ documentSaved: false, frontMatter: null }),
        getSettings: () => makeSettings(),
      };
      insertLocalImagesAction(deps)({} as unknown as Ctx);
      // 异步链路在微任务轮内走完（剪贴板→对话框→早退），留一拍宏任务后断言无副作用
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(invoke).not.toHaveBeenCalled();
      expect(insertImage).not.toHaveBeenCalled();
    }
  });

  it("导入失败经 notifyError 上浮中文提示且不抛出（错误通道）", async () => {
    const notifyError = vi.fn();
    const deps: InsertDeps = {
      readClipboard: async () => "",
      showOpenDialog: async () => ["C:\\pic\\gone.png"],
      invoke: async () => {
        throw new Error("读取图片失败");
      },
      notifyError,
      getContext: () => ({ documentSaved: false, frontMatter: null }),
      getSettings: () => makeSettings(),
    };
    // 错误被 catch 收敛为用户可见提示，不向编辑器异常路径逃逸
    expect(insertLocalImagesAction(deps)({} as unknown as Ctx)({} as never)).toBe(true);
    await vi.waitFor(() =>
      expect(notifyError).toHaveBeenCalledWith(
        expect.stringContaining("插入本地图片失败：读取图片失败"),
      ),
    );
  });
});

describe("拖拽链路钉桩（真实 Crepe 装配）", () => {
  afterEach(() => setUploadHandler(undefined));

  /** 装配带注册表处理器的编辑器并返回视图（用例结束由 setup 基座统一销毁存活实例之外，本组手动 destroy） */
  async function setupEditor() {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const crepe = createMarkwellEditor(root, "");
    await crepe.create();
    return { crepe, view: crepe.editor.action((ctx) => ctx.get(editorViewCtx)) };
  }

  it("AC-P1-2 多文件拖拽 Crepe 原生逐一回调 onUpload（3 文件计数桩）", async () => {
    const onUpload = vi.fn(async (file: File) => `up://${file.name}`);
    setUploadHandler(onUpload);
    const { crepe, view } = await setupEditor();
    const files = [
      new File(["a"], "one.png", { type: "image/png" }),
      new File(["b"], "two.png", { type: "image/png" }),
      new File(["c"], "three.png", { type: "image/png" }),
    ];
    fireEvent.drop(view.dom, {
      dataTransfer: fakeDataTransfer(fakeFileList(...files)),
      clientX: 0,
      clientY: 0,
    });
    // Crepe 内置上传器按 files 列表遍历，逐文件回调 onUpload（无需新代码的原生行为钉桩）
    await vi.waitFor(() => expect(onUpload).toHaveBeenCalledTimes(3));
    for (const file of files) expect(onUpload).toHaveBeenCalledWith(file);
    // 三张图全部插入文档
    await vi.waitFor(() => expect(view.dom.querySelectorAll("img")).toHaveLength(3));
    await crepe.destroy();
  });

  it("AC-P1-4 探针：非图片文件拖入不被误插（Crepe 原生过滤钉桩）", async () => {
    const onUpload = vi.fn(async (file: File) => `up://${file.name}`);
    setUploadHandler(onUpload);
    const { crepe, view } = await setupEditor();
    const txt = new File(["hello"], "note.txt", { type: "text/plain" });
    fireEvent.drop(view.dom, {
      dataTransfer: fakeDataTransfer(fakeFileList(txt)),
      clientX: 0,
      clientY: 0,
    });
    // Crepe builder 级 uploader 先按 file.type 过滤再回调 onUpload——.txt 被原生静默忽略。
    // 「不发生」断言无法 waitFor（恒立即通过），以一拍宏任务给异步链路留足触发窗口
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(onUpload).not.toHaveBeenCalled();
    expect(view.dom.querySelector("img")).toBeNull();
    await crepe.destroy();
  });
});
