// 自动保存（02 文档管理，F30）
//
// 双条件（已锁定）：停笔防抖 ~1s ∪ 定时兜底 autoSaveTimer（默认 5 分钟）。
// 数据流：subscribeMarkdownUpdated（全链路 500ms 防抖）→ markDirty +
// 重置 1s 停笔定时器 → 到期 session.save()（getMarkdown O(n) 只在防抖窗口
// 末端执行一次，满足 spec §3 性能）；定时器每次保存后重置。
// 开关关闭（偏好 autoSave.enabled=false）：不响应防抖与定时，仅手动 Ctrl+S。
import type { DocumentSession } from "./document-session";
import type { loadSettings } from "./settings";

/** 停笔防抖时长（约 1s，spec 语义） */
export const IDLE_DEBOUNCE_MS = 1000;

/** 自动保存控制器依赖（测试注入点） */
export interface AutoSaveDeps {
  /** 文档会话（save/markDirty） */
  session: DocumentSession;
  /** 偏好读取（每次触发实时读取，支持运行期改开关） */
  getSettings: typeof loadSettings;
  /** markdownUpdated 订阅（editorManager.subscribeMarkdownUpdated） */
  subscribeMarkdown: (cb: (md: string) => void) => () => void;
}

/** 自动保存控制器（App.vue 装配 start/stop） */
export class AutoSaveController {
  /** 停笔防抖定时器 */
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  /** 定时兜底定时器 */
  private timer: ReturnType<typeof setTimeout> | undefined;
  /** 取消订阅函数 */
  private unsubscribe: (() => void) | undefined;
  /** 停止标记（stop 后所有回调短路） */
  private stopped = false;

  constructor(private deps: AutoSaveDeps) {}

  /** 启动：订阅 markdownUpdated + 启动 5 分钟定时兜底 */
  start(): void {
    this.stopped = false;
    this.unsubscribe = this.deps.subscribeMarkdown(() => this.onMarkdownUpdated());
    void this.refreshTimer();
  }

  /** 停止：退订 + 清理全部定时器（组件卸载/应用退出） */
  stop(): void {
    this.stopped = true;
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.clearIdle();
    this.clearTimer();
  }

  /** markdownUpdated 到达：标记脏 + 重置停笔防抖 */
  private onMarkdownUpdated(): void {
    if (this.stopped) return;
    this.deps.session.markDirty();
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => void this.saveIfPossible(), IDLE_DEBOUNCE_MS);
  }

  /** 防抖/定时到期统一入口：开关关闭时跳过（AC-F30-3）；干净文档不写盘（A 修复） */
  private async saveIfPossible(): Promise<void> {
    if (this.stopped) return;
    const settings = await this.deps.getSettings().catch(() => undefined);
    if (!settings?.autoSave.enabled) return;
    // A 修复：定时兜底仅服务编辑场景（spec AC-F30-2 触发条件），
    // 无编辑（dirty=false）不写盘——避免 5 分钟重写改写行尾/编码/尾换行
    if (!this.deps.session.dirty) return;
    this.clearIdle();
    await this.deps.session.save();
    // 写盘后重置定时兜底（无论成败，避免连续失败轰炸）
    void this.refreshTimer();
  }

  /** 重置 5 分钟定时兜底（开关关闭不启动） */
  private async refreshTimer(): Promise<void> {
    if (this.stopped) return;
    this.clearTimer();
    const settings = await this.deps.getSettings().catch(() => undefined);
    if (!settings?.autoSave.enabled) return;
    this.timer = setTimeout(
      () => void this.saveIfPossible(),
      Math.max(1, settings.autoSave.timerMinutes) * 60_000,
    );
  }

  private clearIdle(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = undefined;
    }
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }
}
