// 启动行为决策（02 文档管理，F14）
//
// 优先级（已锁定）：--new > --reopen-file > 设置模式。恢复目标不存在时
// 回退新建并携带提示（AC-F14-4/F1-3：提示不崩溃，由 App 层展示）。
// 纯函数：exists 探测注入（App 层用 probePathExists 实现——listDir 优先；
// 测试用假函数）。
import type { CliArgs } from "./file-io";
import type { AppSettings } from "./settings";

/** 启动决策结果（App.vue 依据 action 装配初始文档） */
export type LaunchDecision =
  | { action: "new"; notice?: string }
  | { action: "open-file"; path: string; restoreFolder?: boolean; notice?: string }
  | { action: "open-folder"; path: string; notice?: string };

/**
 * 解析启动决策
 * @param cli 命令行参数（get_cli_args 结果）
 * @param settings 当前偏好
 * @param exists 路径存在性探测（注入：真实实现 probePathExists，listDir 优先）
 * @returns 启动动作（回退新建时携带提示文本）；open-file 的 restoreFolder
 *          标记 restore-both 恢复文件夹意图（--reopen-file 不携带）
 */
export async function resolveLaunch(
  cli: CliArgs,
  settings: AppSettings,
  exists: (path: string) => Promise<boolean>,
): Promise<LaunchDecision> {
  // 命令行覆盖优先：--new 恒新建（AC-F14-3）
  if (cli.new) return { action: "new" };
  // --reopen-file 打开指定文件；不存在回退新建并提示（AC-F1-3）。
  // 不携带 restoreFolder：仅打开指定文件，不恢复上次文件夹（Q 修复，
  // 避免陈旧 lastFolder 污染最近文件列表）
  if (cli.reopenFile) {
    if (await exists(cli.reopenFile)) return { action: "open-file", path: cli.reopenFile };
    return { action: "new", notice: `启动文件不存在，已新建文档：${cli.reopenFile}` };
  }
  switch (settings.launch.mode) {
    case "new":
      return { action: "new" };
    case "restore-folder": {
      const folder = settings.launch.lastFolder;
      if (folder && (await exists(folder))) return { action: "open-folder", path: folder };
      // AC-F14-4：恢复目标已不存在 → 回退新建并提示
      return { action: "new", notice: "上次打开的文件夹已不存在，已新建文档" };
    }
    case "restore-both": {
      const folder = settings.launch.lastFolder;
      const file = settings.launch.lastFile;
      if (folder && (await exists(folder))) {
        // 重开上次文件（文件夹由 App 层先行加载，见 Task 16 装配）
        if (file && (await exists(file))) {
          return { action: "open-file", path: file, restoreFolder: true };
        }
        return { action: "open-folder", path: folder };
      }
      return { action: "new", notice: "上次打开的文件夹已不存在，已新建文档" };
    }
    case "custom-folder": {
      const custom = settings.launch.customPath;
      if (custom && (await exists(custom))) return { action: "open-folder", path: custom };
      return { action: "new", notice: "自定义文件夹已不存在，已新建文档" };
    }
  }
}
