// 跨文件结果点击定位链路（06 P3）
//
// 点击结果 → openFile 激活/新开标签 → 等活动实例就绪 → 以同一查询在该文档上
// 重建匹配集，按目标行首个命中的全局序号取位执行 revealRange（选中+滚动+3 秒
// 高亮，spec §F26 用户拍板）；序号越界/未命中（文档已变更）降级为仅激活标签
// 不定位（序号对齐裁决披露项），不抛错。
// 就绪等待：主路径吃 05 adopt 快照广播（subscribeDocUpdated 一次性订阅），
// 兜底 50ms 有限轮询——覆盖已知残余①「全新标签首挂窗口期广播跳过」。
// 归属校验（06 E2E 实测竞态根治）：openFile 跨标签激活后，门面切换由 Vue
// watch 异步完成，切换完成前 getView() 返回的仍是上一标签的旧实例——
// 以「注册表实例 == 门面当前实例」判定门面确已指向目标标签，未确认前
// 一律不采信瞬时视图（快路径/轮询/广播回调共用同一 grab 判据）。
import type { EditorView } from "@milkdown/kit/prose/view";
import { editorManager } from "../editor/editor-manager";
import { revealRange } from "../editor/reveal-range";
import { getInstance } from "../tabs/editor-registry";
import { useTabsStore } from "../tabs/tabs-store";
import { buildSearchQuery, nthMatch } from "./search-query";
import { useSearchStore } from "./search-store";

/** 点击定位高亮时长（AC-F26-2，D-B 裁决经 Task 9 参数传入） */
const REVEAL_HIGHLIGHT_MS = 3000;
/** 就绪轮询兜底：50ms × 40 次（2s 上限） */
const POLL_INTERVAL_MS = 50;
const POLL_MAX_TRIES = 40;

/**
 * 门面是否已指向目标标签的编辑器实例
 * @param tabId 目标标签 id
 * @returns 注册表登记实例与门面当前编辑器同源时 true；目标未挂号或门面
 *          尚指向其他标签（激活 watch 未 flush）时 false
 */
function facadeOnTarget(tabId: string): boolean {
  const inst = getInstance(tabId);
  return !!inst && editorManager.getEditor() === inst.crepe.editor;
}

/**
 * 等待指定标签成为激活标签且门面实例已切换就绪
 * @param tabId openFile 返回的标签 id
 * @returns 就绪的 EditorView；超时或标签已切走返回 undefined
 */
function waitForActiveView(tabId: string): Promise<EditorView | undefined> {
  const tabs = useTabsStore();
  // 双判据：标签激活 + 门面归属确认（缺一不可，防采信上一标签旧实例）
  const grab = (): EditorView | undefined =>
    tabs.activeTabId === tabId && facadeOnTarget(tabId)
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
  // 焦点先行（AC-F26-2「光标选中匹配文本」可见面）：ProseMirror 仅在视图持有
  // 焦点时才把状态选区回写为 DOM 选区（editorOwnsSelection 守卫），点击结果后
  // 焦点仍在侧栏按钮上，不聚焦则用户看不到光标落位，E2E 也无从断言选区
  view.focus();
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
