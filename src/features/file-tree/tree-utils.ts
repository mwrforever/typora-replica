// 文件树工具（03 文件树，纯函数）
//
// 职责：Rust list_dir 扁平条目 → 树结构组装；Duplicate/新建命名规则；
// 拖入插链接的相对路径计算。白名单常量与 Rust 侧 SUPPORTED_TEXT_EXTENSIONS
// 同步（spec §3 一致性——修改须两处同时更新）。
// 注意：本任务（Task 4）仅交付 store 依赖的最小部分（白名单常量/树节点/树构建），
// duplicateTargetName/isInvalidFileName/relativeLinkPath 由 Task 5 补全。
import type { DirEntry } from "../../services/file-io";

/** 受支持文本扩展名白名单（与 src-tauri/src/io/fs.rs 常量同步） */
export const SUPPORTED_TEXT_EXTENSIONS: string[] = [
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
];

/** 树节点（buildTree 产物；children 为空数组表示叶子） */
export interface TreeNode {
  /** 完整路径（打开/拖拽/菜单动作统一用，与 DirEntry.path 同源） */
  path: string;
  /** 相对根路径（/ 分隔，渲染 key 与展开集合用） */
  relPath: string;
  /** 名称（末级文件名/目录名） */
  name: string;
  /** 是否目录 */
  isDir: boolean;
  /** 扩展名（不含点，目录为空串） */
  ext: string;
  /** 子节点 */
  children: TreeNode[];
}

/**
 * 扁平条目 → 树结构（按 name 的 / 层级组装；Rust 已完成排序与过滤）
 * @param entries listDirDetailed 返回的扁平条目（name 为相对根 / 分隔）
 * @param rootPath 遍历根目录完整路径（节点 path = rootPath + "/" + relPath，
 *                 与 DirEntry.path 同源；Windows 反斜杠由调用方归一）
 * @returns 根级节点数组（目录与文件按传入顺序保持）
 */
export function buildTree(entries: DirEntry[], rootPath: string): TreeNode[] {
  const root: TreeNode[] = [];
  // 根目录归一为 / 分隔且去尾分隔符（与 DirEntry.name 的 / 分隔对齐）
  const base = rootPath.replace(/\\/g, "/").replace(/\/+$/, "");
  for (const e of entries) {
    const segments = e.name.split("/");
    let level = root;
    let relPath = "";
    segments.forEach((seg, i) => {
      relPath = relPath ? `${relPath}/${seg}` : seg;
      const isDir = i < segments.length - 1 || e.isDir;
      let node = level.find((n) => n.relPath === relPath);
      if (!node) {
        node = {
          path: `${base}/${relPath}`,
          relPath,
          name: seg,
          isDir,
          ext: isDir ? "" : e.ext,
          children: [],
        };
        level.push(node);
      }
      level = node.children;
    });
  }
  return root;
}
