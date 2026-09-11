<!-- 源码模式视图层（12 窗口外壳 W4；AC-M-6 语法高亮载体）
     CodeMirror 6 编辑器实例：挂载创建、随应用保活——双实例保活的源码侧
     （Crepe 实例由 04 TabHost 各标签持有，本层与 TabHost 以 v-show 互斥显隐，
     两侧实例均不销毁，保 undo 与光标）。
     W5（AC-M-9）：源码模式 Focus 叠加——F8 开启时以 source-focus 扩展给当前
     光标行挂 Typora 契约类名 md-focus、根容器挂 on-focus-mode，非当前行经
     scoped CSS 以 --blur-text-color 淡化（与 WYSIWYG 侧插件语义同源）；
     本层为 TabHost 的兄弟节点，不触碰 Crepe root DOM。
     暗色适配：08 主题 systemDark 驱动 Compartment 重配（oneDark 高亮 +
     与 crepe-overrides 暗色令牌同值的底色），不引入全局 CSS。 -->
<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { defaultHighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { oneDarkHighlightStyle } from "@codemirror/theme-one-dark";
import { useThemeStore } from "../theme/theme-store";
import { useViewModes } from "./view-modes";
import { setSourceFocusEffect, sourceFocusField } from "./source-focus";
import { useSourceMode } from "./source-mode";
import type { SourceModeHost } from "./source-mode";

/** 编辑器容器（EditorView 挂载点） */
const container = ref<HTMLElement | undefined>();

/** 主题状态（08：systemDark 镜像源，暗色切换即重配主题 compartment） */
const theme = useThemeStore();

/** 源码模式单例（宿主上缴 + active 显隐由父层绑定） */
const sourceMode = useSourceMode();

/** 视图模式单例（12 W5：Focus 开关驱动源码层叠加，F8 状态单一事实源） */
const viewModes = useViewModes();

/** CodeMirror 视图句柄（挂载创建、卸载销毁；undefined = 未就绪） */
let view: EditorView | undefined;

/** 明暗主题 compartment（systemDark 变化时仅重配该片段，其余扩展不动） */
const themeCompartment = new Compartment();

/** 共享版式主题：自动换行 + 等宽字体（设计令牌）+ 行号关（不装 gutters 扩展） */
const chromeTheme = EditorView.theme({
  "&": { height: "100%" },
  ".cm-scroller": {
    fontFamily: "var(--markwell-font-code)",
    lineHeight: "1.7",
    padding: "16px 0",
    overflowY: "auto",
  },
  ".cm-content": { padding: "0 24px", maxWidth: "100%" },
  ".cm-line": { padding: "0" },
});

/** 亮色主题（与 crepe-overrides 亮色令牌同值） */
const lightTheme = EditorView.theme({
  "&": { backgroundColor: "#ffffff", color: "#1f2937" },
  "&.cm-focused": { outline: "2px solid #0f766e", outlineOffset: "-2px" },
});

/** 暗色主题（与 crepe-overrides 暗色令牌同值；dark 基座启用 CM 暗色默认样式） */
const darkTheme = EditorView.theme(
  {
    "&": { backgroundColor: "#1e1e1e", color: "#e5e7eb" },
    "&.cm-focused": { outline: "2px solid #2dd4bf", outlineOffset: "-2px" },
  },
  { dark: true },
);

/** 按当前色系取主题扩展组（语法高亮：亮 default / 暗 oneDark 配色） */
function themeExtensions() {
  return theme.systemDark
    ? [darkTheme, syntaxHighlighting(oneDarkHighlightStyle)]
    : [lightTheme, syntaxHighlighting(defaultHighlightStyle)];
}

/** Ctrl+/ 前置接管键位（C1 审查修复）：defaultKeymap 自带 Mod-/ → toggleComment
 *  （@codemirror/commands 6.10.4 bundle 实证；lang-markdown 已注册 commentTokens
 *  使注释可达）——焦点在源码层按 Ctrl+/ 会把当前行包进 HTML 注释且 preventDefault
 *  劫持窗口快捷键（AC-M-7 主键盘路径失败 + 污染经回写同步 WYSIWYG 与落盘）。
 *  处置取「前置接管」而非「过滤 defaultKeymap」：CM keymap 先注册者优先，绑定
 *  恒定胜出且不依赖「CM 未消费 → 冒泡到 window」的传播链；语义与 WYSIWYG 侧
 *  Ctrl+/ 对称（源码态切回）；返回 true 后 CM preventDefault，window 层
 *  defaultPrevented 守卫同步跳过，无双触发 */
const takeoverKeymap = keymap.of([
  {
    key: "Mod-/",
    run: () => {
      sourceMode.toggle();
      return true;
    },
  },
]);

/** 组装扩展：markdown 语法高亮 + 历史/默认键位 + 自动换行 + 明暗主题 compartment + Focus 行装饰 */
function buildExtensions() {
  return [
    EditorView.lineWrapping,
    history(),
    takeoverKeymap, // 必须位于 defaultKeymap 之前（CM keymap 先注册者优先，C1）
    keymap.of([...defaultKeymap, ...historyKeymap]),
    markdown(),
    chromeTheme,
    themeCompartment.of(themeExtensions()),
    sourceFocusField,
  ];
}

/**
 * 源码层宿主（状态机 SourceModeHost 的 CodeMirror 实现）
 * 行列口径：与 01 source-pos 一致（0 起；列 = UTF-16 码元偏移）
 */
function createHost(): SourceModeHost {
  return {
    isReady: () => view !== undefined,
    load: (text, cursor) => {
      if (!view) return;
      const doc = view.state.doc;
      // 行列收敛到合法位置（越界锚点会使 dispatch 抛错）
      const line = doc.line(Math.max(1, Math.min(cursor.line + 1, doc.lines)));
      const anchor = Math.max(line.from, Math.min(line.from + cursor.col, line.to));
      // 内容与光标同一事务落地：文本未变时只挪光标（防无谓的历史记录）
      const changes = text === doc.toString() ? [] : [{ from: 0, to: doc.length, insert: text }];
      view.dispatch({ changes, selection: { anchor }, scrollIntoView: true });
    },
    getText: () => view?.state.doc.toString() ?? "",
    getCursor: () => {
      if (!view) return { line: 0, col: 0 };
      const head = view.state.selection.main.head;
      const line = view.state.doc.lineAt(head);
      return { line: line.number - 1, col: head - line.from };
    },
    focus: () => view?.focus(),
  };
}

onMounted(() => {
  const parent = container.value;
  if (!parent) return;
  view = new EditorView({
    state: EditorState.create({ doc: "", extensions: buildExtensions() }),
    parent,
  });
  sourceMode.setHost(createHost());
  // 挂载即对齐 Focus 开关（先开 Focus 后进源码模式的首帧生效）
  view.dispatch({ effects: setSourceFocusEffect.of(viewModes.focusEnabled.value) });
});

// F8 开关注入 CM 状态机（focusEnabled 为 view-modes 单例响应式状态）
watch(
  () => viewModes.focusEnabled.value,
  (on) => {
    view?.dispatch({ effects: setSourceFocusEffect.of(on) });
  },
);

onBeforeUnmount(() => {
  // 先注销宿主再销毁视图：防止销毁期间状态机触达半死实例
  sourceMode.setHost(undefined);
  view?.destroy();
  view = undefined;
});

// 明暗切换重配主题 compartment（08 systemDark 镜像；detached 语义随组件作用域收口）
watch(
  () => theme.systemDark,
  () => {
    view?.dispatch({ effects: themeCompartment.reconfigure(themeExtensions()) });
  },
);
</script>

<template>
  <div
    class="source-mode"
    :class="{ 'on-focus-mode': viewModes.focusEnabled.value }"
    data-testid="source-mode-layer"
  >
    <div ref="container" class="source-mode__editor"></div>
    <!-- 丢弃未回写编辑的用户可见提示（I3）：数据有损操作不静默；数秒自动消隐 -->
    <div v-if="sourceMode.discardNotice.value" class="source-mode__notice" role="status">
      {{ sourceMode.discardNotice.value }}
    </div>
  </div>
</template>

<style scoped>
/* 源码层占满中央区（与 TabHost 同层互斥显隐，由父层 v-show 控制） */
.source-mode {
  position: relative; /* 丢弃提示浮层的定位基准 */
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

/* 丢弃提示浮层（I3）：层内底部居中轻条，error 色醒目但不遮挡编辑区；
   --crepe-color-error 作用域在 .milkdown 内，本层回落同值设计令牌 */
.source-mode__notice {
  position: absolute;
  bottom: 16px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 10;
  padding: 6px 14px;
  border-radius: 6px;
  background: var(--crepe-color-error, #dc2626);
  color: #ffffff;
  font-size: 13px;
  line-height: 1.5;
}

.source-mode__editor {
  height: 100%;
}

/* Focus 叠加（AC-M-9）：当前行豁免（md-focus 由 source-focus 扩展注入），
   非当前行以主题淡化变量降色（变量缺省回落与 crepe-overrides 亮色段同值）。
   cm-line 为 CM 生成 DOM，无 scoped 标记，经 :deep 命中 */
.on-focus-mode :deep(.cm-line:not(.md-focus)) {
  color: var(--blur-text-color, #b8b8b8);
}
</style>
