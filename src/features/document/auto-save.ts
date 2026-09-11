// 自动保存（02 文档管理，F30）
//
// 双条件（已锁定）：停笔防抖 ~1s ∪ 定时兜底 autoSaveTimer（默认 5 分钟）。
// 数据流：subscribeMarkdownUpdated（全链路 500ms 防抖）→ markDirty +
// 重置 1s 停笔定时器 → 到期 session.save()（getMarkdown O(n) 只在防抖窗口
// 末端执行一次，满足 spec §3 性能）；定时器每次保存后重置。
// 开关关闭（偏好 autoSave.enabled=false）：不响应防抖与定时，仅手动 Ctrl+S。
//
// 停止双通道（12 W6 修复拆分）：
// - stop 完整停止——退订标脏 + 清全部定时器（激活切换/组件卸载消费）；
// - suspend 仅挂起保存定时器——标脏订阅保持活跃（退出确认弹窗期编辑照常
//   置脏，关窗前复核聚合据此拦截弹窗期新变脏标签，防内容随 destroy 丢失）；
//   resume 只重启定时器，订阅未停则不重订。
import type { DocumentSession } from "./document-session";
import type { loadSettings } from "../../services/settings";

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
  /** 停止标记（stop 后所有回调短路；初始即停止态——未 start 未订阅，
   *  suspend/resume 对未启动控制器的语义与 stop 之后一致） */
  private stopped = true;
  /** 保存暂停态（suspend 置位：标脏订阅活跃，停笔/兜底定时器全部挂起） */
  private suspended = false;
  /** 保存进行中标志（BUG-1：防抖与定时兜底并发触发时 in-flight 守卫） */
  private saveInFlight = false;
  /** 保存期间新请求标记（完成后补跑一次，覆盖保存期间产生的新编辑） */
  private savePending = false;

  constructor(private deps: AutoSaveDeps) {}

  /** 启动：订阅 markdownUpdated + 启动 5 分钟定时兜底（运行中重复调用不重订） */
  start(): void {
    this.stopped = false;
    // 防双订阅：订阅未退订前重复 start 不叠加（否则一次编辑触发两条防抖链）
    if (!this.unsubscribe) {
      this.unsubscribe = this.deps.subscribeMarkdown(() => this.onMarkdownUpdated());
    }
    void this.refreshTimer();
  }

  /**
   * 以暂停态启动（12 退出聚合暂停期的激活切换专用）：仅建立标脏订阅，
   * 保存定时器保持挂起——维持「confirming ⇒ 自动保存已暂停」不变量
   * （暂停期 Ctrl+Tab 切换激活标签，弹窗期编辑仍须置脏且不得写盘）。
   */
  startSuspended(): void {
    this.suspended = true;
    this.start();
  }

  /** 停止：退订 + 清理全部定时器 + 复位暂停态（组件卸载/应用退出/激活切换） */
  stop(): void {
    this.stopped = true;
    this.suspended = false;
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.clearIdle();
    this.clearTimer();
  }

  /**
   * 暂停保存通道（12 退出聚合弹窗期消费）：挂起停笔与定时兜底全部定时器，
   * 标脏订阅保持活跃（编辑照常置脏供复核聚合）；幂等，重复调用安全。
   */
  suspend(): void {
    if (this.stopped) return;
    this.suspended = true;
    this.clearIdle();
    this.clearTimer();
  }

  /**
   * 恢复保存通道（12 退出聚合取消/回退路径消费）：仅重启定时兜底——订阅未停
   * 不重订（防双订阅双写盘）；完全停止态（暂停期激活切换后从未 start）则完整启动。
   */
  resume(): void {
    if (this.stopped) {
      this.start();
      return;
    }
    if (!this.suspended) return;
    this.suspended = false;
    void this.refreshTimer();
  }

  /** markdownUpdated 到达：标记脏 + 重置停笔防抖（暂停期只标脏不启动防抖） */
  private onMarkdownUpdated(): void {
    if (this.stopped) return;
    // 标脏与保存是两条通道：暂停期（退出确认弹窗）编辑仍置脏——弹窗期编辑的
    // 内容去向由关窗前复核聚合兜底（开新一轮确认或随「全部保存」写盘）
    this.deps.session.markDirty();
    if (this.suspended) return;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => void this.saveIfPossible(), IDLE_DEBOUNCE_MS);
  }

  /** 防抖/定时到期统一入口：开关关闭时跳过（AC-F30-3）；干净文档不写盘（A 修复） */
  private async saveIfPossible(): Promise<void> {
    // 暂停期零写盘：兜底定时器已在 suspend 时清除，此处拦截 in-flight 保存完成
    // 后的 savePending 补跑等残余触发（弹窗期写盘禁区）
    if (this.stopped || this.suspended) return;
    const settings = await this.deps.getSettings().catch(() => undefined);
    if (!settings?.autoSave.enabled) return;
    // A 修复：定时兜底仅服务编辑场景（spec AC-F30-2 触发条件），
    // 无编辑（dirty=false）不写盘——避免 5 分钟重写改写行尾/编码/尾换行
    if (!this.deps.session.dirty) return;
    // BUG-1 修复：保存进行中直接让位（标记待补跑）——1s 防抖与 5min 定时并发
    // 触发时防止两次 writeFile 交错，后写覆盖先写的内容（session 侧串行链为第二道防线）
    if (this.saveInFlight) {
      this.savePending = true;
      return;
    }
    this.saveInFlight = true;
    this.clearIdle();
    try {
      await this.deps.session.save();
    } finally {
      this.saveInFlight = false;
      // 写盘后重置定时兜底（无论成败，避免连续失败轰炸）；暂停期由守卫短路
      void this.refreshTimer();
      // 保存期间的新保存请求补跑一次（此时内容已含最新编辑；若保存已清 dirty 则短路）
      if (this.savePending) {
        this.savePending = false;
        void this.saveIfPossible();
      }
    }
  }

  /** 重置 5 分钟定时兜底（开关关闭或保存暂停态不启动） */
  private async refreshTimer(): Promise<void> {
    if (this.stopped || this.suspended) return;
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
