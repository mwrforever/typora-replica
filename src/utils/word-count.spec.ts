// 字数统计纯函数用例（11 状态栏 P1；口径权威 = docs/specs/research/11-状态栏-research.md §2.1/§4 + spec §2 S3）
//
// 核心域 100%（宪法 A.6.2）：计词规则（中文逐字/拉丁串/标点空白不计/假名按连续串）与
// 阅读时间口径（÷Reading Speed 向上取整、0 值隐藏）逐条钉住。
import { describe, expect, it } from "vitest";
import { countDocument, countSelection, countWords, estimateReadingMinutes } from "./word-count";
import type { CountableDoc, CountableNode } from "./word-count";

describe("countWords 计词规则", () => {
  it("中英混排按 CJK 逐字与拉丁连续串计词（AC-S3-1：Hello 世界 = 3 词）", () => {
    // Hello=1、世=1、界=1（调研 §4：CJK 逐字计 1 词，拉丁连续串按 1 词）
    expect(countWords("Hello 世界")).toBe(3);
  });

  it("纯中文逐字计词（一字一词）", () => {
    expect(countWords("中文一字一词")).toBe(6);
  });

  it("拉丁字母与数字连续串各计 1 词", () => {
    // count123 字母数字连续不切断；456 独立即 3 词
    expect(countWords("word count123 456")).toBe(3);
  });

  it("标点与空白不计入词数（中英文标点同权）", () => {
    // 你、好、世、界 + hello、world = 6；，！,. 均为标点不计（CJK 标点 Script=Common 不命中 Han 分支）
    expect(countWords("你好，世界！ hello, world.")).toBe(6);
  });

  it("假名按 Unicode 字母连续串计词，中文仍逐字（调研 §4 自定口径钉桩）", () => {
    // こんにちは 为连续假名串计 1 词；世、界各 1 词
    expect(countWords("こんにちは世界")).toBe(3);
  });

  it("空串返回 0 词（空文档不崩的词法基座，AC-S3-8）", () => {
    expect(countWords("")).toBe(0);
  });
});

describe("estimateReadingMinutes 阅读时间口径", () => {
  it("阅读时间按字数除以阅读速度向上取整（调研 §5-3 自定）", () => {
    expect(estimateReadingMinutes(400, 200)).toBe(2);
    expect(estimateReadingMinutes(401, 200)).toBe(3); // 2.005 → 3：整除余 1 字也多 1 分钟
  });

  it("字数为 0 时阅读时间为 0 分钟（空文档纯 ceil 公式，spec 字面口径）", () => {
    expect(estimateReadingMinutes(0, 200)).toBe(0);
  });

  it("阅读速度为 0 或负数返回 undefined（隐藏行，AC-S3-6）", () => {
    expect(estimateReadingMinutes(100, 0)).toBeUndefined();
    expect(estimateReadingMinutes(100, -5)).toBeUndefined();
  });
});

// —— 以下为 Task 2 追加：文档/选区遍历统计 ——

/** 文本节点构造（ProseMirror text 节点：isText=true 且携带 text） */
function textNode(t: string): CountableNode {
  return { isText: true, isBlock: false, type: { name: "text" }, text: t };
}

/** 非文本节点构造（块/行内叶子按 isBlock 与 type.name 区分） */
function node(name: string, isBlock: boolean): CountableNode {
  return { isText: false, isBlock, type: { name }, text: undefined };
}

interface DocEntry {
  /** 节点起点位置（模拟真实 ProseMirror 布局算术：块节点占位 = 内容宽 + 开闭标记 2） */
  pos: number;
  /** 节点占位宽度（text = text.length；叶子块/断行 = 1；容器块按上式） */
  size: number;
  node: CountableNode;
}

/**
 * 最小文档桩：descendants 全量回调；nodesBetween 以 [pos, pos+size) 与选区相交过滤——
 * 鸭子类型桩（OutlinePanel.spec fakeDoc 同思路），无需构造真实 ProseMirror 树
 */
