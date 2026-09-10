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
pub mod window_controls;
pub mod window_menu;

/// window-state 插件恢复/保存的状态位（12 W3，AC-M-17）：尺寸/位置/最大化/可见性与
/// FULLSCREEN。spec 明确要求「全屏状态退出应用再启动恢复全屏」，状态位缺 FULLSCREEN
/// 即静默失去该恢复语义；显式枚举（非 all()）防插件后续新增位静默扩权
fn window_state_flags() -> tauri_plugin_window_state::StateFlags {
    use tauri_plugin_window_state::StateFlags;
    StateFlags::SIZE
        | StateFlags::POSITION
        | StateFlags::MAXIMIZED
        | StateFlags::FULLSCREEN
        | StateFlags::VISIBLE
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 启动失败（环境错误、重复实例等）以错误信息退出而非 panic：
    // 库代码禁止 expect（AGENTS.md §3.6），run 返回 Err 属可恢复的启动失败路径
    if let Err(e) = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        // 12 W3 窗口状态持久化（AC-M-17）：按窗口 label 分键落盘，窗口创建时自动恢复
        // （插件注册只在 Builder 链，A.5.7）
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(window_state_flags())
                .build(),
        )
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
        // allow_asset_directory（asset 协议运行时授权，images.rs）；
        // 09 export_pdf（pdf.rs）
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
            io::themes::unwatch_themes,
            // 09 PDF 导出（pdf.rs）：隐藏 WebView2 打印管线（PrintToPdfStream）
            io::pdf::export_pdf,
            // 10 高级设置（advanced_settings.rs）：conf.user.json 注释剥离解析 + 行级合并写回
            io::advanced_settings::read_advanced_settings,
            io::advanced_settings::write_advanced_settings,
            io::advanced_settings::reset_advanced_settings,
            io::advanced_settings::open_advanced_settings,
            // 08 T7 DevTools 开关（devtools.rs）：debug 构建可用，release 须 devtools
            // feature（未启用时命令无操作返回 false）
            devtools::toggle_devtools,
            // 12 W2 原生菜单栏显隐（window_menu.rs）：autoHideMenuBar Alt 切换链路
            window_menu::set_native_menu_visible,
            // 12 W3 窗口控制（window_controls.rs）：全屏/置顶/缩放/新建窗口/全屏态查询
            window_controls::toggle_fullscreen,
            window_controls::is_window_fullscreen,
            window_controls::toggle_always_on_top,
            window_controls::set_webview_zoom,
            window_controls::create_main_window
        ])
        .run(tauri::generate_context!())
    {
        eprintln!("应用启动失败: {e}");
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn window_state_flags_contains_fullscreen_for_restart_restore() {
        // AC-M-17 配置断言：window-state 状态位必须含 FULLSCREEN——
        // 缺位 = 全屏态退出再启动不恢复（spec §2 窗口控制明确要求）
        assert!(window_state_flags().contains(tauri_plugin_window_state::StateFlags::FULLSCREEN));
    }
}
