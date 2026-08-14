// 模块级 keymap 注册表
//
// 在 Crepe create() 之前的配置阶段调用（create-editor.ts 注入点），
// 10 设置快捷键模块通过 addEditorKeymap 扩展自定义键位。
// 注册机制：keymapCtx（KeymapManager），add 接受 { key, priority, onRun }；
// onRun(ctx) 返回 ProseMirror Command，build 时按 priority 降序 chainCommands。
import type { Ctx } from "@milkdown/kit/ctx";
import { commandsCtx, keymapCtx } from "@milkdown/kit/core";
import {
  codeBlockSchema,
  createCodeBlockCommand,
  headingSchema,
  listItemSchema,
  paragraphSchema,
  setBlockTypeCommand,
  toggleInlineCodeCommand,
  wrapInHeadingCommand,
} from "@milkdown/kit/preset/commonmark";
import { findParentNode } from "@milkdown/kit/prose";
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

// Typora 行内代码快捷键 Ctrl+Shift+`（Mod-Shift-`）：
// commonmark 预设仅绑定 Mod-e（ToggleInlineCode），未提供反引号键位；
// priority 200 与内置 Indent/Outdent 一致，选中文字后切换行内代码标记。
// 注意：$command 宏产物是插件而非命令本体，需经 commandsCtx 注册表以 key 调用
// （与预设 inlineCodeKeymap 的 Mod-e 绑定同一条调用路径）。
addEditorKeymap({
  key: "Mod-Shift-`",
  priority: 200,
  onRun: (ctx) => {
    const commands = ctx.get(commandsCtx);
    return () => commands.call(toggleInlineCodeCommand.key);
  },
});

// ── 标题级别键位（Typora 官方键位表：Ctrl+1~6 设级别、Ctrl+0 转段落、Ctrl+=/- 增减级别）──
// 内置 headingKeymap 仅绑定 Mod-Alt-1~6（TurnIntoH1~6）与 Mod-Alt-0（TurnIntoText），
// Ctrl+数字/=/ - 均无内置占用（修饰键不同不冲突），priority 默认 200 压制表格与 baseKeymap。

/**
 * 标题级别转换命令工厂：经 commandsCtx 注册表按 key 调用 wrapInHeadingCommand
 *
 * wrapInHeadingCommand 是 $Command 插件（MilkdownPlugin & { key, run }）而非可调用函数，
 * 与预设内置 headingKeymap 的 TurnIntoH1~6 绑定走同一条 commands.call 调用路径。
 * 命令在按键时经 KeymapManager.build 链执行；commands.call 即时对当前 view 状态生效。
 *
 * @param ctx milkdown 配置上下文（onRun 阶段注入）
 * @param level 目标标题级别（1-6）
 * @returns 消费按键的 ProseMirror Command
 */
function turnIntoHeadingCommand(ctx: Ctx, level: number): Command {
  const commands = ctx.get(commandsCtx);
  return () => commands.call(wrapInHeadingCommand.key, level);
}

// Ctrl+1~6：当前块直接设为对应级别（段落/标题/引用等统一收编，Typora 行为）
for (let level = 1; level <= 6; level++) {
  addEditorKeymap({
    key: `Mod-${level}`,
    onRun: (ctx) => turnIntoHeadingCommand(ctx, level),
  });
}

// Ctrl+0：当前块转为普通段落（Typora 的 TurnIntoText 等价键位，但走 setBlockType 命令路径）
addEditorKeymap({
  key: "Mod-0",
  onRun: (ctx) => {
    const commands = ctx.get(commandsCtx);
    return () => commands.call(setBlockTypeCommand.key, { nodeType: paragraphSchema.type(ctx) });
  },
});

/**
 * 增减标题级别命令工厂：读取光标所在 heading 级别并按 delta 增减，级别钳制在 1-6
 *
 * 与内置 DowngradeHeading（Delete/Backspace 降级）不同，本命令提供「升级/降级」成对操作：
 * Ctrl+=（delta 1）级别数字减一（H3→H2），Ctrl+-（delta -1）级别数字加一（H3→H4）。
 * 越界保护：H1 升级保持 H1、H6 降级保持 H6（AC-E2-5 钳制要求）；
 * 非标题上下文返回 false 不消费按键，自然回落后续键位链（表格内置/baseKeymap）。
 *
 * 命令本体经 commandsCtx 注册表以 key 获取（wrapInHeadingCommand 为 $Command 插件，
 * 与 turnIntoHeadingCommand 同路径），并以 keymap 处理器传入的 state/dispatch 执行。
 *
 * @param delta 级别变化量：1 = 升级（级别数字减一）；-1 = 降级（级别数字加一）
 * @returns onRun 闭包：解析命令注册表后返回消费按键的 ProseMirror Command
 */
