// Focus/Typewriter 视图模式控制器（12 窗口外壳 W5；AC-M-10~12 应用侧状态机）
//
// 职责：两模式的期望态单一事实源 + 编辑器实例配置对账——F8/F9 与菜单共用同一
// toggle（AC-M-3 单一执行路径）；点击居中偏好（10 设置面板）经 setter 注入。
// 多标签下每实例插件状态独立，控制器负责把期望态同步到「当前活跃实例」：
// 订阅 01 selectionUpdated 即时事件（含 adopt 快照广播 = 标签切换信号），
// 微任务对账补齐（禁止在 PM 事务处理周期内同步 dispatch 重入，故经调度器解耦）。
//
// 形态：createViewModes 依赖全注入纯核心（核心 100% 单测）；真实依赖装配于
// useViewModes() 模块级单例（App.vue / SourceModeLayer / use-native-menu 各取
// 同实例——菜单勾选态、快捷键、源码层叠加共用同一状态源）。
import { ref, watch } from "vue";
import type { Ref } from "vue";
import type { Editor } from "@milkdown/kit/core";
import {
  getFocusTypewriterConfig,
  setFocusTypewriterConfig,
} from "../editor/focus-typewriter-plugin";
import type { FocusTypewriterConfig } from "../editor/focus-typewriter-plugin";
import { editorManager } from "../editor/editor-manager";
import { useSettingsStore } from "../settings/settings-store";

/** 视图模式配置（与 01 插件配置同形；本层为期望态，插件状态为实例实际态） */
export type ViewModesSnapshot = FocusTypewriterConfig;

/** 控制器依赖（01 门面/插件门面的薄回调；Editor 仅在回调边界内透传） */
export interface ViewModesDeps {
  /** 当前活跃编辑器实例（未创建 undefined——开关仍翻转，实例出现后补齐） */
  getEditor: () => Editor | undefined;
  /** 读实例当前配置（未就绪返回 undefined → 对账判定为需补齐） */
  readConfig: (editor: Editor) => ViewModesSnapshot | undefined;
  /** 写实例配置补丁（实例内部吞未就绪异常，控制器不重复防御） */
  writeConfig: (editor: Editor, patch: Partial<ViewModesSnapshot>) => void;
  /** 微任务调度器（注入便于测试冲刷；生产为 queueMicrotask） */
  schedule: (callback: () => void) => void;
}

/** 控制器能力面（toggle 返回翻转后的新状态；ref 供菜单勾选态/源码层消费） */
export interface ViewModesController {
  /** Focus 模式期望态（F8） */
  readonly focusEnabled: Ref<boolean>;
  /** Typewriter 模式期望态（F9） */
  readonly typewriterEnabled: Ref<boolean>;
  /** 双向切换 Focus（F8/菜单「专注模式」共用入口）；返回翻转后的状态 */
  toggleFocus(): boolean;
  /** 双向切换 Typewriter（F9/菜单「打字机模式」共用入口）；返回翻转后的状态 */
  toggleTypewriter(): boolean;
  /** 更新点击居中偏好（10 设置面板即时生效通道）；同值幂等不派发 */
  setClickCenter(value: boolean): void;
  /** 当前期望态快照（对账基准；测试与同步内部消费） */
  desiredConfig(): ViewModesSnapshot;
  /** selectionUpdated 事件入口：调度一次微任务对账（窗口内多次事件合并） */
  onSelectionChanged(): void;
}

/**
 * 创建视图模式控制器（依赖注入纯核心）
 * @param deps 编辑器侧依赖（01 插件门面薄回调）
 */
