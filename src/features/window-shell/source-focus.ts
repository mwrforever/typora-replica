// 源码层 Focus 叠加扩展（12 窗口外壳 W5；AC-M-9：源码模式下 Focus 生效可叠加）
//
// 职责：把 Focus 模式（F8）的淡化语义以 CodeMirror 6 行装饰落到源码层——
// 当前行挂 Typora 契约类名 md-focus（与 WYSIWYG 侧 focus-typewriter-plugin 同名），
// 非当前行经 SourceModeLayer 的 scoped CSS（.on-focus-mode 作用域锚点）以
// --blur-text-color 淡化。开关经 StateEffect 镜像进 CM 状态机（view-modes 控制器
// watch F8 状态派发），光标行随事务自动重算。
//
// 边界说明：Typora 官方源码层为 CodeMirror 5（主题对源码 Focus 无公开契约类名），
// 本层沿用官方 WYSIWYG 契约类名（on-focus-mode / md-focus）保持两视图层语义同源；
// 与 W4 源码切换状态机零耦合（本扩展只读开关与选区，不触碰内容装载/回写链路）。
import { StateEffect, StateField } from "@codemirror/state";
import type { EditorState, Extension } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView } from "@codemirror/view";

/** 源码层 Focus 开关 effect（true = 开启淡化跟随；由 SourceModeLayer watch 派发） */
export const setSourceFocusEffect = StateEffect.define<boolean>();

/** 当前光标行装饰类（Typora 契约类名，与 WYSIWYG 侧同名） */
const FOCUS_LINE_CLASS = "md-focus";

/** 字段状态：开关 + 当前光标行装饰集（关闭态装饰恒空） */
interface SourceFocusState {
  enabled: boolean;
  decorations: DecorationSet;
}

/** 按开关与当前选区构建行装饰（光标所在行整行挂 md-focus） */
function buildLineDecoration(state: EditorState, enabled: boolean): DecorationSet {
  if (!enabled) return Decoration.none;
  const line = state.doc.lineAt(state.selection.main.head);
  return Decoration.set([Decoration.line({ class: FOCUS_LINE_CLASS }).range(line.from)]);
}

/**
 * 源码层 Focus 行装饰字段（随 SourceModeLayer 扩展组装配）
 *
 * 更新规则：开关 effect 存在时以 effect 值为准；纯编辑/选区事务仅在开启态重算
 * 光标行（关闭态短路，零开销）。
 */
export const sourceFocusField = StateField.define<SourceFocusState>({
  create: () => ({ enabled: false, decorations: Decoration.none }),
  update(value, tr) {
    const effect = tr.effects.find((e) => e.is(setSourceFocusEffect));
    const enabled = effect !== undefined ? effect.value : value.enabled;
    // 双关态短路：开关关且此前也关（防无谓重算与装饰集重建）
    if (!enabled && !value.enabled) return value;
    return { enabled, decorations: buildLineDecoration(tr.state, enabled) };
  },
  provide: (field) =>
    EditorView.decorations.compute([field], (state) => state.field(field).decorations),
});

/**
 * 源码层 Focus 扩展（SourceModeLayer buildExtensions 装配；开关经
 * view.dispatch({ effects: setSourceFocusEffect.of(on) }) 驱动）
 */
export function sourceFocusExtension(): Extension {
  return sourceFocusField;
}
