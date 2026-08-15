// SVG 另存服务（E21）：Blob + <a download> 触发浏览器保存（100% 覆盖）
import { afterEach, describe, expect, it, vi } from "vitest";
import { saveSvgAsFile } from "./diagram-save";

describe("saveSvgAsFile", () => {
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;

  afterEach(() => {
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  });

  it("以 image/svg+xml Blob 生成下载链接并触发点击", () => {
    // 拦截 createObjectURL/revokeObjectURL 与 a.click，观察保存行为
    const createObjectURL = vi.fn(() => "blob:mock/svg");
    const revokeObjectURL = vi.fn();
    URL.createObjectURL = createObjectURL as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
    const click = vi.fn();
    const anchorProto = HTMLAnchorElement.prototype;
    const originalClick = anchorProto.click;
    anchorProto.click = function (this: HTMLAnchorElement) {
      click(this.download);
    };

    saveSvgAsFile("<svg></svg>", "diagram");

    // Blob 构造与 MIME 类型正确
    expect(createObjectURL).toHaveBeenCalledWith(
      expect.objectContaining({ type: "image/svg+xml" }),
    );
    // 建议文件名拼上 .svg 扩展名
    expect(click).toHaveBeenCalledWith("diagram.svg");
    // 下载完成后释放对象 URL
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock/svg");

    anchorProto.click = originalClick;
  });
});
