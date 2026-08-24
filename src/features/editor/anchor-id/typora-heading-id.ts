// Typora 式 heading 锚点 id 插件（05 大纲 P1）
//
// 替代 preset-commonmark 内置 syncHeadingIdPlugin：重复标题后缀对齐 Typora「-1 起编号」
// （内置硬编码 `-#2` 不可配）。骨架复刻内置：doc 变更全量重算、addToHistory:false 不污染
// 撤销历史、IME 组合期（view.composing）跳过、空文本标题跳过。
// 禁用内置的方式：本插件工厂执行时序晚于 preset-commonmark 的 $prose 注册（use 注册序保证），
// 此刻 prosePluginsCtx 已含内置 Plugin 实例，原地过滤移除后由 $prose 包装器推入本插件。
import { prosePluginsCtx } from "@milkdown/kit/core";
import type { Ctx } from "@milkdown/kit/ctx";
import { headingSchema } from "@milkdown/kit/preset/commonmark";
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";

/** 本插件的 PluginKey（命名避开内置 MILKDOWN_HEADING_ID 前缀） */
export const typoraHeadingIdKey = new PluginKey("MARKWELL_TYPORA_HEADING_ID");

/** 内置 sync-heading-id 插件的 key 前缀（node_modules 实证：PluginKey("MILKDOWN_HEADING_ID")） */
const BUILTIN_KEY_PREFIX = "MILKDOWN_HEADING_ID";

/**
 * 读取 ProseMirror 插件实例的运行时 key（形如 name+"$"）
 *
 * 本版 prosemirror-state 的 d.ts 遗漏了 Plugin 实例与 PluginKey 的 key 属性声明
 * （运行时在构造器赋值 this.key = spec.key.key），直接访问报 TS2339，故以最小
 * 结构面经 unknown 收窄读取（禁 any 规则允许的 unknown+收窄，理由即此类型缺口）；
 * 无显式 spec.key 的插件返回空串（内置插件恒带显式 key，过滤不受影响）。
 * @param plugin 待读的插件实例
 * @returns 运行时 key 字符串（无显式 key 时为空串）
 */
export function keyOf(plugin: Plugin): string {
  return (plugin as unknown as { spec?: { key?: { key?: string } } }).spec?.key?.key ?? "";
}

/** Typora 式基础 slug：小写 + 折叠空白为 - + 保留中文（与 Milkdown 默认生成器一致） */
const slugOf = (text: string): string => text.toLowerCase().trim().replace(/\s+/g, "-");

/**
 * 从 prosePluginsCtx 移除内置同步插件（幂等；供插件工厂与本文件测试调用）
 * @param ctx milkdown 配置上下文
 */
export function disableBuiltinSyncHeadingId(ctx: Ctx): void {
  ctx.update(prosePluginsCtx, (plugins) =>
    plugins.filter((p) => !keyOf(p).startsWith(BUILTIN_KEY_PREFIX)),
  );
}

/** Typora 锚点 id 插件（create-editor.ts 与测试助手同源注册） */
export const typoraHeadingIdPlugin = $prose((ctx) => {
  // 先禁用内置再返回本插件实例：两插件对同一 attrs.id 各写各的格式会无限乒乓，
  // 过滤必须发生在同一工厂内（时序依据见文件头注释）
  disableBuiltinSyncHeadingId(ctx);
  const headingType = headingSchema.type(ctx);

  const updateId = (view: EditorView): void => {
    if (view.composing) return;
    /** 基础 slug → 已分配次数（Typora 编号：首次无后缀，重复依次 -1/-2） */
    const used = new Map<string, number>();
    const tr = view.state.tr.setMeta("addToHistory", false);
    let found = false;
    view.state.doc.descendants((node, pos) => {
      if (node.type !== headingType) return;
      if (node.textContent.trim().length === 0) return;
      const base = slugOf(node.textContent);
      const seen = used.get(base) ?? 0;
      const id = seen === 0 ? base : `${base}-${seen}`;
      used.set(base, seen + 1);
      if (node.attrs.id !== id) {
        found = true;
        tr.setMeta(typoraHeadingIdKey, true).setNodeMarkup(pos, undefined, { ...node.attrs, id });
      }
    });
    if (found) view.dispatch(tr);
  };

  return new Plugin({
    key: typoraHeadingIdKey,
    view: (view) => {
      updateId(view);
      return {
        update: (v, prevState) => {
          if (!v.state.doc.eq(prevState.doc)) updateId(v);
        },
      };
    },
  });
});
