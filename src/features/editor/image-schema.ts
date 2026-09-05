// image-block schema 定制（07 图片粘贴存盘 Task 9，联合 01 编辑核心用户拍板：alt 保真，ratio 挪位）
//
// 起点（T1 钉桩 task-1-report.md）：Crepe 内置 image-block 把 markdown alt 位用作缩放
// 比例存储——parseMarkdown 读 Number(alt) 进 ratio、toMarkdown 以 toFixed(2) 回写 alt 位，
// 导致 Typora 文档 `![描述](p.png)` 打开保存后 alt 一次性丢失为 `![1.00]`（调研最重差异）；
// caption 实际对应 markdown title 位。新插图三路（粘贴/拖拽/编程插入）默认落盘 `![1.00](url)`。
//
// 定制契约（AC 驱动）：
//   parseMarkdown：
//     - title 匹配 zoom:<数值> 命名空间 → 数值进 ratio，alt 位回归 caption 语义；
//     - alt 为纯数字（历史 Crepe 独有落盘形态 ![0.50](p)）→ 迁移进 ratio 并清空 caption
//       （Typora 语义下纯数字 alt 无业务含义，接受迁移——PR 披露项）；
//     - 其余形态：caption ← alt 原样保真；真实 title 存入扩展 attr rawTitle 待还原。
//   toMarkdown：
//     - alt ← caption；ratio≠1 → title 位挂 `zoom:{toFixed(2)}`（如 "zoom:0.50"）；
//     - ratio=1 → title 位仅回写 rawTitle（通常空串即不产出，不污染既有无 title 文档）。
// zoom: 命名空间防止真实 title（如「画册」）被误读为缩放比例；rawTitle 保证真实
// title roundtrip 保真而非静默丢弃（内置三 attrs 无法同时表达「描述在 alt 位」与
// 「title 原样保留」，故必须扩展 attrs——nodeView 只消费 src/caption/ratio，不受影响）。
import { IMAGE_DATA_TYPE, imageBlockSchema } from "@milkdown/kit/component/image-block";
import { expectDomTypeError } from "@milkdown/kit/exception";

/** zoom title 命名空间正则（仅匹配 zoom:<数值> 形态，真实 title 如「画册」不命中） */
const ZOOM_TITLE_RE = /^zoom:(\d+(?:\.\d+)?)$/;

/** 历史 Crepe 独有形态：markdown alt 位纯 ratio 数字（如 0.50 / 1.00 / 2） */
const LEGACY_RATIO_ALT_RE = /^\d+(?:\.\d+)?$/;

/**
 * ratio 数值收窄：非法值（NaN/非有限/≤0）一律回落 1
 * 沿内置 runner「ratio===0 回落 1」语义外扩覆盖 NaN 与负数，
 * 避免 nodeView onImageLoad 按 0 或负数计算 img 高度导致图片不可见。
 * @param value 待收窄数值（zoom title / 历史数字 alt 的 parseFloat 结果、或外部写入的 attr）
 * @returns 可安全参与高度计算与序列化的正数比例
 */
function normalizeRatio(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 1;
}

/**
 * 定制后的 image-block schema（07）
 *
 * 以 extendSchema 原地替换内置定义（同 id "image-block" 经 upsertById 生效，
 * 本扩展后注册故覆盖库默认——沿 lowerLanguageCodeBlockSchema 先例）。相对内置：
 *   - attrs 增加 rawTitle（非 zoom 命名空间的原始 markdown title 保真载体）；
 *   - parseDOM 追加读回 rawTitle（与内置逐字段同款 + 一项）；
 *   - parseMarkdown/toMarkdown 重写 alt↔caption、title↔(zoom|rawTitle) 双向映射。
 * 其余节点规格（inline/group/draggable/nodeView 绑定等）经 spread 全量继承；
 * toDOM 平铺 attrs 属剪贴板/导出 DOM 的产出侧，rawTitle 经定制 parseDOM 读回闭环。
 */
