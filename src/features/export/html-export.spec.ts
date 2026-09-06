// HTML/无样式导出编排测试（AC-X1-1~5 / AC-X3-1 / AC-X2-4 暗色 / 管线协作契约）
//
// 桩策略：只 mock 边界（IPC 服务/对话框/store/编辑器门面），域内协作模块
// （yaml-variables/outline-html/css-inline/html-postprocess/export-location/
// export-previous）与 KaTeX 全部真实执行——管线集成钉桩，任何协作模块回归即红。
// 桩 schema 的 fence toDOM 按真实序列化形态：data-language 挂在 pre 上
// （批2 R1 实证，preset-commonmark lib/index.js:811-816）。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MockInstance } from "vitest";
import { Schema } from "@milkdown/kit/prose/model";
import type { Node as ProseMirrorNode } from "@milkdown/kit/prose/model";
import type { EditorView } from "@milkdown/kit/prose/view";

const { readFileMock, writeFileMock, saveDialogMock, getViewMock, getFrontMatterMock } = vi.hoisted(
  () => ({
    readFileMock: vi.fn(),
    writeFileMock: vi.fn(),
    saveDialogMock: vi.fn(),
    getViewMock: vi.fn(),
    getFrontMatterMock: vi.fn(),
  }),
);

vi.mock("../../services/file-io", () => ({
  readFile: readFileMock,
  writeFile: writeFileMock,
}));
// KaTeX CSS ?raw 在 vitest 下 stub 为空串（css-inline.spec 同款桩）：
// 固定「KaTeX 层参与 style 合并」断言依据
vi.mock("katex/dist/katex.min.css?raw", () => ({
  default: ".katex-display { display: block; }",
}));
vi.mock("./export-dialog", () => ({
  exportSaveDialog: saveDialogMock,
}));
// theme-io 桩：base.user.css 存在性可变（该分支两侧用例依赖）
const themeIoState = vi.hoisted(() => ({ hasBaseUserCss: true }));
vi.mock("../../services/theme-io", () => ({
  listThemes: vi.fn(async () => ({
    dir: "D:/themes",
    themes: [
      { name: "markwell-light", fileName: "markwell-light.css", label: "Light", hasUserCss: true },
    ],
    hasBaseUserCss: themeIoState.hasBaseUserCss,
  })),
}));
vi.mock("../editor/editor-manager", () => ({
  editorManager: { getView: getViewMock },
}));
vi.mock("../tabs/editor-registry", () => ({
  getActiveFrontMatter: getFrontMatterMock,
}));
vi.mock("../outline/outline-store", () => ({
  useOutlineStore: () => ({ collapsible: false }),
}));
// theme-store 桩：激活主题与系统明暗经外部可变变量控制（降级/暗色解析分支用例依赖）
const themeState = vi.hoisted(() => ({
  activeTheme: {
    name: "markwell-light",
    fileName: "markwell-light.css",
    hasUserCss: true,
  } as { name: string; fileName: string; hasUserCss: boolean } | undefined,
  systemDark: false,
  lastResolvedMode: undefined as string | undefined,
}));
vi.mock("../theme/theme-store", () => ({
  useThemeStore: () => ({
    get systemDark() {
      return themeState.systemDark;
    },
    resolveActiveTheme: (mode: "light" | "dark") => {
      themeState.lastResolvedMode = mode;
      return themeState.activeTheme;
    },
  }),
}));
// export-previous 未 mock，其依赖 tabs-store 一并桩掉；activeTab 可变（文档目录分支用例）
const tabsState = vi.hoisted(() => ({ activeTab: undefined as { path?: string } | undefined }));
vi.mock("../tabs/tabs-store", () => ({
  useTabsStore: () => ({ activeTab: tabsState.activeTab, activeTabId: undefined }),
}));

import { buildExportDocumentForPdf, exportHtml, exportPlainHtml } from "./html-export";

