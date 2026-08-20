// 关闭确认弹窗组件测试（04 C2：三按钮「保存/不保存/取消」分支）
//
// 覆盖：三按钮渲染（AC-C2-1 文案带标题提示）；点击各按钮分别 emit
// save/discard/cancel（上层 controller 按分支执行关闭/丢弃/中止）。
import { fireEvent, render, screen } from "@testing-library/vue";
import { describe, expect, it } from "vitest";
import ConfirmCloseDialog from "./ConfirmCloseDialog.vue";

describe("ConfirmCloseDialog 关闭确认", () => {
  it("渲染三按钮：保存/不保存/取消（AC-C2-1）", () => {
    render(ConfirmCloseDialog, { props: { title: "a.md" } });
    expect(screen.getByText("保存")).toBeInTheDocument();
    expect(screen.getByText("不保存")).toBeInTheDocument();
    expect(screen.getByText("取消")).toBeInTheDocument();
    // 提示文案携带标题（用户识别目标标签）
    expect(screen.getByText("a.md 有未保存的更改，是否保存？")).toBeInTheDocument();
  });

  it("点击保存 emit save；不保存 emit discard；取消 emit cancel", async () => {
    const { emitted } = render(ConfirmCloseDialog, { props: { title: "a.md" } });
    await fireEvent.click(screen.getByText("保存"));
    expect(emitted().save).toHaveLength(1);
    await fireEvent.click(screen.getByText("不保存"));
    expect(emitted().discard).toHaveLength(1);
    await fireEvent.click(screen.getByText("取消"));
    expect(emitted().cancel).toHaveLength(1);
  });
});
