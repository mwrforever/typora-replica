// 图片 src 路径策略纯函数层（07 spec P3：相对/./ 前缀/escape 转义/绝对降级）
import { describe, expect, it } from "vitest";
import { buildImageSrc, escapeImageUrl, isSyntheticClipboardName } from "./image-src-policy";

describe("escapeImageUrl（JS escape() 等价语义）", () => {
  it("AC-P3-2 中文与空格按码元转义", () => {
    expect(escapeImageUrl("Name 名字.png")).toBe("Name%20%u540D%u5B57.png");
  });
  it("保留字符不转义（escape 白名单 @*_+-./）", () => {
    expect(escapeImageUrl("a-b_c.d~e!f#g")).toBe("a-b_c.d%7Ee%21f%23g");
  });
  it("代理对按 UTF-16 码元拆成两个 %uXXXX", () => {
    // 「😀」= U+1F600 = 码元 D83D DE00
    expect(escapeImageUrl("😀.png")).toBe("%uD83D%uDE00.png");
  });
  it("拉丁扩展字符走 %XX 形态", () => {
    expect(escapeImageUrl("café.png")).toBe("caf%E9.png");
  });
});

describe("buildImageSrc（P3 路径策略组合）", () => {
  const base = {
    absolutePath: "C:\\docs\\assets\\pic.png",
    documentSaved: true,
    relativePathEnabled: true,
    dotPrefixEnabled: false,
    urlEscapeEnabled: false,
  };
  it("AC-P3-1 已保存+开关开+可计算 → 相对路径", () => {
    expect(buildImageSrc({ ...base, relativeSrc: "assets/pic.png" })).toBe("assets/pic.png");
  });
  it("AC-P3-3 ./ 前缀开关开且同目录 → 带 ./", () => {
    expect(
      buildImageSrc({
        ...base,
        absolutePath: "C:\\docs\\pic.png",
        relativeSrc: "pic.png",
        dotPrefixEnabled: true,
      }),
    ).toBe("./pic.png");
  });
  it("./ 前缀开关关 → 不带 ./（默认态）", () => {
    expect(
      buildImageSrc({ ...base, absolutePath: "C:\\docs\\pic.png", relativeSrc: "pic.png" }),
    ).toBe("pic.png");
  });
  it("./ 前缀不作用于子目录相对路径", () => {
    expect(buildImageSrc({ ...base, relativeSrc: "assets/pic.png", dotPrefixEnabled: true })).toBe(
      "assets/pic.png",
    );
  });
  it("AC-P3-4 跨盘符（relativeSrc undefined）→ 降级绝对路径", () => {
    expect(buildImageSrc({ ...base, relativeSrc: undefined })).toBe("C:\\docs\\assets\\pic.png");
  });
  it("未保存文档 → 绝对路径（无视开关，AC-P2-4 同源规则）", () => {
    expect(buildImageSrc({ ...base, documentSaved: false, relativeSrc: "assets/pic.png" })).toBe(
      "C:\\docs\\assets\\pic.png",
    );
  });
  it("相对开关关 → 绝对路径", () => {
    expect(buildImageSrc({ ...base, relativePathEnabled: false, relativeSrc: "a.png" })).toBe(
      "C:\\docs\\assets\\pic.png",
    );
  });
  it("URL 转义作用于最终形态（含 ./ 前缀场景）", () => {
    expect(
      buildImageSrc({
        ...base,
        absolutePath: "C:\\docs\\Name 名字.png",
        relativeSrc: "Name 名字.png",
        dotPrefixEnabled: true,
        urlEscapeEnabled: true,
      }),
    ).toBe("./Name%20%u540D%u5B57.png");
  });
});

describe("isSyntheticClipboardName", () => {
  it("Chromium 合成名命中", () => {
    expect(isSyntheticClipboardName("image.png")).toBe(true);
    expect(isSyntheticClipboardName("IMAGE.JPG")).toBe(true);
  });
  it("真实文件名不命中", () => {
    expect(isSyntheticClipboardName("截图-20260813.png")).toBe(false);
    expect(isSyntheticClipboardName("photo.jpg")).toBe(false);
  });
});
