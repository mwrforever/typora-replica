// 跨文件结果点击定位链路（06 P3）
//
// 点击结果 → openFile 激活/新开标签 → 等活动实例就绪 → 以同一查询在该文档上
// 重建匹配集，按目标行首个命中的全局序号取位执行 revealRange（选中+滚动+3 秒
// 高亮，spec §F26 用户拍板）；序号越界/未命中（文档已变更）降级为仅激活标签
// 不定位（序号对齐裁决披露项），不抛错。
// 就绪等待：主路径吃 05 adopt 快照广播（subscribeDocUpdated 一次性订阅），
// 兜底 50ms 有限轮询——覆盖已知残余①「全新标签首挂窗口期广播跳过」。
import type { EditorView } from "@milkdown/kit/prose/view";
import { editorManager } from "../editor/editor-manager";
import { revealRange } from "../editor/reveal-range";
import { useTabsStore } from "../tabs/tabs-store";
import { buildSearchQuery, nthMatch } from "./search-query";
import { useSearchStore } from "./search-store";

/** 点击定位高亮时长（AC-F26-2，D-B 裁决经 Task 9 参数传入） */
const REVEAL_HIGHLIGHT_MS = 3000;
/** 就绪轮询兜底：50ms × 40 次（2s 上限） */
const POLL_INTERVAL_MS = 50;
const POLL_MAX_TRIES = 40;

/**
 * 等待指定标签成为激活标签且门面视图就绪
 * @param tabId openFile 返回的标签 id
 * @returns 就绪的 EditorView；超时或标签已切走返回 undefined
 */
function waitForActiveView(tabId: string): Promise<EditorView | undefined> {
  const tabs = useTabsStore();
  const grab = (): EditorView | undefined =>
    tabs.activeTabId === tabId
      ? ((editorManager.getView() as EditorView | undefined) ?? undefined)
      : undefined;
  // 快路径：已激活且视图就绪（同文件去重激活的常见形态）
  const immediate = grab();
  if (immediate) return Promise.resolve(immediate);
  return new Promise((resolve) => {
    let settled = false;
    let tries = 0;
    // 一次性决议（幂等）：先到先得；函数声明提升，轮询/订阅句柄在其后注册为常量
    function finish(view: EditorView | undefined): void {
      if (settled) return;
      settled = true;
      clearInterval(pollTimer);
      offDoc();
      resolve(view);
    }
    // 兜底：残余①首挂窗口期广播被跳过，50ms 轮询直至视图就绪或超时放弃
    const pollTimer = setInterval(() => {
      const view = grab();
      if (view || tries >= POLL_MAX_TRIES) finish(view);
      tries += 1;
    }, POLL_INTERVAL_MS);
    // 主路径：adopt 快照广播（05 终审 Important-1）——激活切换即收当前 doc
    const offDoc = editorManager.subscribeDocUpdated(() => {
      finish(grab());
    });
  });
}

/**
 * 打开并定位全局搜索结果（结果条目点击入口）
 * @param filePath 结果文件完整路径
 * @param fileName 文件名（作 openFile 标题）
 * @param matchIndex 该行首个命中的文件内全局序号（0 起，Rust 扫描记录；
 *        序号对齐裁决：空行在 PM 文档模型不可恢复、行号映射会漂移，命中序天然对齐）
 */
export async function revealGlobalMatch(
  filePath: string,
  fileName: string,
  matchIndex: number,
): Promise<void> {
  const store = useSearchStore();
  // 查询快照先行：await 期间用户改词不影响本次定位口径
  const built = buildSearchQuery({
    query: store.globalQuery,
    caseSensitive: store.globalCaseSensitive,
    wholeWord: store.globalWholeWord,
    regexp: store.globalRegexp,
  });
  const tabs = useTabsStore();
  const { id } = tabs.openFile(filePath, fileName);
  const view = await waitForActiveView(id);
  if (!view) return; // 标签被切走/超时未就绪：放弃本次定位（用户可再点）
  const editor = editorManager.getEditor();
  if (!editor) return;
  if (built.status === "ok") {
    const match = nthMatch(view.state, built.query, matchIndex);
    if (match) {
      revealRange(editor, match.from, match.to, REVEAL_HIGHLIGHT_MS);
      return;
    }
  }
  // 序号越界（文档已变更/两侧引擎命中集边缘差异）：降级为仅激活标签不定位（披露项）
}
