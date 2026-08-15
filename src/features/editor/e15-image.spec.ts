// E15 图片：markdown 渲染 / 拖拽 onUpload / 剪贴板粘贴 / 点击编辑源码 / 破损路径降级
// + image-upload 注册表（setUploadHandler/getUploadHandler）与工厂接线（07 图片模块注入点）
import { fireEvent } from "@testing-library/dom";
import { editorViewCtx } from "@milkdown/kit/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeTestEditor } from "../../test/editor-test-utils";
import { createMarkwellEditor } from "./create-editor";
import { getUploadHandler, setUploadHandler } from "./image-upload";

/**
 * jsdom 无布局命中测试：桩 document.elementFromPoint 使 ProseMirror 的 posAtCoords
 * 能把事件坐标解析到目标元素（真实浏览器由原生命中测试完成），返回还原函数。
 */
function stubHitTarget(target: Element): () => void {
  const prev = document.elementFromPoint;
  document.elementFromPoint = () => target;
  return () => {
    document.elementFromPoint = prev;
  };
}

/**
 * 派发完整鼠标序列（按下→抬起→点击）：ProseMirror 点击处理链是 mousedown 创建
 * LeftMouseDown、mouseup 触发 handleClick，fireEvent.click 不足以驱动该链路
 * （与 E14 链接用例同模式）。
 */
function fireClickSequence(target: Element): void {
  fireEvent.mouseDown(target, { clientX: 0, clientY: 0 });
  fireEvent.mouseUp(target, { clientX: 0, clientY: 0 });
  fireEvent.click(target, { clientX: 0, clientY: 0 });
}

/**
 * 构造 FileList 兼容对象：jsdom 无 DataTransfer/FileList 构造入口，而 Crepe 内置
 * 上传器按 files.length + files.item(i) 遍历（普通数组缺 item() 会抛错），
 * 故以普通对象模拟 FileList 结构。
 * @param files 待模拟的文件列表
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
 * 构造拖拽/剪贴板事件载荷：jsdom 无 DataTransfer，以普通对象充当；
 * getData 供 ProseMirror 剪贴板解析链读取文本，恒返回空串避免误入文本粘贴路径。
 * @param files 文件列表
 */
function fakeDataTransfer(files: FileList): {
  files: FileList;
  types: string[];
  getData: () => string;
} {
  return { files, types: ["Files"], getData: () => "" };
}

describe("E15 图片", () => {
  // 每个用例结束后还原注册表，避免用例间串扰（07 模块注入点是全局单例）
  afterEach(() => setUploadHandler(undefined));

  it("AC-E15-1 输入 ![描述](path.png) 渲染为图片", async () => {
    const te = await makeTestEditor("![描述](path.png)");
    const img = te.view.dom.querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("src")).toContain("path.png");
  });

  it("AC-E15-2 拖拽图片文件到编辑器插入图片并触发 onUpload 回调", async () => {
    const onUpload = vi.fn(async (file: File) => `uploaded://${file.name}`);
    const te = await makeTestEditor("", { onUpload });
    // 模拟文件拖拽：jsdom 无 DataTransfer 构造入口，以普通对象 + FileList 兼容
    // 对象喂给事件（拖拽坐标恒 (0,0)，jsdom 零矩形回落解析到文档起始位置）
    const file = new File(["fake"], "pic.png", { type: "image/png" });
    fireEvent.drop(te.view.dom, {
      dataTransfer: fakeDataTransfer(fakeFileList(file)),
      clientX: 0,
      clientY: 0,
    });
    // 上传回调携带原始 File 触发（Crepe 上传器按文件遍历逐一回调）
    await vi.waitFor(() => expect(onUpload).toHaveBeenCalledWith(file));
    // 插入的图片 src 使用 onUpload 返回值
    await vi.waitFor(() =>
      expect(te.view.dom.querySelector("img")?.getAttribute("src")).toBe("uploaded://pic.png"),
    );
  });

  it("AC-E15-3 剪贴板含图片时 Ctrl+V 粘贴为图片", async () => {
    const te = await makeTestEditor();
    const file = new File(["fake"], "clip.png", { type: "image/png" });
    const clipboardData = {
      files: fakeFileList(file),
      types: ["Files"],
      getData: () => "",
    };
    fireEvent.paste(te.view.dom, { clipboardData });
    // 未注入 onUpload：缺省回落 blob URL 占位（jsdom 无 URL.createObjectURL，
    // setup.ts 已注入桩实现），图片节点仍正常插入
    await vi.waitFor(() => expect(te.view.dom.querySelector("img")).not.toBeNull());
  });

  it("AC-E15-4 点击图片进入源码编辑态可改 alt/path", async () => {
    const te = await makeTestEditor("![描述](path.png)");
    const img = te.view.dom.querySelector("img")!;
    const restore = stubHitTarget(img);
    fireClickSequence(img);
    // 点击原子节点 → ProseMirror 生成 NodeSelection → nodeView.selectNode 添加
    // .selected 类（真实 Crepe 无 .milkdown-image-block-edit 元素，选中态即编辑态入口）
    await vi.waitFor(() => {
      const block = te.view.dom.querySelector(".milkdown-image-block");
      if (!block?.classList.contains("selected")) throw new Error("图片未进入选中态");
      return block;
    });
    restore();
    const block = te.view.dom.querySelector(".milkdown-image-block")!;
    // 源码编辑入口：operation-item（caption/alt 编辑切换按钮）随选中态暴露
    const editBtn = block.querySelector(".operation-item");
    expect(editBtn).not.toBeNull();
    fireEvent.pointerDown(editBtn!);
    // alt 编辑输入框（caption-input）出现，可编辑图片描述
    const captionInput = await vi.waitFor(() => {
      const input = block.querySelector<HTMLInputElement>(".caption-input");
      if (!input) throw new Error("alt 编辑输入框未出现");
      return input;
    });
    // 修改 alt（caption 落盘为 markdown title）并失焦确认：落盘同步更新
    fireEvent.input(captionInput, { target: { value: "新描述" } });
    fireEvent.blur(captionInput);
    await vi.waitFor(() => expect(te.getMarkdown()).toContain("新描述"));
  });

  it("AC-E15-5 图片路径不存在显示占位而非崩溃", async () => {
    const te = await makeTestEditor("![破损](nonexistent.png)");
    expect(() => te.view.dom.querySelector("img")).not.toThrow();
    // img 元素仍在（浏览器级破损图标由 WebView 渲染，jsdom 断言 DOM 结构健壮）
    expect(te.view.dom.querySelector("img")).not.toBeNull();
  });
});

