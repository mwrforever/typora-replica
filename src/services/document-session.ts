// 文档会话（02 文档管理核心）
//
// 单一职责：文档状态机（路径/目录/脏状态）+ 打开/保存/另存文件链路。
// 不持有编辑器实例：正文经 editorManager.getMarkdown() 序列化（01 契约，
// 已剥全部尾随换行），落盘前补尾换行 + 行尾归一（line-ending 收口）。
// 目录（currentDir）同时服务 F1（父目录加载）与 03 侧栏；lastFile/lastFolder
// 随打开/另存/换目录写入偏好（F14 启动恢复数据源）。
import { FileIoError, readFile, writeFile } from "./file-io";
import { toDiskContent } from "./line-ending";
import { loadSettings, updateSettings } from "./settings";
import { RecentFiles } from "./recent-files";
import { editorManager } from "./editor-manager";

/** 会话内文档描述（广播给 UI 层重新装配编辑器） */
export interface SessionDoc {
  /** 文档正文（原始文件内容，FM 由编辑器工厂剥离） */
  content: string;
  /** 文件路径（未命名文档为空） */
  path?: string;
  /** 显示名（未命名文档为「未命名」） */
  name: string;
}

/** 保存结果（dirty 联动依据） */
export type SaveOutcome =
  | { saved: true; path: string }
  | { saved: false; reason: "no-path" | "io-error" | "doc-switched"; message: string };

/** 会话事件监听集合 */
export interface SessionListeners {
  /** 文档切换（打开/新建/另存后广播，UI 据此重建编辑器） */
  onDocumentChange?: (doc: SessionDoc) => void;
  /** 脏状态变化（联动 C2 标题栏/标签页） */
  onDirtyChange?: (dirty: boolean) => void;
  /** 用户可见提示（错误/信息） */
  onNotice?: (notice: { level: "error" | "info"; message: string }) => void;
}

/** 文档会话（单例由 App.vue 持有） */
export class DocumentSession {
  /** 当前文件路径（未命名文档为空） */
  currentPath?: string;
  /** 当前目录（侧栏数据源；打开文件时=父目录） */
  currentDir?: string;
  /** 脏状态：内容未落盘为 true */
  dirty = false;
  /** 文档版本号（每次文档切换 +1，UI 层用作重建 key） */
  docVersion = 0;
  /** 编辑纪元（每次 markDirty 递增；save 写盘完成后据此守卫 markSaved 竞态） */
  private editEpoch = 0;
  /** 当前事件监听（最后一次 on() 覆盖） */
  private listeners: SessionListeners = {};

  /** 注册事件监听（App.vue 装配时调用一次） */
  on(listeners: SessionListeners): void {
    this.listeners = listeners;
  }

  /** 广播提示（供 App/服务层上报用户可见消息） */
  notify(notice: { level: "error" | "info"; message: string }): void {
    this.listeners.onNotice?.(notice);
  }

  /**
   * 打开文件：读取 → 登记路径/目录 → 广播文档变更
   * @param path 文件完整路径
   */
  async openFile(path: string): Promise<void> {
    try {
      const result = await readFile(path);
      this.currentPath = path;
      // F1-2：打开单文件时父目录自动加载为侧栏目录
      this.currentDir = dirnameOf(path);
      this.dirty = false;
      this.docVersion += 1;
      this.listeners.onDocumentChange?.({
        content: result.content,
        path,
        name: basenameOf(path),
      });
      // 启动恢复数据源（F14-2 恢复上次文件与文件夹）；await 自身写回，
      // 使启动期连续 openFolder/openFile 的偏好写回串行（F 修复：防读改写交错覆盖）
      await updateSettings({
        launch: { lastFile: path, lastFolder: this.currentDir },
      }).catch(() => undefined);
      // 最近文件记录（AC-F13-1：打开文件进入列表首位）
      recordRecent(path);
    } catch (error) {
      const message = error instanceof FileIoError ? error.message : "打开文件失败";
      this.notify({ level: "error", message });
    }
  }

  /**
   * 打开文件夹（侧栏当前目录切换；F1-1/4）
   * @param path 文件夹路径
   */
  async openFolder(path: string): Promise<void> {
    this.currentDir = path;
    void updateSettings({ launch: { lastFolder: path } }).catch(() => undefined);
    // 最近文件记录（F13 语义：文件夹同样入列表）
    recordRecent(path);
  }

