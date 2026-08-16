// 行尾转换器测试（02 文档管理收口）
//
// 覆盖三类场景：全文级行尾归一（含单行 CRLF FM 定界符盲区）、
// 尾换行补回口径、落盘组合幂等（01 终审裁决的硬换行往返回归）。
import { describe, expect, it } from "vitest";
import { normalizeLineEnding, ensureTrailingNewline, toDiskContent } from "./line-ending";

describe("行尾转换器（02 收口）", () => {
  it("LF 目标归一 CRLF 残留", () => {
    expect(normalizeLineEnding("a\r\nb\nc", "lf")).toBe("a\nb\nc");
  });

  it("CRLF 目标全量转换（含 FM 定界符区——覆盖单行 CRLF FM 盲区）", () => {
    // 单行 FM：reinsertFrontMatter 的 eol 检测对单行内文恒 false（退化 LF 定界符），
    // 全文级行尾转换在落盘前把定界符一并归 CRLF，消除盲区
    const doc = "---\ntitle: a\n---\n正文";
    expect(normalizeLineEnding(doc, "crlf")).toBe("---\r\ntitle: a\r\n---\r\n正文");
  });

  it("末尾无换行保持无换行（转换不凭空补）", () => {
    expect(normalizeLineEnding("a\nb", "crlf")).toBe("a\r\nb");
  });

  it("ensureTrailingNewline 非空无尾换行补单个", () => {
    expect(ensureTrailingNewline("内容")).toBe("内容\n");
    expect(ensureTrailingNewline("内容\n")).toBe("内容\n");
    expect(ensureTrailingNewline("")).toBe("");
  });

  it("toDiskContent 组合：补尾换行 + 目标行尾", () => {
    expect(toDiskContent("正文", "crlf")).toBe("正文\r\n");
    expect(toDiskContent("正文\n", "lf")).toBe("正文\n");
  });

  it("硬换行结尾文档往返保持结构（01 终审裁决的回归用例）", () => {
    // 编辑器序列化剥全部尾随换行后为 "text  "（两空格硬换行标记）；
    // 落盘补回单个 \n 还原 `text  \n`，重解析硬换行结构不破坏
    const disk = toDiskContent("text  ", "lf");
    expect(disk).toBe("text  \n");
    // 往返：落盘内容 → 编辑器正文（parseFrontMatter 后）→ 序列化 → 再落盘，幂等
    expect(toDiskContent(disk.replace(/\n+$/, ""), "lf")).toBe(disk);
  });
});
