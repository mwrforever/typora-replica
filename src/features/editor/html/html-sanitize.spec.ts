// HTML 安全清洗纯函数（核心安全路径，100% 覆盖）
import { describe, expect, it } from "vitest";
import { sanitizeHtml, stripHtmlAttrsAtRender } from "./html-sanitize";

describe("HTML 安全清洗", () => {
  it("script 标签被移除", () => {
    expect(sanitizeHtml("<script>alert(1)</script><p>ok</p>")).toBe("<p>ok</p>");
  });

  it("onload/onerror 事件属性被移除", () => {
    expect(sanitizeHtml('<img src="x" onerror="alert(1)">')).not.toContain("onerror");
  });

  it("iframe 被 sandbox 属性包裹", () => {
    const out = sanitizeHtml('<iframe src="https://example.com"></iframe>');
    expect(out).toContain("sandbox");
  });

  it("已带 token 的 iframe 归一化为空 sandbox（不保留 allow-scripts/allow-same-origin）", () => {
    // 安全审查修复：allow-scripts + allow-same-origin 组合构成沙箱逃逸
    //（与父文档同源且可执行脚本，可读改编辑器 DOM），无论输入一律归一化为空沙箱
    const out = sanitizeHtml(
      '<iframe src="https://attacker.example/e" sandbox="allow-scripts allow-same-origin"></iframe>',
    );
    expect(out).toContain("sandbox");
    expect(out).not.toContain("allow-scripts");
    expect(out).not.toContain("allow-same-origin");
    // 只出现一次 sandbox 且为空值（归一化覆盖原有 token）
    expect(out.match(/sandbox/g)).toHaveLength(1);
    expect(out).toContain('sandbox=""');
  });

  it("class/id/data-* 在渲染剥离中移除", () => {
    const out = stripHtmlAttrsAtRender('<span class="x" id="y" data-z="1" title="t">文字</span>');
    expect(out).not.toContain("class=");
    expect(out).not.toContain("id=");
    expect(out).not.toContain("data-z");
    // 非装饰性属性（title）保留，文字内容不变
    expect(out).toContain('title="t"');
    expect(out).toContain("文字");
  });

  it("无元素输入（纯文本）剥离后原样返回", () => {
    expect(stripHtmlAttrsAtRender("纯文本内容")).toBe("纯文本内容");
  });

  it("无害标签与普通属性保留", () => {
    expect(sanitizeHtml('<span style="color: red">文字</span>')).toContain("style");
  });

  it("javascript: 协议 href 被移除", () => {
    expect(sanitizeHtml('<a href="javascript:alert(1)">链接</a>')).not.toContain("javascript:");
  });
});
