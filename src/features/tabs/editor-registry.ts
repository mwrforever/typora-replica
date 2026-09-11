// 编辑器实例注册表（04 多标签）
//
// 实例不进 Pinia（防 Proxy 化），由本模块级 Map 持有；editorManager 门面恒指向
// 激活标签（锁定接口零改动）；autoSave 仅激活标签运行（订阅门面 markdownUpdated
// 流——后台标签无输入不产事件，多实例全订阅会误标全部 session 脏）。
import type { Crepe } from "@milkdown/crepe";
import type { AutoSaveController } from "../document/auto-save";
import type { DocumentSession } from "../document/document-session";
import { editorManager } from "../editor/editor-manager";

/** 已挂载标签的实例（挂载完成由 TabHost 经 controller.onInstanceReady 登记） */
export interface RegisteredInstance {
  crepe: Crepe;
  frontMatter: string | null;
  session: DocumentSession;
  autoSave: AutoSaveController;
  lastActivatedAt: number;
}

const instances = new Map<string, RegisteredInstance>();
/** 当前已 adopt 进门面的标签 id */
let adoptedTabId: string | undefined;
/**
 * 退出聚合暂停屏蔽位（12 W6）：确认/写盘期间为 true——期间激活切换不得启动
 * 保存定时器（startSuspended 只建标脏订阅），保证「confirming ⇒ 自动保存
 * 已暂停」不变量不被 Ctrl+Tab 轮换/重开标签打破；恢复时统一回运行态。
 */
let autoSaveSuspended = false;

export function registerInstance(tabId: string, inst: RegisteredInstance): void {
  instances.set(tabId, inst);
}

export function unregisterInstance(tabId: string): void {
  if (adoptedTabId === tabId) adoptedTabId = undefined;
  instances.delete(tabId);
}

export function getInstance(tabId: string): RegisteredInstance | undefined {
  return instances.get(tabId);
}

/** 当前激活标签的会话（App.vue 拖入插链接/OpenQuickly/保存快捷键消费） */
export function getActiveSession(): DocumentSession | undefined {
  return adoptedTabId ? instances.get(adoptedTabId)?.session : undefined;
}

/**
 * 当前激活标签的 front matter 内文（07 图片链路消费：typora-root-url /
 * typora-copy-images-to 解析基准；09 导出消费：head 模板变量提取基准；
 * 无激活标签或无 FM 返回 null）
 * 只增不改的补充读取器，与 getActiveSession 同源（adopted 实例表）。
 */
export function getActiveFrontMatter(): string | null {
  return adoptedTabId ? (instances.get(adoptedTabId)?.frontMatter ?? null) : null;
}

/**
 * 激活标签：停旧起新（autoSave 订阅切换）+ adopt 门面
 *
 * 执行序（已锁定）：停旧 autoSave → adopt（事件桥定向解绑旧实例并挂新实例）→
 * 起新 autoSave。重复激活同一标签直接返回（adoptedTabId 守卫，Task 2 ⚠️ 确认必要）。
 */
export function activateInstance(tabId: string): void {
  const inst = instances.get(tabId);
  if (!inst || adoptedTabId === tabId) return;
  if (adoptedTabId) instances.get(adoptedTabId)?.autoSave.stop();
  adoptedTabId = tabId;
  inst.lastActivatedAt = Date.now();
  editorManager.adopt(inst.crepe, inst.frontMatter);
  // 暂停期（退出确认弹窗）激活切换：以暂停态启动——标脏订阅活跃（弹窗期编辑
  // 照常置脏）但保存定时器不跑；非暂停期正常启动
  if (autoSaveSuspended) inst.autoSave.startSuspended();
  else inst.autoSave.start();
}

/** LRU 回收判定：最久未激活（排除指定 id——激活标签必为最近激活，不变量） */
export function recycleLeastRecent(excludeTabId: string): string | undefined {
  let victim: string | undefined;
  let oldest = Infinity;
  for (const [id, inst] of instances) {
    if (id === excludeTabId) continue;
    if (inst.lastActivatedAt < oldest) {
      oldest = inst.lastActivatedAt;
      victim = id;
    }
  }
  return victim;
}

/**
 * 暂停全部标签自动保存（12 退出聚合 W6：确认弹窗期与逐标签写盘期不写盘）。
 * 只挂起保存定时器，标脏订阅保持活跃——弹窗期编辑照常置脏（02 单一事件源
 * 链路不间断），关窗前复核聚合据此拦截弹窗期新变脏标签；幂等，重复调用安全，
 * 「confirming ⇒ 已暂停」不变量可重复维持。
 */
export function suspendAllAutoSave(): void {
  autoSaveSuspended = true;
  for (const inst of instances.values()) inst.autoSave.suspend();
}

/**
 * 恢复激活标签自动保存（12 退出聚合 W6：取消/写盘失败回退/关窗失败路径）。
 * 先解除暂停屏蔽位再恢复——激活标签仅重启保存定时器（订阅未停不重订）；
 * 暂停期经激活切换的新标签处于「已订阅未启动定时器」态，resume 统一切回运行态。
 * 非激活标签本就不运行（激活切换时 activateInstance 统一起停）。
 */
export function resumeActiveAutoSave(): void {
  autoSaveSuspended = false;
  if (adoptedTabId === undefined) return;
  instances.get(adoptedTabId)?.autoSave.resume();
}

/** 测试专用：清空注册表（模块级单例，用例间必须隔离） */
export function clearRegistryForTest(): void {
  instances.clear();
  adoptedTabId = undefined;
  autoSaveSuspended = false;
}
