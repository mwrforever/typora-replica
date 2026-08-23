// 大纲面板状态机（05 大纲模块，F19 高亮/F21 过滤/F22 折叠共享 UI 状态）
//
// 单一职责：承载标题条目缓存与视图派生计算（过滤平铺/折叠祖先链裁剪）。
// 不直接触碰编辑器实例——headings 由装配层经 collectHeadings 重算后
// applyHeadings 注入；activeHeadingId 由双通道判定（current-heading.ts 的
// 编辑/滚动通道）结果回写；collapsible 为 settings.outline.collapsible 的
// 运行时镜像（持久化归 services/settings，本 store 不落盘）。
// 线程安全：Pinia store 单实例，全部状态变更走 action（Vue 响应式）；
// Set 直接入 state 沿 file-tree-store expandedPaths 先例（Vue 3 可响应 Set）。
import { defineStore } from "pinia";
import type { HeadingInfo } from "../editor/heading-collect";

export const useOutlineStore = defineStore("outline", {
  state: () => ({
    /** 标题条目缓存（文档序，collectHeadings 产物原样注入） */
    headings: [] as HeadingInfo[],
    /** 当前高亮标题锚点 id（undefined=无高亮，如光标位于首个标题之前） */
    activeHeadingId: undefined as string | undefined,
    /** 过滤词（大小写不敏感子串匹配；空串=不过滤） */
    filterQuery: "",
    /** 折叠开关（默认 false=Flat 全量平铺，AC-F22-1；持久化由 settings 服务负责） */
    collapsible: false,
    /** 已折叠标题锚点 id 集合（仅 collapsible=true 时参与可见性裁剪） */
    collapsedIds: new Set<string>(),
  }),

  getters: {
    /**
     * 过滤视图：过滤词非空时返回命中项平铺数组（保留原 level 供缩进，
     * AC-F21-1/2）；空串返回全量。匹配对大小写不敏感。
     */
    filteredHeadings(state): HeadingInfo[] {
      const query = state.filterQuery.toLowerCase();
      if (query === "") return state.headings;
      return state.headings.filter((h) => h.text.toLowerCase().includes(query));
    },

    /**
     * 可见条目（大纲渲染唯一数据源）：过滤优先于折叠（F21×F22 正交）——
     * 过滤词非空时忽略折叠状态直接走命中平铺；否则按「折叠祖先链」线性裁剪：
     * 维护未闭合祖先栈（level/id），任一存活祖先被折叠的条目连同其子树一并隐藏。
     */
    visibleHeadings(state): HeadingInfo[] {
      if (state.filterQuery !== "") return this.filteredHeadings;
      // Flat 模式（折叠关闭）全量可见
      if (!state.collapsible) return state.headings;
      const result: HeadingInfo[] = [];
      // 祖先栈：文档序入栈；遇到 level ≤ 栈顶的条目时弹出已闭合层级
      const ancestorStack: Array<{ level: number; id: string }> = [];
      for (const heading of state.headings) {
        while (
          ancestorStack.length > 0 &&
          ancestorStack[ancestorStack.length - 1].level >= heading.level
        ) {
          ancestorStack.pop();
        }
        // 任一存活祖先被折叠 → 本条目隐藏（其后代因它入栈与否均已被同链裁剪）
        const folded = ancestorStack.some((a) => state.collapsedIds.has(a.id));
        if (!folded) result.push(heading);
        ancestorStack.push({ level: heading.level, id: heading.id });
      }
      return result;
    },
  },

  actions: {
    /**
     * 文档重算入口（编辑器 markdownUpdated → collectHeadings 后调用）
     * @param items 最新标题条目（文档序）；允许为空数组（无标题文档清空大纲）
     * @returns 无；副作用为整体替换 headings 并把 collapsedIds 收敛到新旧 id 交集
     */
    applyHeadings(items: HeadingInfo[]): void {
      this.headings = items;
      // 交集裁剪：重算后消失的 id 移除折叠态不留僵尸（AC-F22-3）；
      // Set 边遍历边删除为 JS 规范安全操作
      const aliveIds = new Set(items.map((h) => h.id));
      for (const id of this.collapsedIds) {
        if (!aliveIds.has(id)) this.collapsedIds.delete(id);
      }
    },

    /**
     * 回写当前高亮标题（双通道判定结果统一入口）
     * @param id 锚点 id；undefined 表示清除高亮（光标位于标题区之外）
     */
    setActive(id: string | undefined): void {
      this.activeHeadingId = id;
    },

    /**
     * 设置过滤词
     * @param query 子串查询词（大小写不敏感）；空串恢复全量展示
     */
    setFilter(query: string): void {
      this.filterQuery = query;
    },

    /**
     * 折叠开关（AC-F22-1：默认 false=Flat）
     * @param value true 开启折叠交互；false 回到 Flat 并清空折叠集合（无残留）
     */
    setCollapsible(value: boolean): void {
      this.collapsible = value;
      if (!value) this.collapsedIds.clear();
    },

    /**
     * 切换单个标题折叠态（再次点击展开）
     * @param id 标题锚点 id（须为当前 headings 内的有效条目）
     */
    toggleCollapsed(id: string): void {
      if (this.collapsedIds.has(id)) this.collapsedIds.delete(id);
      else this.collapsedIds.add(id);
    },
  },
});
