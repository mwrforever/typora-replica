// 全局搜索入口（03 文件树，F12）
//
// 行为：Ctrl+Shift+F → 侧栏展开 + 自动切文件树面板 + 顶部显示搜索框
// （AC-F12-1/2/3）。搜索逻辑归 06 模块（本模块只做入口 UI 与事件）。
// 事件：request-search(query)——06 消费；03 阶段输入框仅占位展示。

/** 搜索框输入事件载荷 */
export interface SearchRequest {
  /** 用户输入查询词 */
  query: string;
}

/**
 * 构建搜索入口处理器
 * @param onRequest 查询发起回调（06 消费；03 阶段可空）
 * @returns { handleInput, handleSubmit } 供组件绑定
 */
export function createSearchEntry(onRequest?: (req: SearchRequest) => void) {
  /** 输入变化（03 阶段仅透传，无过滤逻辑） */
  function handleInput(query: string): void {
    onRequest?.({ query });
  }

  /** 提交（Enter）：透传当前查询 */
  function handleSubmit(query: string): void {
    onRequest?.({ query });
  }

  return { handleInput, handleSubmit };
}
