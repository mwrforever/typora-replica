// E20 HTML/媒体编辑器行为：span 渲染 / 剥离与导出保留 / script 禁用 / iframe sandbox / 视频
import { describe, expect, it, vi } from "vitest";
import { makeTestEditor } from "../../test/editor-test-utils";

describe("E20 HTML/媒体", () => {
  it("AC-E20-1 输入 <span>文字</span> 渲染为带样式 span", async () => {
    const te = await makeTestEditor('<span style="color: red">文字</span>');
    const span = te.view.dom.querySelector("span[style]");
    expect(span).not.toBeNull();
    expect(span?.textContent).toBe("文字");
  });

  it("AC-E20-2 编辑视图剥离 class/data-*，导出时保留", async () => {
    const te = await makeTestEditor('<span class="x" data-y="1">文字</span>');
    // 编辑视图：断言内容 span（NodeView 外层容器的内层，`span > span` 定位），
    // class/data-* 被剥离；外层容器自带的 data-type="html" 是编辑器注入的节点
    // 标记（非用户内容），不在剥离范围
    const content = te.view.dom.querySelector("span > span");
    expect(content?.hasAttribute("class")).toBe(false);
    expect(content?.hasAttribute("data-y")).toBe(false);
    expect(content?.textContent).toBe("文字");
    // 导出：原文保留
    expect(te.getMarkdown()).toContain('class="x"');
    expect(te.getMarkdown()).toContain('data-y="1"');
  });

  it("AC-E20-3 script 被禁用不执行", async () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    const te = await makeTestEditor("<script>alert(1)</script><p>正文</p>");
    expect(alertSpy).not.toHaveBeenCalled();
    expect(te.view.dom.querySelector("script")).toBeNull();
    alertSpy.mockRestore();
  });

  it("AC-E20-4 iframe 以 sandbox 属性包裹渲染", async () => {
    const te = await makeTestEditor('<iframe src="https://example.com"></iframe>');
    const iframe = te.view.dom.querySelector("iframe");
    expect(iframe).not.toBeNull();
    expect(iframe?.hasAttribute("sandbox")).toBe(true);
  });

  it("AC-E20-5 <video> 渲染且路径规则与图片一致", async () => {
    const te = await makeTestEditor('<video src="x.mp4" />');
    const video = te.view.dom.querySelector("video");
    expect(video).not.toBeNull();
    expect(video?.getAttribute("src")).toBe("x.mp4");
  });

  it("开闭标签间含 markdown 标记时不合并（保留强调语义）", async () => {
    const te = await makeTestEditor("<b>加粗**重点**</b>");
    // 强调保留为 strong 节点渲染（不在 b 标签内）
    const strong = te.view.dom.querySelector("strong");
    expect(strong).not.toBeNull();
    expect(strong?.textContent).toBe("重点");
    // 导出保留 markdown 语义（** 未被吞进 html 节点）
    expect(te.getMarkdown()).toContain("**重点**");
  });

  it("空元素/不配对/嵌套开标签不合并（保守边界，导出原样往返）", async () => {
    const te = await makeTestEditor("<b>文字</i><span></span><b><i></b>");
    // 无任何合并：导出与输入逐字一致
    expect(te.getMarkdown()).toBe("<b>文字</i><span></span><b><i></b>");
    // 未合并的 `<b>` 仍以空标签形态渲染（文字在标签外）
    expect(te.view.dom.querySelector("b")).not.toBeNull();
  });
});
