// 退出聚合确认弹窗组件测试（12 W6：列表式一次性确认，AC-M-18 展示面）
//
// 覆盖：脏文件列表渲染（列出全部脏标签）、三按钮（全部保存/全部不保存/取消）
// 分别 emit、saving 期间按钮禁用（写盘原子性防重复触发）、Esc = 取消语义。
// 交互用 fireEvent：仓库无 @testing-library/user-event 依赖（宪法禁止随意新增
// 依赖），与同域 ConfirmCloseDialog.spec.ts 既有惯例一致。
import { fireEvent, render, screen } from "@testing-library/vue";
import { describe, expect, it } from "vitest";
import ExitConfirmDialog from "./ExitConfirmDialog.vue";

const items = [
  { id: "tab-1", title: "b.md" },
  { id: "tab-2", title: "c.md" },
  { id: "tab-3", title: "Untitled 1" },
];

describe("ExitConfirmDialog 退出聚合确认", () => {
  it("AC-M-18 列表列出全部脏文件（文件名逐项展示）", () => {
    render(ExitConfirmDialog, { props: { items, saving: false } });
    expect(screen.getByRole("dialog", { name: "未保存的更改" })).toBeInTheDocument();
    expect(screen.getByText("b.md")).toBeInTheDocument();
    expect(screen.getByText("c.md")).toBeInTheDocument();
    expect(screen.getByText("Untitled 1")).toBeInTheDocument();
  });

  it("三按钮分别 emit saveAll/discardAll/cancel", async () => {
    const { emitted } = render(ExitConfirmDialog, { props: { items, saving: false } });
    await fireEvent.click(screen.getByText("全部保存"));
    expect(emitted().saveAll).toHaveLength(1);
    await fireEvent.click(screen.getByText("全部不保存"));
    expect(emitted().discardAll).toHaveLength(1);
    await fireEvent.click(screen.getByText("取消"));
    expect(emitted().cancel).toHaveLength(1);
  });

  it("saving 期间三按钮禁用（写盘原子性，浏览器层拦截激活）", () => {
    render(ExitConfirmDialog, { props: { items, saving: true } });
    // 断言 disabled 属性（真实浏览器拦截点击激活）；不使用合成 click 断言
    // 「不 emit」——jsdom 对禁用元素的合成派发不实现浏览器激活语义，会产伪影
    expect((screen.getByText("全部保存") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByText("全部不保存") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByText("取消") as HTMLButtonElement).disabled).toBe(true);
  });

  it("Esc 键等价取消（非写盘期）；写盘期 Esc 不触发", async () => {
    const normal = render(ExitConfirmDialog, { props: { items, saving: false } });
    await fireEvent.keyDown(document, { key: "Escape" });
    expect(normal.emitted().cancel).toHaveLength(1);
    const saving = render(ExitConfirmDialog, { props: { items, saving: true } });
    await fireEvent.keyDown(document, { key: "Escape" });
    expect(saving.emitted().cancel).toBeUndefined();
  });
});
