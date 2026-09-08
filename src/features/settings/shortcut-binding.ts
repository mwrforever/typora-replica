// keyBinding 装配服务（10 C1）
//
// 职责：①启动注入编排——解析（T9）→ 同键去重（01 注册表无注销机制，注入前收敛，
// 后配置覆盖先配置）→ bindMenuShortcut 注入（priority 300 自定义优先，AC-C1-3）；
// 非法组合 / 目录外命令 console.warn 忽略（AC-C1-4 不崩溃）；
// ②菜单展示数据接口——默认表 + keyBinding 覆盖合并，12 菜单装配消费（AC-C1-1 接口级验收，
// 披露 1：菜单渲染与窗口域命令执行归 12）。
import { bindMenuShortcut } from "../editor/keymaps";
import { isWindowReservedCombo, parseShortcutCombo } from "./shortcut-keys";
import { SHORTCUT_COMMANDS } from "./shortcut-catalog";

/** 本进程已成功注入注册表的 ProseMirror 键（applyKeyBindings 跨调用幂等收敛的依据） */
const appliedPmKeys = new Set<string>();

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
    // 窗口保留组合先行区分告警（parseShortcutCombo 对其返回 undefined，仅凭返回值
    // 无法区分「语法非法」与「窗口冲突」，冲突组合必须向用户说明原因——M-1②）
    if (isWindowReservedCombo(combo)) {
      console.warn(
        `[MarkWell] 忽略与窗口快捷键冲突的组合: ${commandId} = "${combo}"` +
          "（该组合由窗口层消费，为避免双重执行编辑器命令不可绑定）",
      );
      continue;
    }
    const pmKey = parseShortcutCombo(combo);
    if (pmKey === undefined) {
      // AC-C1-4：非法组合告警忽略，不崩溃
      console.warn(`[MarkWell] 忽略非法快捷键配置: ${commandId} = "${combo}"`);
      continue;
    }
    const previous = resolved.get(pmKey);
    if (previous !== undefined) {
      // 同键多命令：registry push 后无注销仅保留最后配置，被淘汰的先配置命令必须
      // 可诊断（此前为静默丢弃，用户配置丢失无任何线索——code-review Low-5）
      console.warn(
        `[MarkWell] 快捷键 ${pmKey} 被重复绑定，忽略 ${previous}（仅保留后配置的 ${commandId}）`,
      );
    }
    resolved.set(pmKey, commandId);
  }
  for (const [pmKey, commandId] of resolved) {
    // 跨调用幂等：装载链路若重放（重复 apply），已注入的键直接跳过——注册表
    // push 后无注销，重复注入会叠加同键条目（启动时序契约用例钉住此收敛）
    if (appliedPmKeys.has(pmKey)) continue;
    // 目录外命令（含窗口域）：告警忽略，执行接线归 12（披露 1）
    if (!bindMenuShortcut(commandId, pmKey)) {
      console.warn(
        `[MarkWell] 忽略不可绑定的快捷键命令: ${commandId}（目录外命令，12 模块接入后生效）`,
      );
      continue;
    }
    // 仅成功注入的键进入幂等集合（未绑定成功的键不阻断后续调用的重新尝试）
    appliedPmKeys.add(pmKey);
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
