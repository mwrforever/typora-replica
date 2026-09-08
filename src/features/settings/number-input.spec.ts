// normalizeNumberInput 直测（批1 审查 M2 收口基座）：覆盖合法数值 / 清空 / 非法文本
// 三类输入路径——该文件位于 settings 核心 100% 覆盖 glob 内（宪法 A.6.2）
import { describe, expect, it } from "vitest";
import { normalizeNumberInput } from "./number-input";

describe("normalizeNumberInput（v-model.number 输入归一）", () => {
  it("合法数值与数值文本原样收口为有限数", () => {
    expect(normalizeNumberInput(15, 5)).toBe(15);
    expect(normalizeNumberInput("15", 5)).toBe(15);
    expect(normalizeNumberInput("0.4", 1)).toBe(0.4);
  });

  it("清空输入（空串/纯空白）回退默认值而非 0（Number('') === 0 陷阱）", () => {
    expect(normalizeNumberInput("", 200)).toBe(200);
    expect(normalizeNumberInput("   ", 4)).toBe(4);
  });

  it("非数值文本（NaN 路径）回退默认值", () => {
    expect(normalizeNumberInput("abc", 0.4)).toBe(0.4);
  });
});
