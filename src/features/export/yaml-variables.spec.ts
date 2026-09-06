// YAML 导出变量提取与 head 白名单替换测试（AC-X1-3/AC-X1-4 安全路径）
import { describe, expect, it } from "vitest";
import { escapeHtmlValue, extractYamlVariables, replaceHeadVariables } from "./yaml-variables";

describe("extractYamlVariables", () => {
  it("AC-X1-3 YAML title 提取为 title 变量", () => {
    const vars = extractYamlVariables("title: 我的产品手册\nauthor: 张三");
    expect(vars.title).toBe("我的产品手册");
    expect(vars.author).toBe("张三");
  });

  it("无 front matter 返回空 title（空串）", () => {
    expect(extractYamlVariables(null).title).toBe("");
  });

  it("白名单外键不提取（自定义键丢弃）", () => {
    const vars = extractYamlVariables("title: t\nattack: <script>alert(1)</script>");
    expect(Object.keys(vars)).not.toContain("attack");
  });
});

describe("replaceHeadVariables", () => {
  it("AC-X1-3 head 模板中 {{title}} 被替换", () => {
    const out = replaceHeadVariables("<title>{{title}}</title>", { title: "手册" });
    expect(out).toBe("<title>手册</title>");
  });

  it("AC-X1-4 变量值含 HTML 时被转义（防 XSS）", () => {
    const out = replaceHeadVariables("<title>{{title}}</title>", {
      title: '<script>alert("x")</script>',
    });
    expect(out).not.toContain("<script>");
    expect(out).toContain("&lt;script&gt;");
  });

  it("值内引号转义（CSS/属性上下文安全）", () => {
    expect(escapeHtmlValue("a\"b'c&d<e>f")).toBe("a&quot;b&#39;c&amp;d&lt;e&gt;f");
  });
});
