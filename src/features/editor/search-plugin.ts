// 官方查找高亮插件装配（06 搜索替换消费基座）
//
// prosemirror-search 1.1.x 重写版无内置面板命令，仅提供插件 + 查询模型 + 导航/替换
// 命令；面板 UI 由 features/search 自研。空查询 valid=false 时装饰集恒为空，
// 未使用期间零渲染开销，故随工厂默认装配（所有标签实例均具备查询状态容器，
// 切标签重放由 find-controller 负责）。
import { $prose } from "@milkdown/kit/utils";
import { search } from "prosemirror-search";

/** 查找高亮插件（06 面板经 setSearchState 派发查询驱动） */
export const markwellSearchPlugin = $prose(() => search());
