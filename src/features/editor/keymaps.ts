// 模块级 keymap 注册表
//
// 在 Crepe create() 之前的配置阶段调用（create-editor.ts 注入点），
// 10 设置快捷键模块通过 addEditorKeymap 扩展自定义键位。
// 注册机制：keymapCtx（KeymapManager），add 接受 { key, priority, onRun }；
// onRun(ctx) 返回 ProseMirror Command，build 时按 priority 降序 chainCommands。
import type { Ctx } from "@milkdown/kit/ctx";
import { keymapCtx } from "@milkdown/kit/core";
import { listItemSchema } from "@milkdown/kit/preset/commonmark";
import { liftListItem, sinkListItem } from "@milkdown/kit/prose/schema-list";
import type { Command } from "@milkdown/kit/prose/state";

/** 单条 keymap 注册项 */
export interface EditorKeymapEntry {
  /** 按键组合（ProseMirror keymap 语法，如 "Mod-["） */
  key: string;
  /** 命中后执行的动作（返回 ProseMirror Command，命令返回 true 即消费该按键） */
  onRun: (ctx: Ctx) => Command;
  /** 冲突优先级（默认 200，高于表格内置的 100 与 baseKeymap 的 50） */
  priority?: number;
}

/** 已注册键位清单（供 10 模块查询冲突） */
const registry: EditorKeymapEntry[] = [];

/**
 * 注册编辑器键位（create() 前调用）
 * @param entry 键位定义
 */
export function addEditorKeymap(entry: EditorKeymapEntry): void {
  // 注册时落定生效优先级（默认 200），10 模块查重时可直接看到生效值
  registry.push({ ...entry, priority: entry.priority ?? 200 });
}

/** 查询已注册键位（10 模块扩展前查重） */
export function listEditorKeymaps(): readonly EditorKeymapEntry[] {
  return registry;
}

/** 是否已注册过该键位（10 模块扩展前查重） */
export function hasEditorKeymap(key: string): boolean {
  return registry.some((e) => e.key === key);
}

/**
 * 将注册表写入 keymapCtx（create-editor.ts 的 config 阶段调用一次）
 * @param ctx milkdown 配置上下文
 */
export function applyEditorKeymaps(ctx: Ctx): void {
  for (const entry of registry) {
    ctx.get(keymapCtx).add({
      key: entry.key,
      priority: entry.priority,
      onRun: entry.onRun,
    });
  }
}

// ── 内置键位定义（模块加载即注册，create() 时统一生效）──

// Typora 特有反向 Indent/Outdent 配对（用户实测裁决，见 01 调研第 7 节 #1）：
//   Ctrl+[ = Indent（缩进增加，sinkListItem）——与 VS Code 等业界习惯相反
//   Ctrl+] = Outdent（缩进减少，liftListItem）
// priority 200 同时压制表格内置的 Mod-[（PrevCell，priority 50/100）：
// 在列表项内 sink/lift 生效即消费按键；非列表上下文返回 false 自然回落内置行为。
// 注意：listItemSchema.type(ctx) 必须在 onRun 内解析——onRun 于 KeymapManager.build()
// 时（SchemaReady 之后）被调用，若在配置阶段提前解析会因 schema 未就绪而抛错。
addEditorKeymap({
  key: "Mod-[",
  onRun: (ctx) => sinkListItem(listItemSchema.type(ctx)),
});

addEditorKeymap({
  key: "Mod-]",
  onRun: (ctx) => liftListItem(listItemSchema.type(ctx)),
});
