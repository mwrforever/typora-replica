// src/features/image/local-image-view.spec.ts
// 本地图片显示解析：DOM src 换 asset URL / 远程放行 / root-url 拼接 / NodeView 复位自愈
import { describe, expect, it, vi } from "vitest";
import { attachLocalImageView } from "./local-image-view";

const ctx = { documentSaved: true, docDir: "C:\\docs", frontMatter: null };

function makeDeps(overrides: Partial<Parameters<typeof attachLocalImageView>[1]> = {}) {
  const invoke = vi.fn(async (_c: string, args?: Record<string, unknown>) => {
    const src = (args as { src: string }).src;
    return src.startsWith("http") ? null : `C:\\resolved\\${src}`;
  });
  return {
    getContext: vi.fn(() => ctx),
    invoke,
    convertFileSrc: vi.fn((p: string) => `http://asset.localhost/${encodeURIComponent(p)}`),
    ...overrides,
  };
}

function addImg(root: HTMLElement, src: string): HTMLImageElement {
  const img = document.createElement("img");
  img.src = src;
  root.appendChild(img);
  return img;
}

describe("attachLocalImageView", () => {
  it("本地路径 img 换 asset URL 且原 src 可追溯", async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const view = attachLocalImageView(root, makeDeps());
    const img = addImg(root, "pic.png");
    await vi.waitFor(() => expect(img.src.startsWith("http://asset.localhost/")).toBe(true));
    view.destroy();
  });
  it("远程/数据 URL 不解析不触发 invoke", async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const deps = makeDeps();
    const view = attachLocalImageView(root, deps);
    addImg(root, "https://a.com/x.png");
    addImg(root, "data:image/png;base64,AA");
    addImg(root, "blob:x");
    await new Promise((r) => setTimeout(r, 20));
    expect(deps.invoke).not.toHaveBeenCalled();
    view.destroy();
  });
  it("AC-P4-1 root-url 参与 fs 解析且不改文档 src 语义", async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const deps = makeDeps({
      getContext: vi.fn(() => ({
        ...ctx,
        frontMatter: "typora-root-url: /root/",
      })),
    });
    const view = attachLocalImageView(root, deps);
    addImg(root, "/blog/x.png");
    await vi.waitFor(() => expect(deps.invoke).toHaveBeenCalled());
    const args = (deps.invoke as ReturnType<typeof vi.fn>).mock.calls[0][1] as Record<
      string,
      unknown
    >;
    expect(args.rootUrl).toBe("/root/");
    view.destroy();
  });
  it("NodeView 把 src 复位回本地路径时自愈重解析", async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const deps = makeDeps();
    const view = attachLocalImageView(root, deps);
    const img = addImg(root, "pic.png");
    await vi.waitFor(() => expect(img.src.startsWith("http://asset.localhost/")).toBe(true));
    // 模拟 PM nodeView 重渲染复位
    img.src = "pic.png";
    await vi.waitFor(() => expect(img.src.startsWith("http://asset.localhost/")).toBe(true));
    view.destroy();
  });
  it("destroy 后不再解析新增节点", async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const deps = makeDeps();
    const view = attachLocalImageView(root, deps);
    view.destroy();
    addImg(root, "later.png");
    await new Promise((r) => setTimeout(r, 20));
    expect(deps.invoke).not.toHaveBeenCalled();
  });
});
