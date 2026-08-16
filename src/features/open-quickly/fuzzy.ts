// Open Quickly 模糊匹配（02 文档管理，F11）
//
// 匹配语义：大小写不敏感子串包含；排序：前缀命中 > 名称长度短 > 固定项 > 字典序。
// 空 query 返回原序（面板打开即全量候选）。纯函数，无状态。
/** 搜索候选条目 */
export interface QuickItem {
  /** 完整路径 */
  path: string;
  /** 显示名（文件名） */
  label: string;
  /** 类型（当前仅文件；固定文件夹后续扩展） */
  kind: "file" | "folder";
  /** 固定标记（最近文件固定项优先） */
  pinned: boolean;
}

/**
 * 模糊匹配 + 排序
 * @param query 用户输入（可空）
 * @param items 候选条目
 * @returns 匹配结果（无匹配返回空数组）
 */
export function searchQuickItems(query: string, items: QuickItem[]): QuickItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  // 命中位置（前缀=0 最优；排序层级依据）
  const matched: Array<{ item: QuickItem; idx: number }> = [];
  for (const item of items) {
    const idx = item.label.toLowerCase().indexOf(q);
    if (idx === -1) continue;
    matched.push({ item, idx });
  }
  // 严格层级排序（头注释即契约）：前缀命中 > 名称长度短 > 固定项 > 字典序
  matched.sort((left, right) => {
    const leftPrefix = left.idx === 0 ? 1 : 0;
    const rightPrefix = right.idx === 0 ? 1 : 0;
    if (leftPrefix !== rightPrefix) return rightPrefix - leftPrefix;
    if (left.item.label.length !== right.item.label.length) {
      return left.item.label.length - right.item.label.length;
    }
    if (left.item.pinned !== right.item.pinned) return left.item.pinned ? -1 : 1;
    return left.item.label.localeCompare(right.item.label);
  });
  return matched.map((entry) => entry.item);
}
