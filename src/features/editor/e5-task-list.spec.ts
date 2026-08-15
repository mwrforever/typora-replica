// E5 任务列表：- [ ] 渲染 / 点击切换完成状态（可反复）
import { fireEvent } from "@testing-library/dom";
import { describe, expect, it } from "vitest";
import { nextTick } from "vue";
import { makeTestEditor } from "../../test/editor-test-utils";

describe("E5 任务列表", () => {
  // 选择器据实修正说明（brief Step 2 回退路径，已 dump 真实 DOM 核实）：
  // - Crepe 7.22.1 任务项 li 渲染为 <li class="list-item">，无 data-item-type 属性
  //   （data-item-type 仅存在于 parseDOM 规则，不输出到渲染 DOM）；
  // - checkbox 不是 input[type=checkbox]，而是 label-wrapper 内的图标 span：
  //   `span.milkdown-icon.label.unchecked`（未勾选）/ `.checked`（已勾选），
  //   普通列表项对应 class 为 bullet/ordered，故 label class 即任务项判定依据；
  // - 切换事件绑定在 NodeView 的 onPointerdown（label-wrapper 上），
  //   fireEvent.click 只派发 click 事件不会触发，须用 fireEvent.pointerDown 模拟真实点击。

  it("AC-E5-1 输入 `- [ ] 任务` 渲染为未勾选任务项", async () => {
    const te = await makeTestEditor();
    te.insertText("- [ ] 任务");
    // 内置 preset-gfm 输入规则（/^\[(?<checked>\s|x)\]\s$/）已消费 `[ ] ` 并写入
    // list_item attrs.checked=false（doc 级同步生效）；任务项由 Vue 组件渲染，
    // 属性变更后的 DOM 刷新发生在微任务，与真实渲染的异步时序一致，需等待刷新
    await nextTick();

    const item = te.view.dom.querySelector("li.list-item");
    expect(item).not.toBeNull();
    // 未勾选状态：checkbox 图标存在且为未选中（unchecked）
    const checkbox = item?.querySelector("span.milkdown-icon.label.unchecked");
    expect(checkbox).not.toBeNull();
  });

  it("AC-E5-2 点击复选框在 [ ]/[x] 间切换且文档内容同步", async () => {
    const te = await makeTestEditor("- [ ] 任务");
    const checkbox = te.view.dom.querySelector("span.milkdown-icon.label.unchecked");
    expect(checkbox).not.toBeNull();

    // pointerdown 冒泡至 label-wrapper 的 onPointerdown 处理器触发切换（同真实点击）
    fireEvent.pointerDown(checkbox!);
    expect(te.getMarkdown()).toContain("- [x] 任务");

    // Vue 复用同一 span 仅替换 class，原引用仍指向 checkbox，可再次点击切回
    fireEvent.pointerDown(checkbox!);
    expect(te.getMarkdown()).toContain("- [ ] 任务");
  });

  it("AC-E5-3 `- [x] 已完成` 再点击回到未完成（可反复切换）", async () => {
    const te = await makeTestEditor("- [x] 已完成");
    const checkbox = te.view.dom.querySelector("span.milkdown-icon.label.checked");
    expect(checkbox).not.toBeNull();

    fireEvent.pointerDown(checkbox!);
    expect(te.getMarkdown()).toContain("- [ ] 已完成");
  });
});
