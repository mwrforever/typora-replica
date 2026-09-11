// 窗口域 keyBinding 动态快捷键（12 W2 补全；TASK.md 10#1 执行接线）
//
// 职责：用户经 conf.user.json 给窗口域命令（catalog domain=window）配置自定义组合
// 后，按键触发对应命令——与菜单 action 共用同一命令函数（AC-M-3，经
// runWindowKeybindingCommand 查 WINDOW_KEYBINDING_COMMANDS 派发）。
//
// 口径（跟随 10 keyBinding 既定语义）：
// - 仅消费 getMenuShortcutEntries 合并产物中 domain=window 且 source=custom 的条目；
//   默认组合（New Tab=Ctrl+N 等）由既有窗口快捷键服务（tabs-shortcuts 等）注册，
//   本服务不重复——「custom 覆盖默认」的执行层去重机制即窗口保留组合集：
//   custom 与默认同键时 parseShortcutCombo 命中 WINDOW_RESERVED_PM_KEYS 返回
//   undefined → 告警跳过，既有服务的同键注册保持唯一执行（防双重执行，M-1② 同源）；
// - keydown 冒泡监听 + defaultPrevented 守卫（与 window-shortcuts 同型分层：
//   编辑器 keymap 命中仅 preventDefault 不阻断传播，窗口层以守卫收口）；
// - 重注册模型：每次调用全量注册当前条目集并返回注销函数，调用方（App.vue 装配）
//   watch menuShortcutEntries 变化时先注销旧集再注册新集——防监听叠加泄漏。
import type { MenuShortcutEntry } from "../settings/shortcut-binding";
import { parseShortcutCombo } from "../settings/shortcut-keys";
import { WINDOW_KEYBINDING_COMMANDS } from "./menu-router";

/** 窗口域命令执行回调（装配层注入：commandId → runWindowKeybindingCommand(menuDeps)） */
export type WindowCommandRunner = (commandId: string) => void;

/**
 * 判定键盘事件命中 canonical 组合键
 * @param event 键盘事件
 * @param pmKey canonical ProseMirror 键名（shortcut-keys.ts 解析产物，修饰序固定
 *              "Mod[-Alt][-Shift]-主键"；主键 = canonical 事件键名）
 * @returns true = 修饰位精确一致且主键匹配（字母键大小写归一——Shift 参与时
 *          event.key 为大写形态；具名键/符号原样比对）
 */
export function matchesShortcutEvent(event: KeyboardEvent, pmKey: string): boolean {
  // 修饰段按 canonical 固定序前缀剥离（Mod→Alt→Shift，shortcut-keys.ts 构造序）：
  // 主键可为符号 "-"（canonical "Mod--"），末段索引切分会产生空主键歧义，不可用
  let rest = pmKey;
  const needCtrl = rest.startsWith("Mod-");
  if (needCtrl) rest = rest.slice(4);
  const needAlt = rest.startsWith("Alt-");
  if (needAlt) rest = rest.slice(4);
  const needShift = rest.startsWith("Shift-");
  if (needShift) rest = rest.slice(6);
  const main = rest;
  // 修饰位精确比对（多修不命中）：仅判存在性
  if (event.ctrlKey !== needCtrl) return false;
  if (event.altKey !== needAlt) return false;
  if (event.shiftKey !== needShift) return false;
  // 主键：字母键大小写归一（event.key 随 Shift 漂移为大写），具名键/符号原样
  return event.key === main || event.key.toLowerCase() === main.toLowerCase();
}

/**
 * 注册窗口域 keyBinding 动态快捷键（App 装配层调用；entries 变化时先注销旧返回值
 * 再以新条目集重新调用本函数——全量重注册防监听叠加）
 *
 * @param entries 菜单快捷键合并条目（settingsStore.menuShortcutEntries 实时产物）
 * @param run 命令执行回调（装配层桥接 runWindowKeybindingCommand + menuDeps）
 * @returns 注销函数（移除本批监听；空条目集返回安全空函数——装载前 entries 全
 *          default 的空闲形态）
 */
export function registerWindowKeybindingShortcuts(
  entries: readonly MenuShortcutEntry[],
  run: WindowCommandRunner,
): () => void {
  // 解析合并产物：仅窗口域 custom 条目进入注册（默认组合归既有窗口快捷键服务）
  const bindings: Array<{ pmKey: string; commandId: string }> = [];
  for (const entry of entries) {
    if (entry.domain !== "window" || entry.source !== "custom") continue;
    // 映射表外命令：catalog 扩展先于执行映射落地的过渡形态，告警跳过不崩溃
    if (WINDOW_KEYBINDING_COMMANDS[entry.commandId] === undefined) {
      console.warn(`[MarkWell] 忽略不可执行的窗口快捷键命令: ${entry.commandId}（映射表外）`);
      continue;
    }
    // 解析组合串：非法 / 窗口保留组合（含全部窗口域默认组合）均 undefined——
    // 保留组合由既有服务注册，动态注册会造成同键双重执行（M-1② 同源防线）
    const pmKey = parseShortcutCombo(entry.combo);
    if (pmKey === undefined) {
      console.warn(`[MarkWell] 忽略非法窗口快捷键组合: ${entry.commandId} = "${entry.combo}"`);
      continue;
    }
    bindings.push({ pmKey, commandId: entry.commandId });
  }
  if (bindings.length === 0) return () => undefined;
  const onKeydown = (event: KeyboardEvent): void => {
    // 编辑器 keymap / 前置监听已消费的按键不重复触发（TASK 10#3 同款守卫）
    if (event.defaultPrevented) return;
    for (const binding of bindings) {
      if (!matchesShortcutEvent(event, binding.pmKey)) continue;
      // 拦截默认行为统一走命令函数（与 window-shortcuts 同口径），命中即短路
      event.preventDefault();
      run(binding.commandId);
      return;
    }
  };
  window.addEventListener("keydown", onKeydown);
  return () => window.removeEventListener("keydown", onKeydown);
}
