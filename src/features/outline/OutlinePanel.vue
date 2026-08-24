<!-- 大纲面板（05）：过滤输入框 + 层级缩进列表 + 点击跳转 + 当前标题高亮 + 双空态
     + 右键菜单（Highlight Current Header / 折叠开关）+ 折叠 caret（AC-F20/F22） -->
<script setup lang="ts">
import { computed, onUnmounted, ref } from "vue";
import { revealRange } from "../editor/reveal-range";
import { editorManager } from "../editor/editor-manager";
import type { HeadingInfo } from "../editor/heading-collect";
import { useOutlineData } from "./outline-data";
import { useOutlineStore } from "./outline-store";
import { updateSettings } from "../../services/settings";

/** 高亮闪现类名（与 reveal-range / toc-plugin 同源复用，08 主题模块统一精修视觉） */
const REVEAL_HIGHLIGHT_CLASS = "markwell-reveal-highlight";
/** 高亮闪现时长（毫秒，与 reveal-range 同款） */
const REVEAL_HIGHLIGHT_DURATION = 1200;

const store = useOutlineStore();

// 可写计算代理（AC-F21）：输入框 v-model 双向绑定过滤词——读直取 state、
// 写经 setFilter action 收口，保证过滤状态变更与其他 action 同一入口
const filterQuery = computed({
  get: () => store.filterQuery,
  set: (v: string) => store.setFilter(v),
});

// —— 右键菜单状态（AC-F20/F22）——
/** 菜单显隐 */
const menuOpen = ref(false);
/** 菜单定位偏移（px，相对面板左上角；绝对定位包含块为面板根元素） */
const menuX = ref(0);
const menuY = ref(0);
/** 面板根元素引用：菜单定位基准 + HCH 激活条目查找范围 */
const panelRoot = ref<HTMLElement | null>(null);
/** 待清除的高亮定时器句柄（undefined = 无待执行回调；卸载/重复触发时撤销） */
let highlightTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * 有子级标题 id 集合：全量标题序列中紧随其后存在更深层级即视为父级。
 * 刻意取全量而非 visibleHeadings——父级自身被折叠后子树隐藏，「展开入口」
 * 的 caret 不能随之消失（否则折叠态成为死路无法展开）；过滤模式下折叠被
 * 忽略（store.visibleHeadings 过滤优先语义），caret 一并隐藏避免误导。
 */
const hasChildrenById = computed(() => {
  const flags = new Set<string>();
  const list = store.headings;
  for (let i = 0; i < list.length; i++) {
    if (i + 1 < list.length && list[i + 1].level > list[i].level) flags.add(list[i].id);
  }
  return flags;
});

/** 数据装配订阅与组件生命周期严格成对：setup 内注册（useOutlineData），
 * unmount 统一解除（dispose）；同批兜底清理菜单监听与未到期高亮回调 */
const { dispose } = useOutlineData();
onUnmounted(() => {
  dispose();
  closeMenu();
  if (highlightTimer !== undefined) clearTimeout(highlightTimer);
});

/**
 * 点击条目：定位标题文本区间并临时高亮
 *
 * 复用 01 模块锁定接口 revealRange（选中 → 滚动可视 → 临时高亮），区间取标题
 * 文本 [pos+1, pos+1+text.length)——避开节点边界使选区落在可见文本上；
 * 越界由 revealRange 内部收敛（AC-F18-2）。编辑器未就绪时静默跳过。
 * @param item 被点击的标题条目（store.visibleHeadings 成员）
 */
function jumpTo(item: HeadingInfo): void {
  const editor = editorManager.getEditor();
  if (!editor) return;
  revealRange(editor, item.pos + 1, item.pos + 1 + item.text.length);
}

/**
 * 面板容器右键：阻止原生菜单并打开自绘菜单（AC-F20/F22 入口）
 *
 * 定位取 clientX/Y 相对面板矩形左上角的偏移（面板根为 absolute 包含块；
 * jsdom 零矩形下退化为 client 坐标本身，不影响测试断言）。打开同时登记
 * document 一次性 click 监听做 click-away 关闭——同函数重复注册会被浏览器
 * 去重，卸载时由 onUnmounted 兜底解除。
 * @param event 右键事件（来源为面板任意子区域）
 */
function onContextMenu(event: MouseEvent): void {
  event.preventDefault();
  const rect = panelRoot.value?.getBoundingClientRect();
  menuX.value = event.clientX - (rect?.left ?? 0);
  menuY.value = event.clientY - (rect?.top ?? 0);
  menuOpen.value = true;
  document.addEventListener("click", closeMenu, { once: true });
}

