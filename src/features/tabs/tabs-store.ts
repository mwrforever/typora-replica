// 标签状态机（04 多标签核心簿记）
//
// 单一职责：tabs/activeTabId/closedStack/untitledSeq 的可序列化元数据状态机。
// 不持有编辑器实例（实例在 editor-registry 模块级 Map）；dirty 由 02 写盘事件
// 驱动（单一事件源）；关闭恒存内容快照（D4 裁决：Ctrl+Shift+T 恢复关闭前内容）。
import { defineStore } from "pinia";
import { normalizePath } from "../file-tree/tree-utils";

/** 标签类型：文件标签 or 未命名标签 */
export type TabKind = "file" | "untitled";

/** 标签元数据（可序列化；编辑器实例不落此） */
export interface TabMeta {
  /** 标签唯一 id（自增不复用，与重开栈/注册表关联的键） */
  id: string;
  kind: TabKind;
  /** 文件标签的归一化前原始路径（untitled 无此字段） */
  path?: string;
  title: string;
  /** 是否脏（02 写盘事件单一事件源驱动） */
  dirty: boolean;
  /** 内容就绪前不挂载编辑器（防空内容闪挂） */
  contentReady: boolean;
  /** LRU 回收登记的内容快照；重建后清除 */
  contentSnapshot?: string;
}

/** 重开栈条目：关闭时恒存编辑器内容（D4），LIFO 弹出恢复 */
export interface ClosedTab {
  id: string;
  kind: TabKind;
  path?: string;
  title: string;
  dirty: boolean;
  /** 关闭时编辑器内容（D4 恒存脏快照） */
  content: string;
}

/** 重开栈深度上限（超出丢最旧） */
export const CLOSED_STACK_LIMIT = 20;
/** 保活上限（超限 LRU 回收最久未激活实例） */
export const MAX_TABS = 16;