/** 最小桩 schema（doc/paragraph/heading/fence/text；形态对齐真实序列化） */
const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "inline*", toDOM: () => ["p", 0] },
    heading: {
      group: "block",
      content: "inline*",
      attrs: { level: { default: 1 }, id: { default: "" } },
      toDOM: (node) => [`h${String(node.attrs.level)}`, { id: String(node.attrs.id) }, 0],
    },
    fence: {
      group: "block",
      content: "text*",
      attrs: { language: { default: "" } },
      // 真实形态：data-language 在 pre 上（非 code 上）
      toDOM: (node) => ["pre", { "data-language": String(node.attrs.language) }, ["code", 0]],
    },
    text: { group: "inline" },
  },
});

/** 构造桩文档：h1（id=手册）+ 段落（含 ${title} 字面量）+ LaTeX 围栏 */
function stubDoc(): ProseMirrorNode {
  return schema.node("doc", null, [
    schema.nodes.heading.create({ level: 1, id: "手册" }, schema.text("手册")),
    schema.nodes.paragraph.create(null, schema.text("正文 ${title} 字面量")),
    schema.nodes.fence.create({ language: "LaTeX" }, schema.text("E=mc^2")),
  ]);
}

/** 桩编辑器视图（html-export 只消费 state.doc / state.schema） */
function stubView(): EditorView {
  return { state: { doc: stubDoc(), schema } } as unknown as EditorView;
}

let classListContainsSpy: MockInstance;