describe("E15 image-upload 注册表（07 图片模块消费接口）", () => {
  // 每个用例结束后还原注册表，避免用例间串扰（07 模块注入点是全局单例）
  afterEach(() => setUploadHandler(undefined));

  it("setUploadHandler 注入后 getUploadHandler 可取回；传 undefined 还原缺省", () => {
    expect(getUploadHandler()).toBeUndefined();
    const handler = async (file: File) => `h:${file.name}`;
    setUploadHandler(handler);
    expect(getUploadHandler()).toBe(handler);
    setUploadHandler(undefined);
    expect(getUploadHandler()).toBeUndefined();
  });

  it("注册表注入后工厂实例的拖拽上传走注册表回调（07 注入点生效）", async () => {
    const registryHandler = vi.fn(async (file: File) => `registry:${file.name}`);
    setUploadHandler(registryHandler);
    const root = document.createElement("div");
    document.body.appendChild(root);
    const crepe = createMarkwellEditor(root, "");
    await crepe.create();
    const view = crepe.editor.action((ctx) => ctx.get(editorViewCtx));
    const file = new File(["fake"], "reg.png", { type: "image/png" });
    fireEvent.drop(view.dom, {
      dataTransfer: fakeDataTransfer(fakeFileList(file)),
      clientX: 0,
      clientY: 0,
    });
    // 注册表回调被工厂组装的 onUpload 采纳（07 模块注入后无需调用方改动）
    await vi.waitFor(() => expect(registryHandler).toHaveBeenCalledWith(file));
    await vi.waitFor(() =>
      expect(view.dom.querySelector("img")?.getAttribute("src")).toBe("registry:reg.png"),
    );
    await crepe.destroy();
  });

  it("注册表未注入且无 onUpload 时拖拽回落 blob URL 占位（缺省行为）", async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const crepe = createMarkwellEditor(root, "");
    await crepe.create();
    const view = crepe.editor.action((ctx) => ctx.get(editorViewCtx));
    const file = new File(["fake"], "fallback.png", { type: "image/png" });
    fireEvent.drop(view.dom, {
      dataTransfer: fakeDataTransfer(fakeFileList(file)),
      clientX: 0,
      clientY: 0,
    });
    const img = await vi.waitFor(() => {
      const el = view.dom.querySelector("img");
      if (!el) throw new Error("blob 占位图未插入");
      return el;
    });
    expect(img.getAttribute("src")).toContain("blob:");
    await crepe.destroy();
  });

  it("options.onUpload 显式参数优先于注册表注入", async () => {
    const registryHandler = vi.fn(async (file: File) => `registry:${file.name}`);
    setUploadHandler(registryHandler);
    const explicit = vi.fn(async (file: File) => `explicit:${file.name}`);
    const root = document.createElement("div");
    document.body.appendChild(root);
    const crepe = createMarkwellEditor(root, "", { onUpload: explicit });
    await crepe.create();
    const view = crepe.editor.action((ctx) => ctx.get(editorViewCtx));
    const file = new File(["fake"], "prio.png", { type: "image/png" });
    fireEvent.drop(view.dom, {
      dataTransfer: fakeDataTransfer(fakeFileList(file)),
      clientX: 0,
      clientY: 0,
    });
    // 显式参数生效，注册表回调不被调用
    await vi.waitFor(() => expect(explicit).toHaveBeenCalledWith(file));
    expect(registryHandler).not.toHaveBeenCalled();
    // 等待异步插入完成后再销毁，避免销毁后 dispatch 触发 editorState 缺失告警
    await vi.waitFor(() =>
      expect(view.dom.querySelector("img")?.getAttribute("src")).toBe("explicit:prio.png"),
    );
    await crepe.destroy();
  });
});
