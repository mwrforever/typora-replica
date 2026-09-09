// 字数统计纯函数用例（11 状态栏 P1；口径权威 = docs/specs/research/11-状态栏-research.md §2.1/§4 + spec §2 S3）
//
// 核心域 100%（宪法 A.6.2）：计词规则（中文逐字/拉丁串/标点空白不计/假名按连续串）与
// 阅读时间口径（÷Reading Speed 向上取整、0 值隐藏）逐条钉住。
import { describe, expect, it } from "vitest";
import { countWords, estimateReadingMinutes } from "./word-count";

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
