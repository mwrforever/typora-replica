// keyBinding 装配服务（10 C1）
//
// 职责：①启动注入编排——解析（T9）→ 同键去重（01 注册表无注销机制，注入前收敛，
// 后配置覆盖先配置）→ bindMenuShortcut 注入（priority 300 自定义优先，AC-C1-3）；
// 非法组合 / 目录外命令 console.warn 忽略（AC-C1-4 不崩溃）；
// ②菜单展示数据接口——默认表 + keyBinding 覆盖合并，12 菜单装配消费（AC-C1-1 接口级验收，
// 披露 1：菜单渲染与窗口域命令执行归 12）。
import { bindMenuShortcut } from "../editor/keymaps";
import { parseShortcutCombo } from "./shortcut-keys";
import { SHORTCUT_COMMANDS } from "./shortcut-catalog";

/** 菜单快捷键展示条目（12 菜单装配消费；label 拼接 "命令名\tCtrl+B" 形态归 12） */
export interface MenuShortcutEntry {
  /** 菜单命令名（conf.user.json keyBinding 的键） */
  commandId: string;
  /** 菜单显示名（中文） */
  label: string;
  /** 命令域（editor = 01 注入生效；window = 12 消费） */
  domain: "editor" | "window";
  /** 展示用组合串；未绑定 = 空串（12 侧不渲染快捷键段） */
  combo: string;
  /** 绑定来源 */
  source: "default" | "custom";
}

/**
 * 启动注入 keyBinding（App.vue 启动链路调用一次；必须在首标签编辑器 create() 之前）
 * @param keyBinding conf.user.json keyBinding 映射（未配置传空对象）
 */
export function applyKeyBindings(keyBinding: Record<string, string>): void {
  // 同键去重：同一 ProseMirror 键只保留最后配置的命令（registry push 后无注销）
  const resolved = new Map<string, string>();
  for (const [commandId, combo] of Object.entries(keyBinding)) {
    const pmKey = parseShortcutCombo(combo);
    if (pmKey === undefined) {
      // AC-C1-4：非法组合告警忽略，不崩溃
      console.warn(`[MarkWell] 忽略非法快捷键配置: ${commandId} = "${combo}"`);
      continue;
    }
    resolved.set(pmKey, commandId);
  }
  for (const [pmKey, commandId] of resolved) {
    // 目录外命令（含窗口域）：告警忽略，执行接线归 12（披露 1）
    if (!bindMenuShortcut(commandId, pmKey)) {
      console.warn(
        `[MarkWell] 忽略不可绑定的快捷键命令: ${commandId}（目录外命令，12 模块接入后生效）`,
      );
    }
  }
}

/**
 * 构建菜单快捷键展示数据（每次调用实时重算；默认表 + keyBinding 覆盖合并）
 * @param keyBinding conf.user.json keyBinding 映射（未配置传空对象）
 * @returns 条目序 = 目录声明序
 */
export function getMenuShortcutEntries(keyBinding: Record<string, string>): MenuShortcutEntry[] {
  return SHORTCUT_COMMANDS.map((def) => {
    const custom = keyBinding[def.commandId];
    return {
      commandId: def.commandId,
      label: def.label,
      domain: def.domain,
      combo: custom ?? def.defaultCombo ?? "",
      source: custom !== undefined ? "custom" : "default",
    };
  });
}