function headingLevelCommand(delta: 1 | -1) {
  return (ctx: Ctx): Command => {
    const commands = ctx.get(commandsCtx);
    // 标题节点类型在 onRun 阶段解析（SchemaReady 之后，与 listItemSchema.type(ctx) 同理）
    const headingType = headingSchema.type(ctx);
    return (state, dispatch?, view?) => {
      // 从选区 $from 向上逐层查找所在 heading 节点；非标题上下文返回 undefined
      const parent = findParentNode((node) => node.type === headingType)(state.selection);
      if (!parent) return false; // 非标题上下文不消费按键，回落内置行为
      const currentLevel = parent.node.attrs.level as number;
      // 级别钳制：Math.max 防 H1 升级越界、Math.min 防 H6 降级越界
      const nextLevel = Math.min(6, Math.max(1, currentLevel - delta));
      return commands.get(wrapInHeadingCommand.key)(nextLevel)(state, dispatch, view);
    };
  };
}

// Ctrl+= 升级（级别数字减小）、Ctrl+- 降级（级别数字增大），级别钳制 1-6 无越界
addEditorKeymap({ key: "Mod-=", onRun: headingLevelCommand(1) });
addEditorKeymap({ key: "Mod--", onRun: headingLevelCommand(-1) });

/**
 * 插入代码围栏命令（E6-3：Ctrl+Shift+K，Typora 键位；Crepe 内置仅绑 Mod-Alt-c）
 *
 * 光标在代码块内：在当前代码块之后插入新的空代码块（Typora 行为——插入新围栏，
 * 而非嵌套包裹）。wrapInBlockTypeCommand 对 code_block 不可嵌套——findWrapping 要求
 * 被包裹内容能成为包裹节点的子节点，而 code_block 内容为 text* 无法容纳任何块，
 * findWrapping 恒返回 null（实测段落场景同样为 null：段落是 inline 内容同样不可成为
 * code_block 子节点），故插入路径自定义为「在其后插入空围栏」。
 * 非代码块上下文：当前块转换为代码围栏（与内置 CreateCodeBlock 命令同路径——
 * setBlockType 完成 textblock→textblock 转换，等价内置 Mod-Alt-c 键位行为）。
 *
 * 命令本体在 onRun 阶段解析节点类型（SchemaReady 之后，与 listItemSchema.type(ctx) 同理），
 * 并以 keymap 处理器传入的 state/dispatch 执行。
 */
function insertCodeFenceCommand(ctx: Ctx): Command {
  const commands = ctx.get(commandsCtx);
  // 代码块节点类型在 onRun 阶段解析（SchemaReady 之后）
  const codeBlockType = codeBlockSchema.type(ctx);
  return (state, dispatch) => {
    // 从光标位置向上逐层查找所在代码块（depth 0 = 文档顶层，未命中）
    const { $from } = state.selection;
    let depth = $from.depth;
    while (depth > 0 && $from.node(depth).type !== codeBlockType) depth--;
    if (depth === 0) {
      // 非代码块上下文：当前块转换为代码围栏。
      // 注意：commands.get 返回命令创建器（Cmd），调用后得到可执行的 ProseMirror Command；
      // 与 commands.call（立即执行并返回 boolean）语义不同，此处需延迟到按键时执行
      return commands.get(createCodeBlockCommand.key)()(state, dispatch);
    }
    if (!dispatch) return true;
    // 在当前代码块之后插入新的空代码块（code_block 内容 text* 无必填子节点，空节点合法）
    dispatch(state.tr.insert($from.after(depth), codeBlockType.create()).scrollIntoView());
    return true;
  };
}

// Ctrl+Shift+K：插入代码围栏（Typora 键位；priority 默认 200 压制表格内置与 baseKeymap）
addEditorKeymap({ key: "Mod-Shift-k", onRun: insertCodeFenceCommand });