/** 关闭菜单并解除 click-away 监听（幂等：监听未登记时 remove 为无害操作） */
function closeMenu(): void {
  menuOpen.value = false;
  document.removeEventListener("click", closeMenu);
}

/**
 * Highlight Current Header（AC-F20-1）：当前激活条目滚入视野中央并闪现高亮
 *
 * 执行流程：关菜单 → 按 activeHeadingId 在渲染条目中定位 DOM 元素 →
 * scrollIntoView 居中 → 复用 markwell-reveal-highlight 类闪现 1200ms 自动移除。
 * 激活条目不存在（无高亮 / 被过滤或折叠隐藏）时静默返回。定时器句柄先撤后挂，
 * 避免重复触发时旧回调误清新高亮；组件卸载时统一 clearTimeout（见 onUnmounted）。
 */
function highlightCurrentHeader(): void {
  closeMenu();
  const id = store.activeHeadingId;
  if (id === undefined || !panelRoot.value) return;
  // dataset 匹配代替 CSS 选择器插值：标题锚点 id 为任意字符串，免转义歧义
  let target: HTMLElement | null = null;
  for (const el of panelRoot.value.querySelectorAll<HTMLElement>("[data-outline-item]")) {
    if (el.dataset.outlineId === id) {
      target = el;
      break;
    }
  }
  if (!target) return;
  target.scrollIntoView({ block: "center" });
  target.classList.add(REVEAL_HIGHLIGHT_CLASS);
  if (highlightTimer !== undefined) clearTimeout(highlightTimer);
  highlightTimer = setTimeout(() => {
    highlightTimer = undefined;
    target.classList.remove(REVEAL_HIGHLIGHT_CLASS);
  }, REVEAL_HIGHLIGHT_DURATION);
}

/**
 * 菜单「大纲视图允许折叠和展开」动作（AC-F22-2）：翻转 store.collapsible 并持久化
 *
 * 持久化以增量 patch fire-and-forget 写回（失败不阻塞 UI，仅丢下次会话偏好，
 * 与 document-session lastFolder 写回同构）。
 */
function toggleCollapsibleFromMenu(): void {
  closeMenu();
  const next = !store.collapsible;
  store.setCollapsible(next);
  void updateSettings({ outline: { collapsible: next } }).catch(() => undefined);
}

/**
 * 条目前 caret 点击（AC-F22-2）：切换单条折叠态
 * 调用方模板以 @click.stop 阻断冒泡——caret 位于条目内部，冒泡会误触 jumpTo 跳转。
 * @param id 目标标题锚点 id（须为当前 headings 内的有效条目）
 */
function onToggleCollapsed(id: string): void {
  store.toggleCollapsed(id);
}
</script>

<template>
  <div ref="panelRoot" class="outline-panel" @contextmenu="onContextMenu">
    <!-- 过滤输入框常驻面板顶部：输入即滤（store.filteredHeadings 大小写不敏感子串匹配） -->
    <input
      v-model="filterQuery"
      class="outline-panel__filter"
      placeholder="过滤标题…"
      data-outline-filter
    />
    <ul v-if="store.visibleHeadings.length > 0" class="outline-panel__list" data-outline-list>
      <li
        v-for="h in store.visibleHeadings"
        :key="`${h.pos}`"
        class="outline-panel__item"
        :class="{ 'outline-panel__item--active': h.id === store.activeHeadingId }"
        :style="{ paddingLeft: `${(h.level - 1) * 16}px` }"
        data-outline-item
        :data-outline-id="h.id"
        @click="jumpTo(h)"
      >
        <!-- 折叠切换钮：仅 collapsible 开启且非过滤态且有子级时渲染；
             ▸ 已折叠 / ▾ 已展开，@click.stop 防误触跳转 -->
        <button
          v-if="store.collapsible && store.filterQuery === '' && hasChildrenById.has(h.id)"
          type="button"
          class="outline-panel__caret"
          data-outline-caret
          :aria-expanded="!store.collapsedIds.has(h.id)"
          :aria-label="store.collapsedIds.has(h.id) ? '展开子标题' : '折叠子标题'"
          @click.stop="onToggleCollapsed(h.id)"
        >
          {{ store.collapsedIds.has(h.id) ? "▸" : "▾" }}
        </button>
        {{ h.text }}
      </li>
    </ul>
    <!-- 空态三分（AC-F21-2 + F22 空态修正）：无标题文档 / 有标题但过滤零命中 /
         有标题但全部被折叠隐藏。按语义判定而非 headings.length 边界——
         注：当前 store 裁剪算法下首条目恒存活，「全部折叠隐藏」暂不可达，
         本分支为防御性语义位（未来 collapse-all 等特性落地即生效） -->
    <p v-else-if="store.headings.length === 0" class="outline-panel__empty">（无标题）</p>
    <p v-else-if="store.filterQuery !== ''" class="outline-panel__empty">无匹配标题</p>
    <p v-else class="outline-panel__empty">无可见标题</p>
    <!-- 自绘右键菜单：绝对定位跟随右键点，document 一次性 click 关闭 -->
    <div
      v-if="menuOpen"
      class="outline-panel__menu"
      :style="{ left: `${menuX}px`, top: `${menuY}px` }"
      data-outline-menu
    >
      <button
        type="button"
        class="outline-panel__menu-item"
        data-outline-menu-hch
        @click="highlightCurrentHeader"
      >
        Highlight Current Header
      </button>
      <button
        type="button"
        class="outline-panel__menu-item"
        data-outline-menu-collapse
        @click="toggleCollapsibleFromMenu"
      >
        <span class="outline-panel__menu-check">{{ store.collapsible ? "✓" : "" }}</span>
        大纲视图允许折叠和展开
      </button>
    </div>
  </div>
