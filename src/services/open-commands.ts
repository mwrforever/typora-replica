// 打开/另存对话框命令层（02 文档管理，F1 打开）
//
// dialog 插件封装：12 窗口外壳装配 File 菜单时直接调用本层命令；
// 02 阶段由 App 层快捷键/启动链路消费。取消返回 null（调用方忽略）。
import { open, save } from "@tauri-apps/plugin-dialog";

/** 打开单文件对话框（markdown 过滤）→ 选中路径或 null */
export async function openFileDialog(): Promise<string | null> {
  return open({
    multiple: false,
    title: "打开 Markdown 文件",
    filters: [{ name: "Markdown", extensions: ["md"] }],
  });
}

/** 打开文件夹对话框 → 选中目录或 null（F1-1 侧栏加载） */
export async function openFolderDialog(): Promise<string | null> {
  return open({ multiple: false, directory: true, title: "打开文件夹" });
}

/** 另存为对话框 → 目标路径或 null */
export async function saveAsDialog(defaultPath?: string): Promise<string | null> {
  return save({
    title: "另存为",
    defaultPath,
    filters: [{ name: "Markdown", extensions: ["md"] }],
  });
}
