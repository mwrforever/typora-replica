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
  const scored: Array<{ item: QuickItem; score: number }> = [];
  for (const item of items) {
    const label = item.label.toLowerCase();
    const idx = label.indexOf(q);
    if (idx === -1) continue;
    // 分数：位置（前缀=0 优先）*10 + 名称长度（短优先）；固定项再降 5
    let score = idx * 10 + label.length;
    if (idx === 0) score -= 10;
    if (item.pinned) score -= 5;
    scored.push({ item, score });
  }
  scored.sort((a, b) => a.score - b.score || a.item.label.localeCompare(b.item.label));
  return scored.map((s) => s.item);
}