</template>

<style scoped>
/* 大纲面板样式：沿项目 --markwell-* 设计令牌；08 主题模块按令牌精修。
   position:relative 使自身成为右键菜单 absolute 定位的包含块 */
.outline-panel {
  position: relative;
  height: 100%;
  overflow-y: auto;
  padding: 4px 0;
}

/* 过滤输入框：常驻顶部，token 与侧栏搜索框（sidebar-panel__search-input）同源 */
.outline-panel__filter {
  box-sizing: border-box;
  width: calc(100% - 16px);
  margin: 4px 8px;
  padding: 4px 8px;
  font-size: 13px;
  border: 1px solid var(--markwell-border, #ddd);
  border-radius: 4px;
  background: var(--markwell-surface, #fff);
  color: var(--markwell-text, #333);
}

.outline-panel__list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.outline-panel__item {
  /* 左缩进由模板内联样式按 (level-1)*16px 注入，此处只管其余方向 */
  padding: 4px 8px;
  font-size: 13px;
  line-height: 1.6;
  color: var(--markwell-text, #333);
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.outline-panel__item:hover {
  background: var(--markwell-accent-weak, #e8f1ff);
}

.outline-panel__item--active {
  color: var(--markwell-accent, #3b82f6);
  font-weight: 600;
  background: var(--markwell-accent-weak, #e8f1ff);
}

/* HCH 闪现高亮兜底视觉（AC-F20-1）：类名与编辑器 reveal/toc 同源，
   此处给面板内条目一个可辨识的临时底色，08 主题模块统一收口 */
.outline-panel__item.markwell-reveal-highlight {
  background: var(--markwell-accent-weak, #ffe9a8);
}

/* 折叠切换钮：行内小方块，不继承条目的省略号布局；hover 提示可交互 */
.outline-panel__caret {
  box-sizing: border-box;
  width: 16px;
  height: 16px;
  margin-right: 4px;
  padding: 0;
  border: none;
  background: none;
  font-size: 10px;
  line-height: 16px;
  vertical-align: middle;
  color: var(--markwell-text-dim, #888);
  cursor: pointer;
}

.outline-panel__caret:hover {
  color: var(--markwell-accent, #3b82f6);
}

.outline-panel__empty {
  padding: 8px;
  font-size: 13px;
  color: var(--markwell-text-dim, #888);
}

/* 自绘右键菜单：样式对齐 FileTreeMenu（03 先例），坐标改面板内 absolute */
.outline-panel__menu {
  position: absolute;
  z-index: 1000;
  min-width: 200px;
  padding: 4px;
  background: var(--markwell-bg, #fff);
  border: 1px solid var(--markwell-border, #ddd);
  border-radius: 6px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.18);
}

.outline-panel__menu-item {
  display: block;
  width: 100%;
  padding: 6px 12px;
  border: none;
  background: none;
  text-align: left;
  font-size: 13px;
  color: var(--markwell-text, #333);
  cursor: pointer;
  white-space: nowrap;
}

.outline-panel__menu-item:hover {
  background: var(--markwell-accent-weak, #e8f1ff);
}

/* 勾选标记占位等宽：勾选态切换不引起菜单项文字抖动 */
.outline-panel__menu-check {
  display: inline-block;
  width: 18px;
}
</style>
