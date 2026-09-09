// 状态栏统计状态机用例（11 P1）：初始全零（AC-S3-8 初始形态）/ 双统计注入与清除往返。
// 纯 Pinia 状态机验证，不触编辑器（outline-store.spec 同构分层：统计值由装配层算得后注入）。
import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useStatusBarStore } from "./status-bar-store";

describe("useStatusBarStore 统计状态机", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("初始即全零与无选中（AC-S3-8 初始形态：编辑器未就绪窗口期按钮显示 0 不崩）", () => {
    const store = useStatusBarStore();
    expect(store.docStats).toEqual({ words: 0, characters: 0, lines: 0 });
    expect(store.selectionStats).toBeUndefined();
  });

  it("applyDocStats 整体替换全文统计", () => {
    const store = useStatusBarStore();
    store.applyDocStats({ words: 3, characters: 8, lines: 1 });
    expect(store.docStats).toEqual({ words: 3, characters: 8, lines: 1 });
    store.applyDocStats({ words: 0, characters: 0, lines: 0 }); // 重算收敛回全零同样成立
    expect(store.docStats).toEqual({ words: 0, characters: 0, lines: 0 });
  });

  it("applySelectionStats 可设置选区统计并以 undefined 清除（AC-S3-4 选中/取消往返）", () => {
    const store = useStatusBarStore();
    store.applySelectionStats({ words: 2, characters: 4, lines: 1 });
    expect(store.selectionStats).toEqual({ words: 2, characters: 4, lines: 1 });
    store.applySelectionStats(undefined);
    expect(store.selectionStats).toBeUndefined();
  });
});
