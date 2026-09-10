// autoHideMenuBar Alt 单按切换状态机（12 窗口外壳 W2；AC-M-5）
//
// 消费既有设置键 AdvancedSettings.autoHideMenuBar（10 域 conf.user.json 高级键，
// settingsStore.advanced——不新增设置通道，调研报告 1.4 定案）：键为 true 才启用
// Alt 单按切换；false 时 Alt 不响应（AC-M-5 前提即此键为 true）。
// 显隐切换 IPC 由装配层注入 services/menu-io 的 setNativeMenuVisible（B.4.1 IPC
// 网关收敛；Rust 薄命令 hide_menu/show_menu 仅隐藏不销毁菜单资源，show 原地恢复）。
// 状态机内部持菜单可见性标记（初始可见=装配后默认挂载），Alt 单键判定：
// key === "Alt" 且无其他修饰键、非 repeat；编辑器已消费的按键不重复处理
//（defaultPrevented 守卫，10#3 同款先例）。
import { ref } from "vue";

/** Alt 切换状态机选项 */
export interface AutoHideMenuOptions {
  /** 是否启用 Alt 切换（settingsStore.advanced?.autoHideMenuBar === true 的实时读法） */
  isEnabled: () => boolean;
  /** 显隐切换 IPC（装配层传 services/menu-io 的 setNativeMenuVisible） */
  setMenuVisible: (visible: boolean) => Promise<void>;
}

/** Alt 切换状态机句柄 */
export interface AutoHideMenuHandle {
  /** 当前菜单可见性标记（内部状态镜像；仅测试/调试消费） */
  visible: () => boolean;
  /**
   * 外部状态机驱动的显隐应用（12 W3 全屏联动消费：进入全屏隐藏/退出恢复）。
   * 与 Alt 单按共用同一可见性标记与 IPC 通道——全屏期间 Alt 唤出菜单仍可用，
   * 两路径基于同一真值取反，互不抢状态；失败回滚语义同 Alt 路径
   */
  applyVisible: (next: boolean) => void;
  /** 移除 window keydown 监听（App 卸载调用；幂等） */
  cleanup: () => void;
}

/**
 * 启用 Alt 单按切换状态机（App 装配层调用一次；窗口级 keydown 监听）
 *
 * 边界条件：
 * -isEnabled() 为 false：Alt 不响应（设置键未开启）；
 * - Alt+组合键（带 Ctrl/Shift/Meta）、长按 repeat、已消费事件：一律忽略；
 * - IPC 失败：告警收敛，可见性标记回滚（下次 Alt 仍按当前标记取反）。
 *
 * @param options 启用判定与 IPC 注入
 * @returns 状态机句柄（visible/cleanup）
 */
export function useAutoHideMenu(options: AutoHideMenuOptions): AutoHideMenuHandle {
  const setMenuVisible = options.setMenuVisible;
  /** 菜单可见性标记（初始可见：原生菜单装配后默认挂载显示） */
  const visible = ref(true);

  /**
   * 显隐应用共步（Alt 切换与全屏联动共用）：先落标记再发 IPC，快速连按按最终态
   * 收敛；IPC 失败回滚标记，保证下一轮取反基于真实可见性
   */
  const applyVisible = (next: boolean): void => {
    const prev = visible.value;
    visible.value = next;
    setMenuVisible(next).catch((e: unknown) => {
      visible.value = prev;
      console.error("[MarkWell] 菜单栏显隐切换失败（autoHideMenuBar）", e);
    });
  };

  const onKeydown = (event: KeyboardEvent): void => {
    // 编辑器/其他窗口级服务已消费的按键不重复处理（prosemirror-view 命中仅
    // preventDefault 不阻断传播，事件仍冒泡到 window）
    if (event.defaultPrevented) return;
    // 设置键未开启：Alt 不响应（AC-M-5「开启 autoHideMenuBar」前提）
    if (!options.isEnabled()) return;
    // 仅 Alt 单键命中：其他修饰键组合 / 长按 repeat 一律放行
    if (event.key !== "Alt") return;
    if (event.ctrlKey || event.shiftKey || event.metaKey || event.repeat) return;
    event.preventDefault();
    applyVisible(!visible.value);
  };

  window.addEventListener("keydown", onKeydown);
  return {
    visible: () => visible.value,
    applyVisible,
    cleanup: () => window.removeEventListener("keydown", onKeydown),
  };
}