export function createViewModes(deps: ViewModesDeps): ViewModesController {
  const focusEnabled = ref(false);
  const typewriterEnabled = ref(false);
  const clickCenter = ref(true);
  /** 对账去重标记：调度窗口内多次选区事件合并为一次同步 */
  let syncQueued = false;

  const desiredConfig = (): ViewModesSnapshot => ({
    focusEnabled: focusEnabled.value,
    typewriterEnabled: typewriterEnabled.value,
    typewriterClickCenter: clickCenter.value,
  });

  /** 向当前活跃实例派发配置（未创建时跳过——期望态保留，实例出现后对账补齐） */
  const applyToActive = (patch: Partial<ViewModesSnapshot>): void => {
    const editor = deps.getEditor();
    if (editor === undefined) return;
    deps.writeConfig(editor, patch);
  };

  /** 对账：活跃实例配置与期望态不一致（含新实例无配置）时整份补齐 */
  const syncIfStale = (): void => {
    syncQueued = false;
    const editor = deps.getEditor();
    if (editor === undefined) return;
    const desired = desiredConfig();
    const current = deps.readConfig(editor);
    if (
      current !== undefined &&
      current.focusEnabled === desired.focusEnabled &&
      current.typewriterEnabled === desired.typewriterEnabled &&
      current.typewriterClickCenter === desired.typewriterClickCenter
    ) {
      return;
    }
    deps.writeConfig(editor, desired);
  };

  return {
    focusEnabled,
    typewriterEnabled,
    toggleFocus: () => {
      focusEnabled.value = !focusEnabled.value;
      applyToActive({ focusEnabled: focusEnabled.value });
      return focusEnabled.value;
    },
    toggleTypewriter: () => {
      typewriterEnabled.value = !typewriterEnabled.value;
      applyToActive({ typewriterEnabled: typewriterEnabled.value });
      return typewriterEnabled.value;
    },
    setClickCenter: (value) => {
      if (clickCenter.value === value) return;
      clickCenter.value = value;
      applyToActive({ typewriterClickCenter: value });
    },
    desiredConfig,
    onSelectionChanged: () => {
      // selectionUpdated 即时事件可能处于 PM 事务处理周期内，dispatch 禁止同步重入；
      // 经微任务解耦（事务周期结束后执行），并合并窗口内重复事件
      if (syncQueued) return;
      syncQueued = true;
      deps.schedule(syncIfStale);
    },
  };
}

/** 单例装配句柄（含响应式状态；App 生命周期单例，无运行期注销入口） */
export type UseViewModesReturn = ViewModesController;

/** 模块级单例（与 useSourceMode 同形态：多处调用同一实例） */
let singleton: UseViewModesReturn | undefined;

/**
 * 视图模式控制器单例装配（真实依赖接线；首调创建，后续复用）
 *
 * 装配内容：selectionUpdated 订阅（标签切换 adopt 快照广播亦经此触发对账）+
 * 10 设置面板点击居中偏好 watch（immediate 覆盖装载晚于开关的场景）。
 * 订阅随 App 生命周期存活（与 useSourceMode 同口径，不设注销入口）。
 */
export function useViewModes(): UseViewModesReturn {
  if (singleton) return singleton;
  const controller = createViewModes({
    getEditor: () => editorManager.getEditor(),
    readConfig: getFocusTypewriterConfig,
    writeConfig: setFocusTypewriterConfig,
    // 微任务调度：事务周期结束后的安全 dispatch 窗口
    schedule: (callback) => {
      queueMicrotask(callback);
    },
  });
  // 即时选区事件驱动对账（Focus 当前块跟随 / Typewriter 居中由插件承担，
  // 本订阅仅为「配置对账」信号：标签切换 / 实例重建后的最终一致）
  editorManager.subscribeSelectionUpdated(() => controller.onSelectionChanged());
  // 点击居中偏好（10 设置面板 Appearance 分区）即时生效（AC-M-12 偏好开关）；
  // merged 未装载窗口期回落 DEFAULT_SETTINGS，immediate 覆盖「先开关后装载」时序。
  // watch 随首调组件作用域存活（App 装配期调用，应用生命周期单例——useSourceMode
  // 标签联动 watch 同口径），不设显式注销
  const settings = useSettingsStore();
  watch(
    () => settings.merged.appearance.typewriterClickCenter,
    (value) => controller.setClickCenter(value ?? true),
    { immediate: true },
  );
  return (singleton = controller);
}

/** 测试专用：重置单例（模块级状态，用例间必须隔离） */
export function resetViewModesForTest(): void {
  singleton = undefined;
}
