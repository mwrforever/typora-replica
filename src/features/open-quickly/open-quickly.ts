// Open Quickly 数据源组装（02 文档管理，F11）
//
// 候选 = 当前目录递归 .md 文件 ∪ 最近文件（含固定项）；路径去重时
// 最近文件优先（保留 pinned 标记）。
import { listDir } from "../../services/file-io";
import type { RecentFile } from "../../services/recent-files";
import type { QuickItem } from "./fuzzy";

/**
 * 组装搜索候选
 * @param currentDir 当前侧栏目录（可空）
 * @param recent 最近文件列表
 * @returns 去重后的候选（最近文件在前）
 */
export async function buildQuickItems(
  currentDir: string | undefined,
  recent: RecentFile[],
): Promise<QuickItem[]> {
  const items: QuickItem[] = [];
  const seen = new Set<string>();
  // 最近文件优先（含固定项）
  for (const recentItem of recent) {
    if (seen.has(recentItem.path)) continue;
    seen.add(recentItem.path);
    items.push({
      path: recentItem.path,
      label: basenameOf(recentItem.path),
      kind: "file",
      pinned: recentItem.pinned,
    });
  }
  // 当前目录递归 .md（跳过目录项）
  if (currentDir) {
    const entries = await listDir(currentDir, "md").catch(() => []);
    for (const entry of entries) {
      if (entry.isDir || seen.has(entry.path)) continue;
      seen.add(entry.path);
      items.push({
        path: entry.path,
        label: entry.name.replace(/\.md$/i, ""),
        kind: "file",
        pinned: false,
      });
    }
  }
  return items;
}

/** 取路径文件名 */
function basenameOf(path: string): string {
  const idx = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return idx === -1 ? path : path.slice(idx + 1);
}