  /** 新建未命名文档（复位路径/脏状态并广播） */
  newDocument(): void {
    this.currentPath = undefined;
    this.dirty = false;
    this.docVersion += 1;
    this.listeners.onDocumentChange?.({ content: "", name: "未命名" });
  }

  /** 标记脏（markdownUpdated 到达时由 auto-save 调用；幂等广播） */
  markDirty(): void {
    // 每次编辑递增纪元：save 写盘期间的新编辑以此识别（C 竞态守卫）
    this.editEpoch += 1;
    if (!this.dirty) {
      this.dirty = true;
      this.listeners.onDirtyChange?.(true);
    }
  }

  /** 标记已保存（dirty 清除广播；save 成功内部已调用，外部勿重复） */
  markSaved(): void {
    if (this.dirty) {
      this.dirty = false;
      this.listeners.onDirtyChange?.(false);
    }
  }

  /**
   * 保存当前文档（未命名文档返回 no-path 不写盘）
   * 成功：dirty 清除（AC-F30-4）；失败：dirty 保持 + 广播错误（AC-F30-5）
   * 竞态守卫：保存期间文档切换则放弃写盘（B），写盘期间新编辑不清脏（C）
   */
  async save(): Promise<SaveOutcome> {
    if (!this.currentPath) {
      return { saved: false, reason: "no-path", message: "未命名文档无法写盘，请使用另存为" };
    }
    // B 修复：快照保存目标与文档版本——await 期间文档可能被打开/新建/另存切换
    const pathSnapshot = this.currentPath;
    const versionSnapshot = this.docVersion;
    // C 修复：快照编辑纪元——写盘期间的新编辑（markDirty 递增）不得被误标已保存
    const epochSnapshot = this.editEpoch;
    // 偏好读取失败按默认 LF 回落（读设置失败不阻断保存链路）
    const settings = await loadSettings().catch(() => undefined);
    // B 修复：await 后校验文档未切换，否则放弃写盘（防止内容落错文件）
    if (this.currentPath !== pathSnapshot || this.docVersion !== versionSnapshot) {
      const message = "保存期间文档已切换，本次写入已放弃";
      this.notify({ level: "info", message });
      return { saved: false, reason: "doc-switched", message };
    }
    const lineEnding = settings?.defaultLineEnding ?? "lf";
    const body = editorManager.getMarkdown();
    const disk = toDiskContent(body, lineEnding);
    try {
      await writeFile(pathSnapshot, disk, lineEnding);
      // C 修复：写盘期间无新编辑（纪元未变）才清脏——未落盘内容保留脏标记
      if (this.editEpoch === epochSnapshot) this.markSaved();
      return { saved: true, path: pathSnapshot };
    } catch (error) {
      const message = error instanceof FileIoError ? error.message : "写盘失败";
      this.notify({ level: "error", message });
      return { saved: false, reason: "io-error", message };
    }
  }

  /**
   * 另存为：登记新路径后保存（同时刷新目录为父目录）
   * @param path 目标路径（来自另存对话框）
   */
  async saveAs(path: string): Promise<SaveOutcome> {
    this.currentPath = path;
    this.currentDir = dirnameOf(path);
    void updateSettings({
      launch: { lastFile: path, lastFolder: this.currentDir },
    }).catch(() => undefined);
    const out = await this.save();
    // 另存成功才记录最近文件（写盘失败不污染最近列表，AC-F13-1 链路）
    if (out.saved) recordRecent(path);
    return out;
  }
}

/** 取路径父目录（末尾分隔符去除；无分隔符返回 undefined 语义的路径） */
function dirnameOf(path: string): string | undefined {
  const idx = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return idx === -1 ? undefined : path.slice(0, idx);
}

/** 取路径文件名 */
function basenameOf(path: string): string {
  const idx = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return idx === -1 ? path : path.slice(idx + 1);
}

/**
 * 记录最近打开（fire-and-forget：失败静默，与 updateSettings 持久化同构——
 * 最近列表写入失败不得阻断打开/保存链路）
 * @param path 打开/保存成功的文件或文件夹完整路径
 */
function recordRecent(path: string): void {
  void new RecentFiles().record(path).catch(() => undefined);
}