function makeDoc(entries: DocEntry[]): CountableDoc {
  return {
    descendants(cb): void {
      for (const e of entries) cb(e.node, e.pos);
    },
    nodesBetween(from, to, cb): void {
      for (const e of entries) {
        if (e.pos + e.size > from && e.pos < to) cb(e.node, e.pos);
      }
    },
  };
}

describe("countDocument 全文统计", () => {
  it("混排文档统计词数字符数与逻辑行（含代码块文本与 hardbreak）", () => {
    const doc = makeDoc([
      { pos: 0, size: 10, node: node("paragraph", true) },
      { pos: 1, size: 8, node: textNode("Hello 世界") }, // 8 字符（含 1 空格）、3 词
      { pos: 10, size: 4, node: node("heading", true) },
      { pos: 11, size: 2, node: textNode("标题") }, // 2 字符、2 词
      { pos: 14, size: 1, node: node("hardbreak", false) }, // 断行 +1 行
      { pos: 15, size: 50, node: node("code_block", true) },
      { pos: 16, size: 48, node: textNode("one two three four five six seven eight nine ten") }, // 48 字符、10 词
    ]);
    expect(countDocument(doc)).toEqual({ words: 15, characters: 58, lines: 4 });
    // 字符 8 + 2 + 48 = 58；行 = paragraph + heading + hardbreak + code_block（自定口径见披露 2）
  });

  it("代码块文本计入字数且渲染级无标记符（AC-S3-5）", () => {
    const doc = makeDoc([
      { pos: 0, size: 50, node: node("code_block", true) },
      { pos: 1, size: 48, node: textNode("one two three four five six seven eight nine ten") },
    ]);
    const stats = countDocument(doc);
    expect(stats.words).toBe(10); // 代码文本 10 词全部计入（调研 §4：code_block 天然计入）
    // 字符数 = 48 = 纯代码文本长度：渲染级围栏 ``` 是语法非 text 节点，「标记符不计」自动成立
    expect(stats.characters).toBe(48);
  });

  it("空文档统计全零（AC-S3-8 基座）", () => {
    expect(countDocument(makeDoc([]))).toEqual({ words: 0, characters: 0, lines: 0 });
  });
});

describe("countSelection 选区统计", () => {
  /** 双段落夹具：两段各含 abcdef/ghijkl，块占位 = 文本长 + 2 */
  function twoParagraphDoc(): CountableDoc {
    return makeDoc([
      { pos: 0, size: 8, node: node("paragraph", true) },
      { pos: 1, size: 6, node: textNode("abcdef") },
      { pos: 8, size: 8, node: node("paragraph", true) },
      { pos: 9, size: 6, node: textNode("ghijkl") },
    ]);
  }

  it("跨块选区按区间切片统计不误计（AC-S3-4 基座）", () => {
    // 选区 [3,11)：首段文本 [3,7)="cdef"（4 字符）、尾段文本 [9,11)="gh"（2 字符）
    // 首尾部分选中的文本节点必须切片——整节点计入即 12 字符为误计
    expect(countSelection(twoParagraphDoc(), 3, 11)).toEqual({ words: 2, characters: 6, lines: 2 });
  });

  it("选区统计行口径为被选中命中的行内内容块计数（选区单位=行数的自定口径，披露 3）", () => {
    // 单段内 [2,4)：命中 1 个 paragraph 块 → 1 行；词 1、字符 2
    expect(countSelection(twoParagraphDoc(), 2, 4)).toEqual({ words: 1, characters: 2, lines: 1 });
  });

  it("空选区（from=to）返回全零", () => {
    expect(countSelection(twoParagraphDoc(), 3, 3)).toEqual({ words: 0, characters: 0, lines: 0 });
  });

  it("越界选区坐标按夹取收敛不崩溃", () => {
    // [0,100] 超出文档尾：切片端点 min/max 夹取到文本实际范围
    expect(countSelection(twoParagraphDoc(), 0, 100)).toEqual({
      words: 2,
      characters: 12,
      lines: 2,
    });
  });
});
