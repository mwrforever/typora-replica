//! 原生菜单栏显隐命令（12 窗口外壳 W2，AC-M-5）
//!
//! autoHideMenuBar 的 Alt 单按切换链路：前端构建菜单经 @tauri-apps/api menu
//! （setAsWindowMenu），显隐切换无法从 JS 侧完成（JS Window 无 setMenu/removeMenu），
//! 由本薄命令包装 `WebviewWindow::hide_menu` / `show_menu` 完成菜单栏的隐藏与恢复。
//! hide/show 仅隐藏原生菜单栏不销毁菜单资源（区别于 remove_menu），再次 show 即原地恢复。
//! 菜单操作轻量无阻塞 IO（A.3.4：同步 command 可接受）；命令层薄壳，无独立服务下沉面。
use serde::Serialize;

/// 菜单栏显隐操作错误枚举（A.3.3：thiserror 派生 + 自定义 Serialize 输出中文消息字符串；
/// 消息不含窗口内部句柄等敏感信息）
#[derive(Debug, PartialEq, thiserror::Error)]
pub enum NativeMenuError {
    /// 原生菜单栏显隐调用失败（平台层返回错误）
    #[error("菜单栏显隐切换失败: {0}")]
    Operation(String),
}

impl Serialize for NativeMenuError {
    /// 序列化为 Display 中文消息字符串（前端 catch string 形态消费，与既有错误契约一致）
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

/// 设置原生菜单栏可见性（AC-M-5：autoHideMenuBar 开启时 Alt 单按切换显隐）
///
/// @param visible true = 显示菜单栏（show_menu）；false = 隐藏菜单栏（hide_menu）
/// @window 目标窗口（单窗口形态恒为主窗口，由 Tauri 注入）
/// @returns Ok = 切换完成；Err = 平台调用失败（前端记录告警，不阻断交互）
// 泛型运行时（与 search_in_folder 同型）：tauri features:test mock 运行时直呼命令测试（A.6.5）
#[tauri::command]
pub fn set_native_menu_visible<R: tauri::Runtime>(
    visible: bool,
    window: tauri::WebviewWindow<R>,
) -> Result<(), NativeMenuError> {
    let result = if visible {
        window.show_menu()
    } else {
        window.hide_menu()
    };
    result.map_err(|e| {
        eprintln!("[MarkWell] 菜单栏显隐切换失败（visible={visible}）: {e}");
        NativeMenuError::Operation(e.to_string())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 构造挂载 mock 运行时的应用（A.6.5：tauri features:test 直呼命令测试）
    fn mock_app() -> tauri::App<tauri::test::MockRuntime> {
        tauri::test::mock_app()
    }

    #[test]
    fn set_native_menu_visible_show_and_hide_succeed_on_menuless_window() {
        // mock 运行时窗口无挂载菜单：hide/show 走 menu_lock 空分支幂等返回，
        // 断言命令契约两态均 Ok（错误分支仅平台层调用失败时产生）
        let app = mock_app();
        let window = tauri::WebviewWindowBuilder::new(&app, "main", tauri::WebviewUrl::default())
            .build()
            .expect("mock 运行时创建测试窗口失败");
        assert_eq!(set_native_menu_visible(true, window.clone()), Ok(()));
        assert_eq!(set_native_menu_visible(false, window), Ok(()));
    }

    #[test]
    fn native_menu_error_message_is_chinese_and_serialized_as_string() {
        // 错误序列化契约：Display 中文消息 → 字符串（前端 catch 消费形态）
        let err = NativeMenuError::Operation("平台错误".to_string());
        assert_eq!(err.to_string(), "菜单栏显隐切换失败: 平台错误");
        let json = serde_json::to_string(&err).expect("错误序列化失败");
        assert_eq!(json, "\"菜单栏显隐切换失败: 平台错误\"");
    }
}
