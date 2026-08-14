// YAML Front Matter 纯函数测试（E11）
//
// 覆盖：文首识别（AC-E11-1）、原样回写（AC-E11-2）、中部不识别（AC-E11-3）、
// 非法 YAML 保留告警（AC-E11-4）、Typora 专有属性读取，以及行级校验各分支（100% 覆盖）。
import { describe, expect, it, vi } from "vitest";
import {
  isValidFrontMatter,
  parseFrontMatter,
  readFrontMatterKey,
  reinsertFrontMatter,
} from "./frontmatter";

describe("Front Matter 纯函数", () => {
  it("AC-E11-1 文首 --- 块被解析为元数据，正文不含 front matter", () => {
    const md = "---\ntitle: 测试\nauthor: mwr\n---\n# 正文";
    const { frontMatter, body } = parseFrontMatter(md);
    expect(frontMatter).toBe("title: 测试\nauthor: mwr");
    expect(body).toBe("# 正文");
  });

  it("AC-E11-2 回写后 front matter 原样保留", () => {
    const md = "---\ntitle: 测试\n---\n# 正文";
    const { frontMatter, body } = parseFrontMatter(md);
    expect(reinsertFrontMatter(frontMatter!, body)).toBe(md);
  });

  it("AC-E11-3 文档中部 --- 块不识别为 front matter", () => {
    const md = "# 标题\n\n---\n中部横线\n---";
    const { frontMatter, body } = parseFrontMatter(md);
    expect(frontMatter).toBeNull();
    expect(body).toBe(md);
  });

  it("AC-E11-4 非法 YAML 的 front matter 不崩溃、按原文保留并告警", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const md = "---\ninvalid: [unclosed\n---\n# 正文";
    const { frontMatter, body } = parseFrontMatter(md);
    // 非法块不剥离（按原文保留），并输出告警
    expect(frontMatter).toBeNull();
    expect(body).toBe(md);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("readFrontMatterKey 读取 Typora 专有属性", () => {
    const fm = "title: 测试\ntypora-root-url: ./assets\n";
    expect(readFrontMatterKey(fm, "typora-root-url")).toBe("./assets");
    expect(readFrontMatterKey(fm, "typora-copy-images-to")).toBeUndefined();
  });

  it("isValidFrontMatter 接受注释行与常规键值", () => {
    expect(isValidFrontMatter("title: x\n# 注释行\ntags: [a, b]")).toBe(true);
    expect(isValidFrontMatter("invalid: [unclosed")).toBe(false);
  });

  it("isValidFrontMatter 空行与注释行均合法", () => {
    expect(isValidFrontMatter("title: x\n\n# 注释行\ntags: [a, b]")).toBe(true);
  });

  it("isValidFrontMatter 非键值行非法", () => {
    expect(isValidFrontMatter("bare line")).toBe(false);
  });

  it("isValidFrontMatter 括号/引号成对合法，未闭合或错配非法", () => {
    expect(isValidFrontMatter('title: "带引号标题"')).toBe(true);
    expect(isValidFrontMatter("note: '单引号串'")).toBe(true);
    expect(isValidFrontMatter("meta: {x: 1}")).toBe(true);
    expect(isValidFrontMatter('title: "未闭合')).toBe(false);
    expect(isValidFrontMatter("tags: [a}")).toBe(false);
    expect(isValidFrontMatter("meta: ]")).toBe(false);
    expect(isValidFrontMatter("note: 'x")).toBe(false);
  });

  it("readFrontMatterKey 跳过注释行命中目标键", () => {
    const fm = "title: x\n# 注释行\ntypora-copy-images-to: ./img\n";
    expect(readFrontMatterKey(fm, "typora-copy-images-to")).toBe("./img");
  });
});
