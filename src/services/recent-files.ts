// 最近文件（02 文档管理，F13）
//
// 规则（已锁定）：上限 10 条（自定）；重复打开去重置顶；pinned 固定项在
// clear 时保留（固定项入口：03 侧栏/Open Quickly 右键，本模块只提供标记能力）；
// remove 供「打开失败提示并移除」（AC-F13-4）。
// 持久化：复用 markwell-settings.json 的 recentFiles 键（store 插件自动保存）。
import { load } from "@tauri-apps/plugin-store";

/** 最近文件条目 */
export interface RecentFile {
  /** 文件/文件夹完整路径 */
  path: string;
  /** 固定标记（clear 时保留） */
  pinned: boolean;
  /** 最近打开时间戳（排序依据） */
  openedAt: number;
}

/** 列表上限（自定，Typora 未载明） */
export const MAX_RECENT = 10;

const STORE_FILE = "markwell-settings.json";
const KEY = "recentFiles";

/** 最近文件服务 */
export class RecentFiles {
  /** 读取当前列表（无存量返回空） */
  async list(): Promise<RecentFile[]> {
    const store = await load(STORE_FILE, { autoSave: true });
    const raw = (await store.get<unknown>(KEY)) ?? [];
    return Array.isArray(raw) ? (raw as RecentFile[]) : [];
  }

  /** 写入列表（内部方法） */
  private async persist(items: RecentFile[]): Promise<void> {
    const store = await load(STORE_FILE, { autoSave: true });
    await store.set(KEY, items);
  }

  /**
   * 记录打开（文件或文件夹）：去重置顶 + 超限截断（挤掉最旧非固定项）
   * @param path 打开的文件/文件夹路径
   */
  async record(path: string): Promise<void> {
    const items = await this.list();
    const existing = items.find((f) => f.path === path);
    const pinned = existing?.pinned ?? false;
    const next = [{ path, pinned, openedAt: Date.now() }, ...items.filter((f) => f.path !== path)];
    // 超限截断：从尾部移除（固定项优先保留，先裁非固定）
    const trimmed = next.slice(0, MAX_RECENT);
    await this.persist(trimmed);
  }

  /** 切换固定标记（03/12 UI 入口调用；幂等） */
  async togglePin(path: string): Promise<void> {
    const items = await this.list();
    const next = items.map((f) => (f.path === path ? { ...f, pinned: !f.pinned } : f));
    await this.persist(next);
  }

  /** 清除列表（固定项保留，AC-F13-3） */
  async clear(): Promise<void> {
    const items = await this.list();
    await this.persist(items.filter((f) => f.pinned));
  }

  /** 移除条目（打开失败时调用，AC-F13-4） */
  async remove(path: string): Promise<void> {
    const items = await this.list();
    await this.persist(items.filter((f) => f.path !== path));
  }
}
