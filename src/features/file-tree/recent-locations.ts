// 最近位置（03 文件树，F9）
//
// 与 02 RecentFiles 区分：本服务仅记录「打开过的文件夹」（F9 语义），
// 独立 store 键 recentLocations；02 RecentFiles 同时记录文件与文件夹
// （Open Quickly/Open Recent 消费），两套并存不互相干扰。
// 规则：上限 10（自定）；去重置顶；固定项（Pin）置顶且不被新记录挤出
// （AC-F9-2/4：溢出时固定项不占配额恒保留，非固定项截断）。
import { load } from "@tauri-apps/plugin-store";

/** 最近位置条目 */
export interface RecentLocation {
  /** 文件夹完整路径 */
  path: string;
  /** 固定标记（置顶且不被挤出） */
  pinned: boolean;
  /** 最近打开时间戳 */
  openedAt: number;
}

/** 列表上限（自定 10 条，spec F9） */
export const MAX_RECENT_LOCATIONS = 10;

const STORE_FILE = "markwell-settings.json";
const KEY = "recentLocations";

/** 最近位置服务 */
export class RecentLocations {
  /** 读取列表（无存量返回空） */
  async list(): Promise<RecentLocation[]> {
    const store = await load(STORE_FILE, { autoSave: true });
    const raw = (await store.get<unknown>(KEY)) ?? [];
    return Array.isArray(raw) ? (raw as RecentLocation[]) : [];
  }

  /** 记录打开文件夹：去重置顶 + 超限截断（固定项恒保留不占配额，AC-F9-2/4） */
  async record(path: string): Promise<void> {
    const items = await this.list();
    const existing = items.find((f) => f.path === path);
    const pinned = existing?.pinned ?? false;
    // 新记录/再次打开置顶（固定项再次打开回到固定区顶部，去重置顶语义）
    const next = [{ path, pinned, openedAt: Date.now() }, ...items.filter((f) => f.path !== path)];
    // 固定区在前（按固定顺序，即固定动作先后）；非固定项仅保留 MAX - 固定项数：
    // 固定项不占配额，固定项数量达上限时非固定项全挤出（AC-F9-4「固定项除外」）
    const pinnedItems = next.filter((f) => f.pinned);
    const unpinnedItems = next
      .filter((f) => !f.pinned)
      .slice(0, MAX_RECENT_LOCATIONS - pinnedItems.length);
    const store = await load(STORE_FILE, { autoSave: true });
    await store.set(KEY, [...pinnedItems, ...unpinnedItems]);
  }

  /**
   * 切换固定标记（hover Pin 按钮，AC-F9-2）
   * 固定 → 移固定区顶部（「其置顶」）；取消固定 → 移列表尾部（非固定区末端，
   * 后续再次打开会按去重置顶回到前端）。条目不存在（如损坏存量残留）时为空操作。
   */
  async togglePin(path: string): Promise<void> {
    const items = await this.list();
    const target = items.find((f) => f.path === path);
    if (!target) return;
    const rest = items.filter((f) => f.path !== path);
    const next = target.pinned
      ? [...rest, { ...target, pinned: false }]
      : [{ ...target, pinned: true }, ...rest];
    const store = await load(STORE_FILE, { autoSave: true });
    await store.set(KEY, next);
  }

  /** 移除条目（hover 移除按钮，AC-F9-3） */
  async remove(path: string): Promise<void> {
    const items = await this.list();
    const store = await load(STORE_FILE, { autoSave: true });
    await store.set(
      KEY,
      items.filter((f) => f.path !== path),
    );
  }
}