beforeEach(() => {
  getViewMock.mockReturnValue(stubView());
  getFrontMatterMock.mockReturnValue("title: 我的产品手册");
  themeState.activeTheme = {
    name: "markwell-light",
    fileName: "markwell-light.css",
    hasUserCss: true,
  };
  themeState.systemDark = false;
  themeState.lastResolvedMode = undefined;
  themeIoState.hasBaseUserCss = true;
  tabsState.activeTab = undefined;
  // readFile 桩：路径含 "user" 即用户层（base.user.css / {theme}.user.css 皆命中）；
  // mockReset 清上一用例调用历史与实现，防跨用例累积污染断言
  readFileMock.mockReset();
  readFileMock.mockImplementation(async (path: string) => ({
    content: `.theme-from-${path.includes("user") ? "user" : "main"} { color: teal }`,
    encoding: "utf8",
    lineEnding: "lf",
  }));
  writeFileMock.mockClear();
  saveDialogMock.mockReset();
  saveDialogMock.mockResolvedValue("D:/out/手册.html");
  // 暗色判定源桩（AC-X2-4 与 theme-store.ts:71 同源：documentElement 根类）
  classListContainsSpy = vi
    .spyOn(document.documentElement.classList, "contains")
    .mockReturnValue(false);
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** 取落盘 HTML（writeFile 第 2 参；断言辅助） */
function writtenHtml(): string {
  expect(writeFileMock).toHaveBeenCalled();
  return String(writeFileMock.mock.calls[0]?.[1]);
}

describe("exportHtml（HTML 导出编排）", () => {
  it("AC-X1-1：直接落盘路径导出——单文件含 style/主题/KaTeX/DOCTYPE", async () => {
    const result = await exportHtml({ destinationPath: "D:/out/x.html" });
    expect(result).toEqual({ path: "D:/out/x.html", format: "html" });
    expect(writeFileMock.mock.calls[0]?.[0]).toBe("D:/out/x.html");
    const html = writtenHtml();
    expect(html).toContain("<style>");
    expect(html).toContain(".theme-from-main");
    expect(html).toContain(".katex");
    expect(html).toContain("<!DOCTYPE html>");
  });

  it("用户层 CSS 注入：base.user.css 与主题同名 user.css 均被读取合并", async () => {
    await exportHtml({ destinationPath: "D:/out/x.html" });
    const readPaths = readFileMock.mock.calls.map((call) => String(call[0]));
    const paths = readPaths.join("\n");
    expect(paths).toContain("base.user.css");
    expect(paths).toContain("markwell-light.user.css");
    expect(writtenHtml()).toContain(".theme-from-user");
  });

  it("AC-X1-3：YAML title 变量替换进 <title>", async () => {
    await exportHtml({ destinationPath: "D:/out/x.html" });
    expect(writtenHtml()).toContain("<title>我的产品手册</title>");
  });

  it("无 front matter 时 title 回落 fileNameBase", async () => {
    getFrontMatterMock.mockReturnValueOnce(null);
    await exportHtml({ destinationPath: "D:/out/x.html", fileNameBase: "笔记" });
    expect(writtenHtml()).toContain("<title>笔记</title>");
  });

  it("AC-X1-4：正文中的 ${title} 字面量不被替换（变量只作用于 head）", async () => {
    await exportHtml({ destinationPath: "D:/out/x.html" });
    expect(writtenHtml()).toContain("正文 ${title} 字面量");
  });

  it("AC-X1-5：LaTeX 围栏经 KaTeX 真渲染并带 mw-math-block 包装", async () => {
    await exportHtml({ destinationPath: "D:/out/x.html" });
    const html = writtenHtml();
    expect(html).toContain('class="mw-math-block"');
    expect(html).toContain("katex");
  });

  it("AC-X1-2：includeOutline 时 body 前置大纲导航（锚点指向标题 id）", async () => {
    await exportHtml({ destinationPath: "D:/out/x.html", includeOutline: true });
    const html = writtenHtml();
    expect(html).toContain('class="mw-export-outline"');
    expect(html).toContain('href="#手册"');
  });

  it("AC-X2-4：暗色模式——html 根类与暗色 CSS 段注入，且按 dark 模式解析主题", async () => {
    classListContainsSpy.mockReturnValue(true);
    themeState.systemDark = true;
    await exportHtml({ destinationPath: "D:/out/x.html" });
    const html = writtenHtml();
    expect(html).toContain('<html lang="zh-CN" class="markwell-dark">');
    expect(html).toContain("html.markwell-dark");
    expect(themeState.lastResolvedMode).toBe("dark"); // 激活主题跟随系统暗色
  });

  it("亮色模式——根元素无暗色类且无暗色 CSS 段", async () => {
    await exportHtml({ destinationPath: "D:/out/x.html" });
    const html = writtenHtml();
    expect(html).toContain('<html lang="zh-CN">');
    expect(html).not.toContain('class="markwell-dark"');
  });

  it("编辑器未就绪抛 ExportError（中文错误面向用户）", async () => {
    getViewMock.mockReturnValueOnce(undefined);
    await expect(exportHtml({ destinationPath: "D:/out/x.html" })).rejects.toThrow("编辑器未就绪");
  });

  it("另存对话框取消 → 返回 undefined 且不落盘", async () => {
    saveDialogMock.mockResolvedValueOnce(null);
    const result = await exportHtml();
    expect(result).toBeUndefined();
    expect(writeFileMock).not.toHaveBeenCalled();
  });

  it("主题 CSS 读取失败降级为无主题样式（导出不阻断）", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    readFileMock.mockRejectedValueOnce(new Error("io fail"));
    const result = await exportHtml({ destinationPath: "D:/out/x.html" });
    expect(result).toEqual({ path: "D:/out/x.html", format: "html" });
    expect(errSpy).toHaveBeenCalled(); // 降级留痕（日志规范：error 通道）
    expect(writtenHtml()).not.toContain(".theme-from-main"); // 主题层缺席
    expect(writtenHtml()).toContain("<style>"); // 导出专用+KaTeX 段兜底
  });

  it("themeOverride 覆盖当前激活主题（按覆盖主题文件读取）", async () => {
    await exportHtml({
      destinationPath: "D:/out/x.html",
      themeOverride: { name: "solar", fileName: "solar.css", hasUserCss: false },
    });
    const paths = readFileMock.mock.calls.map((call) => String(call[0])).join("\n");
    expect(paths).toContain("solar.css");
    expect(paths).not.toContain("markwell-light.user.css"); // 覆盖主题无同名用户层
  });

  it("无激活主题时降级无主题层（导出基础样式兜底）", async () => {
    themeState.activeTheme = undefined;
    await exportHtml({ destinationPath: "D:/out/x.html" });
    expect(readFileMock).not.toHaveBeenCalled();
    expect(writtenHtml()).toContain("<style>");
  });

  it("走对话框路径且标题全空白时默认文件名回落 Untitled", async () => {
    getFrontMatterMock.mockReturnValueOnce(null);
    await exportHtml({ fileNameBase: "  " });
    expect(saveDialogMock).toHaveBeenCalledWith(
      expect.objectContaining({ defaultPath: "Untitled.html" }),
    );
  });

  it("文档路径无父目录段时对话框默认路径仅为文件名", async () => {
    tabsState.activeTab = { path: "manual.md" };
    await exportHtml();
    expect(saveDialogMock).toHaveBeenCalledWith(
      expect.objectContaining({ defaultPath: "我的产品手册.html" }),
    );
  });

  it("auto 语义：有文档路径时对话框默认落在文档同目录", async () => {
    tabsState.activeTab = { path: "D:/docs/手册.md" };
    await exportHtml();
    expect(saveDialogMock).toHaveBeenCalledWith(
      expect.objectContaining({ defaultPath: "D:/docs/我的产品手册.html" }),
    );
  });

  it("base.user.css 缺失时不读全局用户层（主题同名层照常）", async () => {
    themeIoState.hasBaseUserCss = false;
    await exportHtml({ destinationPath: "D:/out/x.html" });
    const paths = readFileMock.mock.calls.map((call) => String(call[0])).join("\n");
    expect(paths).not.toContain("base.user.css");
    expect(paths).toContain("markwell-light.user.css");
  });

  it("无 front matter 且无 fileNameBase 时文件名回落 Untitled", async () => {
    getFrontMatterMock.mockReturnValueOnce(null);
    await exportHtml();
    expect(saveDialogMock).toHaveBeenCalledWith(
      expect.objectContaining({ defaultPath: "Untitled.html" }),
    );
  });
});

describe("exportPlainHtml（无样式导出）", () => {
  it("AC-X3-1：无 style、无 mw-* 包裹类、语义标题与锚点 id 保留", async () => {
    const result = await exportPlainHtml({ destinationPath: "D:/out/plain.html" });
    expect(result).toEqual({ path: "D:/out/plain.html", format: "html-plain" });
    const html = writtenHtml();
    expect(html).not.toContain("<style");
    expect(html).not.toContain('class="mw-');
    expect(html).toContain("<h1");
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain('id="手册"');
  });

  it("plain 模式下 LaTeX 仍渲染（语义 HTML 保留数学产物）", async () => {
    await exportPlainHtml({ destinationPath: "D:/out/plain.html" });
    expect(writtenHtml()).toContain("katex");
  });

  it("plain 导出另存取消 → undefined 且不落盘（与 html 同一静默语义）", async () => {
    saveDialogMock.mockResolvedValueOnce(null);
    const result = await exportPlainHtml();
    expect(result).toBeUndefined();
    expect(writeFileMock).not.toHaveBeenCalled();
  });
});

describe("buildExportDocumentForPdf（PDF 源文档构建）", () => {
  it("返回解析标题且 document 注入 @page 页眉与 h1 分页样式", async () => {
    const { document: doc, title } = await buildExportDocumentForPdf({
      header: "${title}",
      footer: "${pageNo}",
      breakH1: true,
    });
    expect(title).toBe("我的产品手册");
    expect(doc).toContain("@top-center");
    expect(doc).toContain("break-before: page");
  });

  it("breakH1 缺省视为关（不注入分页样式）", async () => {
    const { document: doc } = await buildExportDocumentForPdf({ header: "", footer: "" });
    expect(doc).not.toContain("break-before: page");
  });
});
