// 状态栏统计状态机（11 P1）
//
// 单一职责：承载全文统计与选区统计两块领域状态——统计值由 use-status-bar-data 装配层
// 经 word-count 纯函数算得后注入，store 不触碰编辑器实例（useOutlineStore 同构分层）。
// 默认计数单位为组件局部 UI 状态，不入本 store（B.2.4；会话内不持久化，披露 7）。
import { ref } from "vue";
import { defineStore } from "pinia";
import type { WordCountStats } from "../../utils/word-count";

/** 状态栏统计 store（setup store 形态，state 全量 return——宪法 B.2.4） */
export const useStatusBarStore = defineStore("statusBar", () => {
  /** 全文统计（初始全零：编辑器未就绪窗口期按钮显示 0——AC-S3-8 不崩语义） */
  const docStats = ref<WordCountStats>({ words: 0, characters: 0, lines: 0 });
  /** 选区统计（undefined = 无选中/光标态，按钮显示全量口径） */
  const selectionStats = ref<WordCountStats | undefined>(undefined);

  /** 全文统计重算入口（docUpdated 防抖通道与标签切换拉取共用） */
  function applyDocStats(stats: WordCountStats): void {
    docStats.value = { ...stats };
  }

  /** 选区统计回写入口（非空选区传统计值；光标/取消选中传 undefined） */
  function applySelectionStats(stats: WordCountStats | undefined): void {
    selectionStats.value = stats === undefined ? undefined : { ...stats };
  }

  return { docStats, selectionStats, applyDocStats, applySelectionStats };
});