export const markwellImageBlockSchema = imageBlockSchema.extendSchema((prev) => {
  return (ctx) => {
    const baseSchema = prev(ctx);
    return {
      ...baseSchema,
      attrs: {
        ...baseSchema.attrs,
        /** 非 zoom 形态的真实 markdown title（roundtrip 保真载体；缺省空串=无 title） */
        rawTitle: { default: "", validate: "string" },
      },
      // parseDOM 覆写：toDOM 平铺 node.attrs 会把 rawTitle 写进剪贴板/拖拽 DOM，
      // 但内置 getAttrs 只读 src/caption/ratio——不覆写则编辑器内复制粘贴/拖拽
      // 图片块时 title 静默丢失（本次定制引入的回退，基线下 title 经 caption 存活）。
      // 读回逻辑与内置逐字段同款，仅追加 rawTitle 一项。
      parseDOM: [
        {
          tag: `img[data-type="${IMAGE_DATA_TYPE}"]`,
          getAttrs: (dom) => {
            if (!(dom instanceof HTMLElement)) throw expectDomTypeError(dom);
            return {
              src: dom.getAttribute("src") || "",
              caption: dom.getAttribute("caption") || "",
              ratio: Number(dom.getAttribute("ratio") ?? 1),
              // 与 toDOM 平铺对称读回：缺属性回落空串（无 title）
              rawTitle: dom.getAttribute("rawTitle") || "",
            };
          },
        },
      ],
      parseMarkdown: {
        match: baseSchema.parseMarkdown.match,
        runner: (state, node, type) => {
          // mdast 字段经索引签名访问均为 unknown，逐一 typeof 收窄防脏数据入档
          const src = typeof node.url === "string" ? node.url : "";
          const alt = typeof node.alt === "string" ? node.alt : "";
          const mdTitle = typeof node.title === "string" ? node.title : "";
          const zoomMatch = ZOOM_TITLE_RE.exec(mdTitle);
          if (zoomMatch) {
            // zoom 命名空间 title：数值回归 ratio，alt 位回归描述语义（AC-P11-3/4 正向读取）；
            // 正则含捕获组且命中才取 [1]，恒有值（! 仅作类型收窄）
            state.addNode(type, {
              src,
              caption: alt,
              ratio: normalizeRatio(Number.parseFloat(zoomMatch[1]!)),
              rawTitle: "",
            });
            return;
          }
          if (LEGACY_RATIO_ALT_RE.test(alt)) {
            // 历史 Crepe 落盘 ![0.50](p)：数字 alt 迁移进 ratio、caption 清空、
            // 下次保存改挂 zoom title（存量文档保存一次即自动升级为新形态）
            state.addNode(type, {
              src,
              caption: "",
              ratio: normalizeRatio(Number.parseFloat(alt)),
              rawTitle: mdTitle,
            });
            return;
          }
          // 常规形态：alt 即图片描述原样保真，真实 title 暂存 rawTitle 待序列化还原
          state.addNode(type, { src, caption: alt, ratio: 1, rawTitle: mdTitle });
        },
      },
      toMarkdown: {
        match: baseSchema.toMarkdown.match,
        runner: (state, node) => {
          // ratio 收窄后再判缩放态：attr 可能被外部置为非法值（防御序列化出 zoom:NaN）
          const ratio = normalizeRatio(Number(node.attrs.ratio));
          const caption = typeof node.attrs.caption === "string" ? node.attrs.caption : "";
          const rawTitle = typeof node.attrs.rawTitle === "string" ? node.attrs.rawTitle : "";
          // title 位优先级：zoom（ratio≠1，锁定两位小数如 "0.50"，与内置 toFixed(2) 对齐）
          // > 真实 title 原样回写。空串 title 为 falsy，remark 序列化不产出 title 段
          // （沿内置行为，无 "" 残留），故无需 undefined 分支
          const title = ratio !== 1 ? `zoom:${ratio.toFixed(2)}` : rawTitle;
          state.openNode("paragraph");
          state.addNode("image", void 0, void 0, {
            title,
            url: typeof node.attrs.src === "string" ? node.attrs.src : "",
            alt: caption,
          });
          state.closeNode();
        },
      },
    };
  };
});
