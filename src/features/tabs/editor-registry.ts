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
  inst.autoSave.start();
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
 * stop 幂等（重复调用安全），confirming 不变量「进入确认 ⇒ 已暂停」可重复维持；
 * 副作用披露：markdownUpdated→markDirty 脏桥随订阅一并停——弹窗期编辑暂不置脏，
 * 恢复后下次编辑重新标记（与 02 单一事件源语义一致）。
 */
export function stopAllAutoSave(): void {
  for (const inst of instances.values()) inst.autoSave.stop();
}

/**
 * 恢复激活标签自动保存（12 退出聚合 W6：取消/写盘失败/关窗失败回退路径）。
 * 仅激活标签重启订阅——非激活标签本就不运行（激活切换时 activateInstance 统一起停）。
 */
export function startActiveAutoSave(): void {
  if (adoptedTabId === undefined) return;
  instances.get(adoptedTabId)?.autoSave.start();
}

/** 测试专用：清空注册表（模块级单例，用例间必须隔离） */
export function clearRegistryForTest(): void {
  instances.clear();
  adoptedTabId = undefined;
}
