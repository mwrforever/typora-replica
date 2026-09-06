use std::collections::HashMap;
use std::sync::Mutex;

/// 应用级共享状态（02：目录监视句柄持有；06：全局搜索在途任务句柄；08：主题目录监视槽位）
pub struct AppState {
    /// 按路径的多槽监视句柄 Map（watch_dir 持活，防 drop 停止监视；
    /// key = 监视根目录路径；unwatch_dir 移除槽位即停止对应目录监视）
    pub watcher: Mutex<HashMap<String, notify::RecommendedWatcher>>,
    /// 06 全局搜索在途任务（search_in_folder 替换持活；cancel_search 置位清槽）
    pub search_job: Mutex<Option<io::search::SearchJobHandle>>,
    /// 08 主题目录监视槽位（单槽：watch_themes 重复调用替换旧句柄即停旧监视；
    /// 与文档监视多槽 Map 隔离——用户把 themes 目录当工作区打开时互不干扰）
    pub theme_watcher: Mutex<Option<notify::RecommendedWatcher>>,
}

pub mod devtools;
pub mod io;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 启动失败（环境错误、重复实例等）以错误信息退出而非 panic：
    // 库代码禁止 expect（AGENTS.md §3.6），run 返回 Err 属可恢复的启动失败路径
    if let Err(e) = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .manage(AppState {
            watcher: Mutex::new(HashMap::new()),
            search_job: Mutex::new(None),
            theme_watcher: Mutex::new(None),
        })
        .setup(|app| {
            // 08 主题：预置内置主题到数据目录 themes/（缺失才写，D-1）。
            // 预置失败仅记录不阻断启动（主题降级为空列表，编辑主链路不受影响；
            // 宪法 A.5.7：setup 返回 Err 表启动失败，此处属可降级路径不失败）
            let seeded = io::themes::themes_dir(app.handle())
                .and_then(|dir| io::themes::ensure_builtin_themes(&dir));
            if let Err(e) = seeded {
                eprintln!("[MarkWell] 内置主题预置失败（主题功能降级）: {e}");
            }
            Ok(())
        })
        // 命令随实现任务注册：Task 5 read_file/write_file/list_dir；
        // Task 6 save_draft/list_drafts/recover_draft（drafts.rs）；Task 7 watch_dir；
        // Task 13 get_cli_args；
        // 03 Task 2 create_file/create_dir/rename_path/duplicate_path/delete_to_trash（file_ops.rs）；
        // D2 前置 unwatch_dir（watch.rs，与 watch_dir 同模块）；
        // 06 P3 search_in_folder/cancel_search（search.rs）；
        // 07 save_image/import_local_images + Task 3 resolve_image_path/
        // allow_asset_directory（asset 协议运行时授权，images.rs）
        .invoke_handler(tauri::generate_handler![
            io::commands::get_cli_args,
            io::commands::read_file,
            io::commands::write_file,
            io::commands::list_dir,
            io::commands::create_file,
            io::commands::create_dir,
            io::commands::rename_path,
            io::commands::duplicate_path,
            io::commands::delete_to_trash,
            io::drafts::save_draft_cmd,
            io::drafts::list_drafts_cmd,
            io::drafts::recover_draft_cmd,
            io::watch::watch_dir,
            io::watch::unwatch_dir,
            io::search::search_in_folder,
            io::search::cancel_search,
            io::images::save_image,
            io::images::import_local_images,
            io::images::resolve_image_path,
            io::images::allow_asset_directory,
            io::themes::list_themes,
            io::themes::open_theme_folder,
            io::themes::watch_themes,
            // 08 T7 DevTools 开关（devtools.rs）：debug 构建可用，release 须 devtools
            // feature（未启用时命令无操作返回 false）
            devtools::toggle_devtools
        ])
        .run(tauri::generate_context!())
    {
        eprintln!("应用启动失败: {e}");
        std::process::exit(1);
    }
}
