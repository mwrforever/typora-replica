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

  it("以 image/svg+xml Blob 生成下载链接并触发点击，下载开始后再释放对象 URL", async () => {
    // 拦截 createObjectURL/revokeObjectURL 与 a.click，观察保存行为
    const createObjectURL = vi.fn(() => "blob:mock/svg");
    const revokeObjectURL = vi.fn();
    URL.createObjectURL = createObjectURL as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
    let clickState: { download: string; connected: boolean } | undefined;
    const click = vi.fn();
    const anchorProto = HTMLAnchorElement.prototype;
    const originalClick = anchorProto.click;
    anchorProto.click = function (this: HTMLAnchorElement) {
      // 记录点击瞬间 anchor 的挂载状态（FIX-12：click 前须已挂载 document，
      // 部分引擎要求 anchor 处于文档内才接受 download 语义）
      clickState = { download: this.download, connected: this.isConnected };
      click(this.download);
    };

    saveSvgAsFile("<svg></svg>", "diagram");

    // Blob 构造与 MIME 类型正确
    expect(createObjectURL).toHaveBeenCalledWith(
      expect.objectContaining({ type: "image/svg+xml" }),
    );
    // 建议文件名拼上 .svg 扩展名，且触发点击时 anchor 已挂载 document
    expect(click).toHaveBeenCalledWith("diagram.svg");
    expect(clickState?.connected).toBe(true);
    // 延迟一拍撤销 blob URL：click 后下载由引擎异步读取，同步 revoke 在部分引擎下
    // 可能使下载拿到空文件/失败（FIX-12）
    expect(revokeObjectURL).not.toHaveBeenCalled();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock/svg");

    anchorProto.click = originalClick;
  });
});
