// 原生菜单 IPC 封装（12 窗口外壳 W2；B.4.1 IPC 网关——@tauri-apps/api menu 与
// 菜单显隐 invoke 收敛本层，组件/功能域禁止散落直呼）
//
// 架构契约：
// - 菜单内容树（MenuNode）为 JSON 值对象（A.7：跨层只传 JSON 值对象），由
//   features/window-shell/menu-tree 纯函数构建，本层负责转换为 Tauri Menu 并挂载；
// - 菜单项 action 经 Channel 回调回传前端，统一转交 onAction(id)（menuRouter 派发，
//   AC-M-3 单一执行路径）；
// - 菜单项一律不设原生 accelerator（12 spec 菜单栏装配红线：防 OS 层抢键，
//   快捷键文本只拼在 label 中）；
// - autoHideMenuBar 的显隐切换无 JS API（JS Window 无 setMenu/removeMenu），
//   经 Rust 薄命令 set_native_menu_visible 包装 hide_menu/show_menu（A.3 契约）。
// 权限面：core:default 已含 core:menu:default（菜单构建/挂载命令集），无需新增
// core:menu 授权；自定义命令经 capability allow-set-native-menu-visible 显式授予。
import { invoke } from "@tauri-apps/api/core";
import {
  Menu,
  type CheckMenuItemOptions,
  type MenuItemOptions,
  type PredefinedMenuItemOptions,
  type SubmenuOptions,
} from "@tauri-apps/api/menu";
import { getCurrentWindow } from "@tauri-apps/api/window";

/** 可执行菜单项（点击后经 onAction(id) 路由到命令函数） */
export interface MenuItemNode {
  kind: "item";
  /** 全局唯一菜单项 id（action 回调回传标识，与 menuRouter 路由键一致） */
  id: string;
  /** 显示文本（快捷键文本已以 "\t" 合成进 label，AC-M-2） */
  label: string;
  /** 是否可用（false = 置灰禁用态，明确禁用口径见 00 spec §11 总则） */
  enabled: boolean;
}

/** 可勾选菜单项（Themes 主题列表：勾选态 = 当前激活主题） */
export interface MenuCheckItemNode {
  kind: "check-item";
  /** 全局唯一菜单项 id */
  id: string;
  /** 显示文本 */
  label: string;
  /** 是否可用 */
  enabled: boolean;
  /** 勾选态 */
  checked: boolean;
}

/** 子菜单（七菜单顶层与 Export/Open Recent/Themes 嵌套层） */
export interface MenuSubmenuNode {
  kind: "submenu";
  /** 全局唯一子菜单 id */
  id: string;
  /** 显示文本 */
  label: string;
  /** 子项（分隔线/预定义项/嵌套子菜单） */
  items: MenuNode[];
}

/** 原生分隔线 */
export interface MenuSeparatorNode {
  kind: "separator";
}

/** 原生预定义项（剪切/复制/粘贴等 OS/WebView 内建行为，无 id 路由） */
export interface MenuPredefinedNode {
  kind: "predefined";
  /** 预定义项类型（取 Windows 支持面子集） */
  item: "Cut" | "Copy" | "Paste" | "SelectAll";
  /** 显示文本（省略用系统默认文案） */
  label?: string;
}

/** 菜单树节点（JSON 值对象；唯一构建入口为 menu-tree 纯函数） */
export type MenuNode =
  MenuItemNode | MenuCheckItemNode | MenuSubmenuNode | MenuSeparatorNode | MenuPredefinedNode;

/** Tauri 菜单项选项联合（本层内部转换产物，非导出契约） */
type TauriItemOptions = MenuItemOptions | PredefinedMenuItemOptions | SubmenuOptions;

/**
 * 菜单树 → Tauri 菜单项选项树（递归转换；内部函数，经 setWindowMenu 间接测试）
 *
 * 可执行/可勾选项绑定 action 回调（Channel 机制由 @tauri-apps/api 注入）；
 * 分隔线映射 PredefinedMenuItem 的 Separator；预定义项映射同名原生项。
 * @param nodes 菜单树节点列表
 * @param onAction 菜单项点击统一派发回调（id → menuRouter）
 * @returns Tauri 菜单项选项列表（禁含 accelerator——红线恒不设置）
 */
function toMenuOptions(
  nodes: readonly MenuNode[],
  onAction: (id: string) => void,
): TauriItemOptions[] {
  return nodes.map((node) => {
    switch (node.kind) {
      case "item":
        return {
          id: node.id,
          text: node.label,
          enabled: node.enabled,
          action: () => onAction(node.id),
        } satisfies MenuItemOptions;
      case "check-item":
        return {
          id: node.id,
          text: node.label,
          enabled: node.enabled,
          checked: node.checked,
          action: () => onAction(node.id),
        } satisfies CheckMenuItemOptions;
      case "submenu":
        return {
          id: node.id,
          text: node.label,
          items: toMenuOptions(node.items, onAction),
        } satisfies SubmenuOptions;
      case "separator":
        return { item: "Separator" } satisfies PredefinedMenuItemOptions;
      case "predefined":
        return {
          item: node.item,
          ...(node.label !== undefined ? { text: node.label } : {}),
        } satisfies PredefinedMenuItemOptions;
    }
  });
}

/**
 * 构建原生菜单并挂载为当前窗口菜单（全量重建语义：Themes/Open Recent 等动态
 * 子菜单变化时以新树整体替换，旧 Menu 资源由 Tauri 替换语义回收）
 *
 * @param nodes 菜单树（menu-tree 纯函数产物）
 * @param onAction 菜单项点击统一派发回调（AC-M-3：与快捷键同一命令函数入口）
 * @returns 挂载完成的 Menu 实例（返回前一个窗口菜单由 Tauri set 语义决定，本层不持有）
 * @throws Error 菜单构建/挂载 IPC 失败（调用方记录告警；菜单缺失不阻断编辑主链路）
 */
export async function setWindowMenu(
  nodes: readonly MenuNode[],
  onAction: (id: string) => void,
): Promise<Menu> {
  const menu = await Menu.new({ items: toMenuOptions(nodes, onAction) });
  await menu.setAsWindowMenu(getCurrentWindow());
  return menu;
}

/**
 * 设置原生菜单栏可见性（AC-M-5 autoHideMenuBar Alt 切换链路；Rust 薄命令包装
 * hide_menu/show_menu——仅隐藏不销毁菜单资源，再次显示原地恢复）
 * @param visible true = 显示菜单栏；false = 隐藏菜单栏
 * @throws Error Rust 命令 reject（平台调用失败；调用方记录告警不阻断交互）
 */
export async function setNativeMenuVisible(visible: boolean): Promise<void> {
  await invoke("set_native_menu_visible", { visible });
}
