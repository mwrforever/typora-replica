// 草稿备份与恢复（02 文档管理，F31；Task 14 04 聚合改造）
//
// 机制（已锁定）：① 心跳备份——订阅 markdownUpdated，编辑后 5s 写草稿，
// 独立于自动保存开关（崩溃/异常退出可找回，与 Typora 后台草稿机制对齐）；
// ② 退出备份——正常退出时若仍有未保存内容再补一次（用户实测：正常退出也
// 留备份，AC-F31-4）；恢复入口为偏好面板按钮（10/12 装配 UI，本模块提供
// listRecoverable/recover 命令层）；不自动弹恢复提示。
// 命名：有路径用文件名；未命名文档用首标题/首句（extractDraftName）。
// 04 聚合（D1 裁决落地）：构造注入「脏标签快照提供器」而非单一会话——心跳/
// 退出备份遍历全部脏标签逐个写草稿；脏过滤与 per-tab 序列化由装配方提供器
// 负责（App.vue 聚合 tabs.store 脏标签），本模块不感知标签/会话细节。
import { listDrafts, recoverDraft, saveDraft } from "../../services/file-io";
import type { DraftEntry } from "../../services/file-io";

/** 心跳间隔：编辑后 5s 写草稿（崩溃窗口 ≤ 5s + 事件防抖 500ms） */
export const HEARTBEAT_MS = 5000;

/** 脏标签快照（04 多标签聚合：心跳/退出备份遍历全部脏标签） */
export interface DirtyTabSnapshot {
  /** 文件路径（未命名文档缺省，用首标题/首句命名） */
  path?: string;
  /** 序列化内容（per-tab 序列化器产出，含 FM 回写） */
  content: string;
}

/**
 * 草稿命名提取：首标题（# 开头）→ 首非空行 → 清洗非法字符 + 截 30 字符
 * @param md 编辑器正文
 * @returns 草稿文件名主体（Rust 侧再加日期前缀与 .md）
 */
export function extractDraftName(md: string): string {
  const firstLine = md.split(/\r?\n/).find((line) => line.trim().length > 0);
  if (!firstLine) return "未命名";
  const heading = /^#{1,6}\s+(.+)$/.exec(firstLine.trim());
  const base = heading ? heading[1] : firstLine.trim();
  const cleaned = base.replace(/[\\/:*?"<>|]/g, "_").trim();
  const truncated = Array.from(cleaned).slice(0, 30).join("");
  // 注：原实现为 truncated || "未命名"（用户裁定删除）——该回落分支不可达：
  // firstLine 经 trim 后标题捕获组必含非空白字符，truncated 永不为空；行为不变
  return truncated;
}

/** 草稿恢复服务（App.vue 装配 start/setupExitBackup） */
export class DraftRecovery {
  /** 心跳防抖定时器 */
  private heartbeatTimer: ReturnType<typeof setTimeout> | undefined;
  /** markdownUpdated 取消订阅 */
  private unsubscribe: (() => void) | undefined;
  /** 退出备份已挂载标记（幂等） */
  private exitBackupSetup = false;

  /**
   * 构造注入脏标签快照提供器（02 单文档：单元素；04 多标签：全部脏标签）。
   * 提供器为惰性函数：备份执行时点才取快照，避免持有过期引用。
   * @param snapshots 返回全部脏标签快照的提供器（空数组 = 无脏标签跳过）
   */
  constructor(private snapshots: () => DirtyTabSnapshot[]) {}

  /**
   * 启动心跳备份：markdownUpdated → 5s 防抖 → backupIfNeeded
   * @param subscribeMarkdown 事件订阅注入（editorManager.subscribeMarkdownUpdated）
   */
  start(subscribeMarkdown: (cb: (md: string) => void) => () => void): void {
    this.stop();
    this.unsubscribe = subscribeMarkdown(() => {
      if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer);
      this.heartbeatTimer = setTimeout(() => void this.backupIfNeeded(), HEARTBEAT_MS);
    });
  }

  /** 停止心跳与备份（组件卸载） */
  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    if (this.heartbeatTimer) {
      clearTimeout(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
  }

  /**
   * 挂载退出备份：正常退出时（含未命名文档）补写草稿
   * @param onClose 关闭事件注册（Tauri onCloseRequested 注入；测试传假注册器）
   */
  setupExitBackup(onClose: (handler: () => Promise<void>) => void): void {
    if (this.exitBackupSetup) return;
    this.exitBackupSetup = true;
    onClose(() => this.backupIfNeeded());
  }

  /**
   * 备份全部脏标签（心跳与退出共用入口）：逐快照写草稿——
   * 有路径用文件名，否则首标题/首句；空内容不产生草稿（AC-F31-5）；
   * 单标签写失败静默降级不阻断其余（不打断编辑；写盘错误由 save 链路提示）。
   */
  async backupIfNeeded(): Promise<void> {
    for (const snapshot of this.snapshots()) {
      // 全空白文档不备份（AC-F31-5）
      if (snapshot.content.trim() === "") continue;
      const name = snapshot.path ? basenameOf(snapshot.path) : extractDraftName(snapshot.content);
      try {
        await saveDraft(name, snapshot.content);
      } catch {
        // 草稿写失败静默降级（不打断编辑；写盘错误由 save 链路提示）
      }
    }
  }

  /** 列出可恢复草稿（日期倒序；AC-F31-3 列表数据源） */
  async listRecoverable(): Promise<DraftEntry[]> {
    return listDrafts();
  }

  /** 恢复草稿内容（Rust 侧读后删除；打开动作由调用方 session.openFile 执行） */
  async recover(fileName: string): Promise<string> {
    const result = await recoverDraft(fileName);
    return result.content;
  }
}

/** 取路径文件名（内部工具，与 document-session 同构） */
function basenameOf(path: string): string {
  const idx = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return idx === -1 ? path : path.slice(idx + 1);
}
