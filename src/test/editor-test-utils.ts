// 编辑器行为测试助手：直连 Crepe 实例，模拟输入与按键（@testing-library 官方测试模式的封装）
import { Crepe, CrepeFeature } from "@milkdown/crepe";
import { editorViewCtx, type Editor } from "@milkdown/kit/core";
import { TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { fireEvent } from "@testing-library/dom";
import {
  applyMarkwellStringifyOptions,
  lowerLanguageCodeBlockSchema,
} from "../features/editor/create-editor";
import {
  configureFootnoteTooltip,
  footnoteTooltipPlugin,
} from "../features/editor/footnote-tooltip";
import { configureHtmlMerge } from "../features/editor/html/html-merge";
import { setupHtmlNodeView } from "../features/editor/html/html-node-view";
import { registerEditorInputRules } from "../features/editor/input-rules";
import { applyEditorKeymaps } from "../features/editor/keymaps";
import { openLinkPlugin } from "../features/editor/link/open-link";
import {
  configureToc,
  setupTocNodeView,
  setupTocRebuildListener,
  tocInputRule,
  tocSchema,
} from "../features/editor/toc/toc-plugin";

/** 按键修饰键组合 */
export interface KeyMods {
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  meta?: boolean;
}

/** 测试用编辑器实例句柄 */
export interface TestEditor {
  editor: Editor;
  crepe: Crepe;
  view: EditorView;
  getMarkdown(): string;
  insertText(text: string): void;
  press(key: string, mods?: KeyMods): void;
  setSelection(from: number, to: number): void;
}

/** makeTestEditor 可选配置 */
export interface MakeTestEditorOptions {
  /** 图片上传回调（对应 Crepe ImageBlock 的 onUpload，E15 用） */
  onUpload?: (file: File) => Promise<string>;
  /** 自定义 Crepe 特性开关（如关闭某 Feature 测试降级路径） */
  features?: Partial<Record<CrepeFeature, boolean>>;
}

/** 本次测试创建的实例清单，afterEach 统一销毁 */
const liveEditors: Crepe[] = [];

/** 销毁全部存活的测试编辑器（setup.ts 的 afterEach 调用） */
export function destroyTestEditors(): void {
  for (const crepe of liveEditors.splice(0)) {
    try {
      crepe.destroy();
    } catch {
      // 销毁失败不阻塞用例收尾
    }
  }
}

/**
 * 创建直连 Crepe 的测试编辑器
 * @param markdown 初始文档内容（默认空）
 * @param options 可选配置
 */
export async function makeTestEditor(
  markdown = "",
  options: MakeTestEditorOptions = {},
): Promise<TestEditor> {
  const root = document.createElement("div");
  document.body.appendChild(root);

  const crepe = new Crepe({
    root,
    defaultValue: markdown,
    features: options.features,
    featureConfigs: options.onUpload
      ? { [CrepeFeature.ImageBlock]: { onUpload: options.onUpload } }
      : undefined,
  });
  // 与产品工厂（create-editor.ts）同源注入自定义语法规则、Typora 式键位与序列化形态，
  // 保证测试环境覆盖自定义行为
  // 代码围栏语言落盘小写归一化（E6-4），与产品工厂同源插件
  crepe.editor.use(lowerLanguageCodeBlockSchema);
  // 脚注悬停预览浮层（E9），与产品工厂同源插件
  crepe.editor.use(footnoteTooltipPlugin);
  // TOC 目录（E12）：toc 节点 schema + `[toc]` 输入规则，与产品工厂同源插件
  crepe.editor.use(tocSchema);
  crepe.editor.use(tocInputRule);
  // E14 链接：Ctrl+点击在系统浏览器打开，与产品工厂同源插件
  crepe.editor.use(openLinkPlugin);
  crepe.editor.config((ctx) => {
    registerEditorInputRules(ctx);
    applyEditorKeymaps(ctx);
    // Typora 落盘形态（列表 `- ` 前缀、GFM 单词内下划线不转义），直接复用产品工厂同源函数
    applyMarkwellStringifyOptions(ctx);
    // 脚注悬停预览浮层规格（handleDOMEvents + PluginView）注入
    configureFootnoteTooltip(ctx);
    // TOC 解析/序列化接线与节点视图注册（E12），与产品工厂同源
    configureToc(ctx);
    setupTocNodeView(ctx);
    // E20 html 节点渲染 NodeView（清洗 + 渲染剥离），与产品工厂同源
    setupHtmlNodeView(ctx);
    // E20 行内 HTML 开闭标签合并（WYSIWYG 平价），与产品工厂同源
    configureHtmlMerge(ctx);
  });
  // 目录防抖重算接线（E12），与产品工厂同源
  setupTocRebuildListener(crepe);
  await crepe.create();
  liveEditors.push(crepe);

  const editor = crepe.editor;
  const view = editor.action((ctx) => ctx.get(editorViewCtx));

  return {
    editor,
    crepe,
    view,
    getMarkdown: () =>
      // remark 序列化器在文档末尾附加换行；计划断言约定不含尾随换行，统一去掉一个尾部换行
      crepe.getMarkdown().replace(/\n$/, ""),
    insertText(text: string) {
      view.focus();
      // 逐字模拟实时击键：每字符先走 handleTextInput 输入规则链（与真实键入路径一致，
      // 输入规则插件借此触发）；无规则命中时按 ProseMirror 真实输入路径直插文本
      for (const ch of text) {
        const { from, to } = view.state.selection;
        // handleTextInput 完整签名为 (view, from, to, text, deflt)，
        // 第 5 参 deflt 为默认插入动作（无规则命中时执行，等价于 ProseMirror 内部直插）
        const deflt = () => view.state.tr.insertText(ch);
        const handled = view.someProp("handleTextInput", (f) => f(view, from, to, ch, deflt));
        if (!handled) view.dispatch(deflt());
      }
    },
    press(key: string, mods: KeyMods = {}) {
      // 通过 ProseMirror 的 DOM keydown 监听链触发 keymap
      fireEvent.keyDown(view.dom, {
        key,
        ctrlKey: mods.ctrl ?? false,
        shiftKey: mods.shift ?? false,
        altKey: mods.alt ?? false,
        metaKey: mods.meta ?? false,
      });
    },
    setSelection(from: number, to: number) {
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)));
    },
  };
}
