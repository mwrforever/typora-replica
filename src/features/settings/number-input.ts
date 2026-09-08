// v-model.number 输入归一（批1 审查 M2 收口）
//
// Vue 的 .number 修饰符对清空/非法输入原样返回字符串（looseToNumber 语义），空串会
// 穿透 computed<number> 的类型标注直写持久层 / IPC，违反 number 契约。本模块把
// 「字符串 → 有限数或回退默认」的判定收敛为单一函数，供各分区组件的数字绑定复用。

/**
 * 归一 v-model.number 产出的原始值
 * @param value 输入事件原始值（.number 修饰符产出：有限数，或解析失败的原始字符串）
 * @param fallback 非法输入（空串 / 非数值文本）时的回退默认值（各字段默认表口径）
 * @returns 有限数值；非法输入返回 fallback
 */
export function normalizeNumberInput(value: number | string, fallback: number): number {
  // 空串 / 纯空白须先于数值转换判定：Number("") === 0，直接转换会把「清空」误收口为 0
  if (typeof value === "string" && value.trim() === "") return fallback;
  const parsed = typeof value === "number" ? value : Number(value);
  // NaN（如 "abc"）等非有限值一律回退默认，不落持久层
  return Number.isFinite(parsed) ? parsed : fallback;
}
