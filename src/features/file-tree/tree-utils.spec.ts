import { describe, expect, it } from "vitest";
import {
  buildTree,
  duplicateTargetName,
  isInvalidFileName,
  normalizePath,
  relativeLinkPath,
  SUPPORTED_TEXT_EXTENSIONS,
} from "./tree-utils";

describe("tree-utils", () => {
  it("SUPPORTED_TEXT_EXTENSIONS 含 14 种白名单", () => {
    expect(SUPPORTED_TEXT_EXTENSIONS).toEqual([
      "md",
      "markdown",
      "mdown",
      "mmd",
      "text",
      "txt",
      "rmarkdown",
      "mkd",
      "mdwn",
      "mdtxt",
      "rmd",
      "qmd",
      "mdtext",
      "mdx",
    ]);
  });

  it("buildTree 按 / 层级组装树（path 完整/relPath 相对）", () => {
    const tree = buildTree(
      [
        { path: "C:/d/a.md", name: "a.md", isDir: false, ext: "md" },
        { path: "C:/d/sub", name: "sub", isDir: true, ext: "" },
        { path: "C:/d/sub/b.md", name: "sub/b.md", isDir: false, ext: "md" },
      ],
      "C:/d",
    );
    expect(tree.map((n) => n.name)).toEqual(["a.md", "sub"]);
    expect(tree[1].path).toBe("C:/d/sub");
    expect(tree[1].relPath).toBe("sub");
    expect(tree[1].children.map((n) => n.name)).toEqual(["b.md"]);
    expect(tree[1].children[0].path).toBe("C:/d/sub/b.md");
    expect(tree[1].children[0].relPath).toBe("sub/b.md");
  });

  it("duplicateTargetName 基础命名与冲突追加 -1", () => {
    expect(duplicateTargetName("readme.md", [])).toBe("readme copy.md");
    expect(duplicateTargetName("readme.md", ["readme copy.md"])).toBe("readme copy-1.md");
    expect(duplicateTargetName("folder", ["folder copy"])).toBe("folder copy-1");
    expect(duplicateTargetName("readme.md", ["readme copy.md", "readme copy-1.md"])).toBe(
      "readme copy-2.md",
    );
  });

  it("isInvalidFileName 拒绝非法字符与空名", () => {
    expect(isInvalidFileName("a?b.md")).toBe(true);
    expect(isInvalidFileName("a*b.md")).toBe(true);
    expect(isInvalidFileName("a/b.md")).toBe(true);
    expect(isInvalidFileName("")).toBe(true);
    expect(isInvalidFileName("正常 文件.md")).toBe(false);
  });

  it("isInvalidFileName 拒绝 Windows 语义非法名（P3-9）", () => {
    // 相对路径项与尾点/尾空格（Windows 创建即失败或静默剥除）
    expect(isInvalidFileName(".")).toBe(true);
    expect(isInvalidFileName("..")).toBe(true);
    expect(isInvalidFileName("a.md.")).toBe(true);
    expect(isInvalidFileName("a.md ")).toBe(true);
    // 保留设备名（大小写不敏感、含扩展名形态）
    expect(isInvalidFileName("CON")).toBe(true);
    expect(isInvalidFileName("con.txt")).toBe(true);
    expect(isInvalidFileName("NUL.any")).toBe(true);
    expect(isInvalidFileName("LPT1")).toBe(true);
    expect(isInvalidFileName("com3.md")).toBe(true);
    // 正常名不受影响
    expect(isInvalidFileName("content.md")).toBe(false);
    expect(isInvalidFileName("conn.md")).toBe(false); // 前缀近似保留名不误伤
  });

  it("duplicateTargetName 冲突判断大小写不敏感（P3-9 Windows 语义）", () => {
    // 已存在 "A copy.md"（大小写不同）：不得生成被后端拒绝的 "a copy.md"
    expect(duplicateTargetName("a.md", ["A copy.md"])).toBe("a copy-1.md");
    expect(duplicateTargetName("a.md", ["A COPY.MD"])).toBe("a copy-1.md");
    expect(duplicateTargetName("a.md", ["a copy.md", "A copy-1.md"])).toBe("a copy-2.md");
  });

  it("relativeLinkPath 相对当前目录含扩展名", () => {
    expect(relativeLinkPath("C:/d/readme.md", "C:/d")).toBe("readme.md");
    expect(relativeLinkPath("C:/d/sub/x.md", "C:/d")).toBe("sub/x.md");
    expect(relativeLinkPath("C:/d/sub", "C:/d")).toBe("sub");
  });

  it("normalizePath 剥离 Windows verbatim 前缀并归一为正斜杠", () => {
    // verbatim 反斜杠形态（Rust canonicalize 产物，I-1 根因）
    expect(normalizePath("\\\\?\\C:\\d\\a.md")).toBe("C:/d/a.md");
    // verbatim 正斜杠形态
    expect(normalizePath("//?/C:/d/a.md")).toBe("C:/d/a.md");
    // 普通正斜杠形态不变
    expect(normalizePath("C:/d/a.md")).toBe("C:/d/a.md");
    // UNC verbatim（\\?\UNC\srv\share）：剥离后如实为 UNC/srv/share
    // （既有正则语义只剥 //?/ 前缀、不保留 UNC 双斜杠，如实记录现状）
    expect(normalizePath("\\\\?\\UNC\\srv\\share")).toBe("UNC/srv/share");
  });

  // 补充用例：基准目录之外回退完整路径、等于基准目录返回空串（覆盖 100% 阈值分支）
  it("relativeLinkPath 基准目录之外回退完整路径、相等返回空串", () => {
    expect(relativeLinkPath("D:/other/x.md", "C:/d")).toBe("D:/other/x.md");
    expect(relativeLinkPath("C:/d", "C:/d")).toBe("");
  });
});
