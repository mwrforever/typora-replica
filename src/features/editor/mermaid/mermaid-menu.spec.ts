// 图表右键菜单：另存/复制行为与点击处定位（100% 覆盖）
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent } from "@testing-library/dom";
import { describe, expect, it, vi } from "vitest";
import { closeMermaidMenu, handleMermaidContextMenu, showMermaidMenu } from "./mermaid-menu";

vi.mock("../../../services/diagram-save", () => ({ saveSvgAsFile: vi.fn() }));
import { saveSvgAsFile } from "../../../services/diagram-save";

describe("图表右键菜单", () => {
  it("AC-E21-5 contextmenu 落在图表上弹出含另存/复制的菜单", () => {
    const container = document.createElement("div");
    container.innerHTML = '<div class="markwell-mermaid-svg"><svg></svg></div>';
    document.body.appendChild(container);
    const event = new MouseEvent("contextmenu", {
      bubbles: true,
      clientX: 10,
      clientY: 20,
      cancelable: true,
    });
    // 先派发再直呼处理器：构造的 MouseEvent 在派发前 target 为 null，
    // 处理器依赖 event.target 反查图表容器（真实链路中由 ProseMirror
    // handleDOMEvents 在派发过程中调用，target 即被点击的图表元素）
    const chartEl = container.querySelector(".markwell-mermaid-svg")!;
    chartEl.dispatchEvent(event);
    const consumed = handleMermaidContextMenu(event);
    expect(consumed).toBe(true);
    const menu = document.querySelector<HTMLElement>(".markwell-mermaid-menu");
    expect(menu?.textContent).toContain("另存为 SVG");
    expect(menu?.textContent).toContain("复制 SVG");
    // AC-E21-5 点击处弹出：菜单 left/top 取事件 clientX/clientY（CSS position: fixed 见样式守卫例）
    expect(menu?.style.left).toBe("10px");
    expect(menu?.style.top).toBe("20px");
    closeMermaidMenu();
  });

  it("菜单定位样式守卫：crepe-overrides.css 含 fixed 定位与 z-index（jsdom 不加载 CSS，直读样式文件断言）", () => {
    // 审查发现：菜单静态定位时 left/top 被忽略，渲染到文档流末尾；定位样式在样式文件而非
    // 内联样式里，jsdom 的 getComputedStyle 反映不了，故直读文件断言规则存在，防止回归
    // （vitest 按项目根目录运行，resolve 相对 process.cwd() 取样式文件）
    const css = readFileSync(resolve("src/styles/crepe-overrides.css"), "utf8");
    const menuRule = css.match(/\.markwell-mermaid-menu\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(menuRule).toContain("position: fixed");
    expect(menuRule).toContain("z-index");
    // 按钮 hover 主色调（--crepe-color-primary）的规则同样存在
    expect(css).toMatch(/\.markwell-mermaid-menu button:hover/);
  });

  it("非图表区域的 contextmenu 不消费事件", () => {
    const event = new MouseEvent("contextmenu", { bubbles: true });
    expect(handleMermaidContextMenu(event)).toBe(false);
  });

  it("图表容器内无 svg 元素时以空字符串兜底，菜单仍弹出", () => {
    // 渲染异常/空图表的防御分支：outerHTML 提取不到 svg 时降级为空串，不抛错
    const container = document.createElement("div");
    container.innerHTML = '<div class="markwell-mermaid-svg"></div>';
    document.body.appendChild(container);
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    container.firstElementChild!.dispatchEvent(event);
    expect(handleMermaidContextMenu(event)).toBe(true);
    expect(document.querySelector(".markwell-mermaid-menu")).not.toBeNull();
    closeMermaidMenu();
  });

  it("点击「另存为 SVG」调用保存服务", () => {
    showMermaidMenu("<svg></svg>", 0, 0);
    const saveBtn = [...document.querySelectorAll(".markwell-mermaid-menu button")].find((b) =>
      b.textContent?.includes("另存"),
    )!;
    fireEvent.click(saveBtn);
    expect(vi.mocked(saveSvgAsFile)).toHaveBeenCalledWith("<svg></svg>", "diagram");
  });

  it("点击「复制 SVG」写入剪贴板", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    showMermaidMenu("<svg></svg>", 0, 0);
    const copyBtn = [...document.querySelectorAll(".markwell-mermaid-menu button")].find((b) =>
      b.textContent?.includes("复制"),
    )!;
    fireEvent.click(copyBtn);
    expect(writeText).toHaveBeenCalledWith("<svg></svg>");
  });
});
