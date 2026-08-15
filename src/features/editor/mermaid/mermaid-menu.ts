// 图表右键菜单：另存 SVG / 复制 SVG（E21）
//
// contextmenu 落在 mermaid 预览容器时显示自定义菜单。
import { saveSvgAsFile } from "../../../services/diagram-save";

/** 菜单容器类名 */
const MENU_CLASS = "markwell-mermaid-menu";

/**
 * 在指定坐标弹出图表右键菜单
 * @param svg SVG 内容（从预览容器提取）
 * @param x 菜单横坐标（页面坐标）
 * @param y 菜单纵坐标（页面坐标）
 */
export function showMermaidMenu(svg: string, x: number, y: number): void {
  closeMermaidMenu();
  const menu = document.createElement("div");
  menu.className = MENU_CLASS;
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;

  const copyItem = document.createElement("button");
  copyItem.textContent = "复制 SVG";
  copyItem.addEventListener("click", () => {
    // 复制 SVG 文本到剪贴板（WebView2 支持 navigator.clipboard）
    void navigator.clipboard.writeText(svg);
    closeMermaidMenu();
  });

  const saveItem = document.createElement("button");
  saveItem.textContent = "另存为 SVG";
  saveItem.addEventListener("click", () => {
    saveSvgAsFile(svg, "diagram");
    closeMermaidMenu();
  });

  menu.append(copyItem, saveItem);
  document.body.appendChild(menu);
  // 点击菜单外关闭
  setTimeout(() => {
    document.addEventListener("click", closeMermaidMenu, { once: true });
  });
}

/** 关闭已打开的菜单 */
export function closeMermaidMenu(): void {
  document.querySelector(`.${MENU_CLASS}`)?.remove();
}

/** contextmenu 事件处理入口（插件 handleDOMEvents 调用） */
export function handleMermaidContextMenu(event: MouseEvent): boolean {
  const target = event.target as HTMLElement | null;
  const preview = target?.closest(".markwell-mermaid-svg");
  if (!preview) return false;
  event.preventDefault();
  const svg = preview.querySelector("svg")?.outerHTML ?? "";
  showMermaidMenu(svg, event.clientX, event.clientY);
  return true;
}