export const useTabsStore = defineStore("tabs", {
  state: () => ({
    tabs: [] as TabMeta[],
    activeTabId: undefined as string | undefined,
    closedStack: [] as ClosedTab[],
    untitledSeq: 0,
    /** 标签 id 自增（关闭不复用——注册表/重开栈以 id 关联，复用会导致歧义） */
    idSeq: 0,
  }),

  getters: {
    /** 当前激活标签元数据；无激活时返回 undefined */
    activeTab(state): TabMeta | undefined {
      return state.tabs.find((t) => t.id === state.activeTabId);
    },
  },

  actions: {
    /**
     * 打开文件标签；同路径去重（激活既有标签，不新建）。
     * @param path 原始文件路径（Windows 反斜杠/正斜杠均可）
     * @param title 标签展示标题（文件名）
     * @returns 标签 id 与是否新建；created=false 表示激活了既有标签
     */
    openFile(path: string, title: string): { id: string; created: boolean } {
      // 去重键为归一化路径（分隔符/verbatim 前缀差异视为同一文件，AC-F29-2）
      const key = normalizePath(path);
      const existing = this.tabs.find(
        (t) => t.kind === "file" && t.path !== undefined && normalizePath(t.path) === key,
      );
      if (existing) {
        this.activate(existing.id);
        return { id: existing.id, created: false };
      }
      const id = `tab-${++this.idSeq}`;
      this.tabs.push({ id, kind: "file", path, title, dirty: false, contentReady: false });
      this.activate(id);
      return { id, created: true };
    },

    /**
     * 新建未命名标签并激活。
     * @returns 新标签 id（编号递增；关闭不会复用编号）
     */
    createUntitled(): string {
      const id = `tab-${++this.idSeq}`;
      this.untitledSeq += 1;
      this.tabs.push({
        id,
        kind: "untitled",
        title: `Untitled ${this.untitledSeq}`,
        dirty: false,
        contentReady: true,
      });
      this.activate(id);
      return id;
    },

    /** 激活指定标签（仅簿记；不校验 id 存在性） */
    activate(id: string): void {
      this.activeTabId = id;
    },

    /**
     * 关闭标签：恒存关闭前内容入重开栈（D4）→ 移除 → 邻位激活
     * （关闭的是激活标签时激活右邻，无右邻则左邻；最后一个标签自动新建 Untitled，D3）。
     * 关闭不存在的 id 直接返回。
     * @param id 目标标签 id
     * @param content 关闭时编辑器内容（Ctrl+Shift+T 恢复的脏快照）
     */
    closeTab(id: string, content: string): void {
      const tab = this.tabs.find((t) => t.id === id);
      if (!tab) return;
      // 恒存关闭前编辑器内容入栈（D4）：Ctrl+Shift+T 恢复脏快照
      this.closedStack.push({
        id: tab.id,
        kind: tab.kind,
        path: tab.path,
        title: tab.title,
        dirty: tab.dirty,
        content,
      });
      if (this.closedStack.length > CLOSED_STACK_LIMIT) this.closedStack.shift();
      const index = this.tabs.findIndex((t) => t.id === id);
      this.tabs.splice(index, 1);
      if (this.tabs.length === 0) {
        // 最后一个标签：自动新建 Untitled（D3），编辑器常驻不出现空态
        this.activeTabId = undefined;
        this.createUntitled();
      } else if (this.activeTabId === id) {
        // 关闭的是激活标签：激活右邻（原位置现为右邻），无右邻则左邻（末尾）
        const neighbor = this.tabs[Math.min(index, this.tabs.length - 1)];
        this.activate(neighbor.id);
      }
    },

    /** 打开失败回滚（controller 专用：文件读取失败移除挂起标签） */
    removeTab(id: string): void {
      const index = this.tabs.findIndex((t) => t.id === id);
      if (index === -1) return;
      this.tabs.splice(index, 1);
      if (this.activeTabId === id) {
        if (this.tabs.length === 0) {
          this.activeTabId = undefined;
          this.createUntitled();
        } else {
          this.activate(this.tabs[Math.min(index, this.tabs.length - 1)].id);
        }
      }
    },

    /** Ctrl+Tab 正向 / Ctrl+Shift+Tab 反向轮换（按标签条顺序，AC-F29-3） */
    cycle(dir: 1 | -1): void {
      if (this.tabs.length === 0) return;
      const index = this.tabs.findIndex((t) => t.id === this.activeTabId);
      const next = (index + dir + this.tabs.length) % this.tabs.length;
      this.activate(this.tabs[next].id);
    },

    /** LIFO 重开最近关闭：恢复关闭前内容与脏状态（AC-F29-5/6）；栈空返回 undefined */
    reopenClosed(): string | undefined {
      const closed = this.closedStack.pop();
      if (!closed) return undefined;
      const id = `tab-${++this.idSeq}`;
      this.tabs.push({
        id,
        kind: closed.kind,
        path: closed.path,
        title: closed.title,
        dirty: closed.dirty,
        contentReady: true,
        contentSnapshot: closed.content,
      });
      this.activate(id);
      return id;
    },

    /** 标记内容已就绪（可挂载编辑器） */
    markContentReady(id: string): void {
      const tab = this.tabs.find((t) => t.id === id);
      if (tab) tab.contentReady = true;
    },

    /** 标记标签为脏（02 写盘事件驱动） */
    markDirty(id: string): void {
      const tab = this.tabs.find((t) => t.id === id);
      if (tab) tab.dirty = true;
    },

    /** 标记标签已保存（清除脏标记） */
    markSaved(id: string): void {
      const tab = this.tabs.find((t) => t.id === id);
      if (tab) tab.dirty = false;
    },

    /** LRU 回收登记内容快照（含 FM 的完整序列化；重建后清除） */
    setSnapshot(id: string, content: string): void {
      const tab = this.tabs.find((t) => t.id === id);
      if (tab) tab.contentSnapshot = content;
    },

    /** 清除内容快照（重建/恢复后调用） */
    clearSnapshot(id: string): void {
      const tab = this.tabs.find((t) => t.id === id);
      if (tab) tab.contentSnapshot = undefined;
    },
  },
});
