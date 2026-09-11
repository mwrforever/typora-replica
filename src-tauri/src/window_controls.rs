//! 窗口控制命令（12 窗口外壳 W3，AC-M-13~16）
//!
//! 全屏切换 / 置顶切换 / WebView 缩放 / 新建窗口的 IPC 面。spec §5 定案走
//! 自定义 Rust command 而非 JS core setter（调研报告 R3：自定义命令的授权面
//! 比 `core:window`/`core:webview` setter 白名单更小，且 mock 运行时可直呼测试）。
//! 命令层薄壳：状态读取 + 平台 API 调用 + 错误映射，无独立服务下沉面。
//! 全部命令操作轻量无阻塞 IO（A.3.4：同步 command 可接受）；窗口参数由 Tauri
//! 注入「发起 invoke 的窗口」，置顶/全屏/缩放天然仅作用于当前窗口（AC-M-15）。
use serde::Serialize;
// 存活窗口表查询（next_window_label 判定 label 占用）经 Manager trait 提供
use tauri::Manager;

/// 缩放档位下界（spec：范围自定 50%-200% 的下限；前端档位状态机同值，双端钳制）
const ZOOM_SCALE_MIN: f64 = 0.5;
/// 缩放档位上界（200%；前端越界请求在此收敛，防御纵深）
const ZOOM_SCALE_MAX: f64 = 2.0;

/// 窗口控制操作错误枚举（A.3.3：thiserror 派生 + 自定义 Serialize 输出中文消息
/// 字符串；消息只含操作语义与平台错误摘要，不含窗口句柄等敏感信息）
#[derive(Debug, PartialEq, thiserror::Error)]
pub enum WindowControlError {
    /// 全屏状态读取或切换失败（平台层返回错误）
    #[error("全屏切换失败: {0}")]
    Fullscreen(String),
    /// 置顶状态读取或切换失败（平台层返回错误）
    #[error("窗口置顶切换失败: {0}")]
    AlwaysOnTop(String),
    /// 缩放设置失败（平台层返回错误）
    #[error("缩放设置失败: {0}")]
    Zoom(String),
    /// 新窗口创建失败（label 冲突、平台创建失败等）
    #[error("新建窗口失败: {0}")]
    CreateWindow(String),
}

impl Serialize for WindowControlError {
    /// 序列化为 Display 中文消息字符串（前端 catch string 形态消费，与既有错误契约一致）
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

/// 切换全屏状态（AC-M-13：F11 全屏 toggle；返回切换后的新状态供前端状态机镜像）
///
/// 读取当前全屏态取反后设置；前端据此联动菜单栏显隐（进入全屏隐藏、退出恢复）。
/// `window` 为目标窗口（发起 invoke 的窗口，由 Tauri 注入）。
/// 返回切换后的全屏态（true = 已进入全屏）；Err 表示平台调用失败。
#[tauri::command]
pub fn toggle_fullscreen<R: tauri::Runtime>(
    window: tauri::WebviewWindow<R>,
) -> Result<bool, WindowControlError> {
    let current = window
        .is_fullscreen()
        .map_err(|e| WindowControlError::Fullscreen(e.to_string()))?;
    let next = !current;
    window.set_fullscreen(next).map(|_| next).map_err(|e| {
        eprintln!("[MarkWell] 全屏切换失败（当前={current}）: {e}");
        WindowControlError::Fullscreen(e.to_string())
    })
}

/// 查询当前窗口全屏态（AC-M-17 启动对齐：window-state 插件恢复全屏后前端
/// 首次装配读此值同步菜单栏隐藏，使「全屏即隐菜单」语义覆盖重启恢复路径）
///
/// `window` 为目标窗口（发起 invoke 的窗口，由 Tauri 注入）。返回当前全屏态。
#[tauri::command]
pub fn is_window_fullscreen<R: tauri::Runtime>(
    window: tauri::WebviewWindow<R>,
) -> Result<bool, WindowControlError> {
    window
        .is_fullscreen()
        .map_err(|e| WindowControlError::Fullscreen(e.to_string()))
}

/// 切换窗口置顶（AC-M-15：Always on Top 菜单项；仅作用于发起 invoke 的当前窗口）
///
/// `window` 为目标窗口（发起 invoke 的窗口，由 Tauri 注入）。
/// 返回切换后的置顶态（true = 置顶生效中）；Err 表示平台调用失败。
#[tauri::command]
pub fn toggle_always_on_top<R: tauri::Runtime>(
    window: tauri::WebviewWindow<R>,
) -> Result<bool, WindowControlError> {
    let current = window
        .is_always_on_top()
        .map_err(|e| WindowControlError::AlwaysOnTop(e.to_string()))?;
    let next = !current;
    window.set_always_on_top(next).map(|_| next).map_err(|e| {
        eprintln!("[MarkWell] 窗口置顶切换失败（当前={current}）: {e}");
        WindowControlError::AlwaysOnTop(e.to_string())
    })
}

/// 缩放档位钳制（WebView setZoom 的合法区间收敛；独立成纯函数供单测钉住边界）
fn clamp_zoom_scale(scale: f64) -> f64 {
    scale.clamp(ZOOM_SCALE_MIN, ZOOM_SCALE_MAX)
}

/// 设置 WebView 整窗缩放（AC-M-14：Ctrl+Shift+0/=/- 档位缩放，含侧栏整窗生效；
/// zoomHotkeys 保持关闭——缩放唯一通路为本命令，档位决策在前端状态机）
///
/// `scale` 为缩放系数（1.0 = 100%；前端越界取值在此钳制到 0.5~2.0）。
/// `window` 为目标窗口（发起 invoke 的窗口，由 Tauri 注入）。
/// 返回 Ok 表示设置完成；Err 表示参数非法（非有限数）或平台调用失败。
#[tauri::command]
pub fn set_webview_zoom<R: tauri::Runtime>(
    scale: f64,
    window: tauri::WebviewWindow<R>,
) -> Result<(), WindowControlError> {
    // 非有限数（NaN/±Inf）属调用方契约违反而非可钳制取值：f64::clamp 对 NaN
    // 原样返回 NaN，静默下发会让 WebView 缩放进入未定义态——按 A.3.3 错误契约
    // 显式 reject，前端记录告警并回滚档位（收敛 1.0 反而掩盖调用方缺陷）
    if !scale.is_finite() {
        eprintln!("[MarkWell] 缩放设置失败（scale={scale}）: 缩放系数须为有限数");
        return Err(WindowControlError::Zoom("缩放系数须为有限数".to_string()));
    }
    // 双端钳制：前端档位状态机已限定 50%-200%，此处对 IPC 层越界值再收敛一次
    window.set_zoom(clamp_zoom_scale(scale)).map_err(|e| {
        eprintln!("[MarkWell] 缩放设置失败（scale={scale}）: {e}");
        WindowControlError::Zoom(e.to_string())
    })
}

/// 生成下一个可用的新窗口 label（main-2 起递增，跳过存活窗口占用；
/// 关闭释放的 label 允许复用——window-state 插件按 label 分键，复用即恢复该 label
/// 上次的窗口状态，与主窗口重启恢复语义一致）
///
/// `app` 为应用句柄（查询存活窗口表）。返回未被占用的窗口 label（如 main-2、main-3）。
fn next_window_label<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> String {
    let mut n = 2;
    while app.get_webview_window(&format!("main-{n}")).is_some() {
        n += 1;
    }
    format!("main-{n}")
}

/// 新建应用窗口（AC-M-16：New Window Ctrl+Shift+N；初始空文档——新窗口是独立
/// WebView 加载同一前端产物，main.ts/App.vue 在该窗口独立执行，Pinia/多标签/菜单
/// 装配天然按窗口隔离；空文档由前端 isMainWindow 门控给出——次窗口不走启动决策链，
/// 恒 createUntitled 新建空文档标签，cli 参数/重启恢复偏好属主窗口启动语义）
///
/// `app` 为应用句柄（窗口创建挂靠点）。返回新窗口 label（前端日志/调试标识）。
#[tauri::command]
pub fn create_main_window<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<String, WindowControlError> {
    let label = next_window_label(&app);
    // 初值对齐 tauri.conf.json windows[0]（标题/尺寸），加载同一前端产物
    //（WebviewUrl::default() = 应用入口 index.html，dev 模式由 devUrl 承接）
    let built = tauri::WebviewWindowBuilder::new(&app, &label, tauri::WebviewUrl::default())
        .title("typora-replica")
        .inner_size(800.0, 600.0)
        .build();
    match built {
        Ok(_) => {
            eprintln!("[MarkWell] 新窗口已创建: {label}");
            Ok(label)
        }
        Err(e) => {
            eprintln!("[MarkWell] 新窗口创建失败（label={label}）: {e}");
            Err(WindowControlError::CreateWindow(e.to_string()))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 构造挂载 mock 运行时的应用（A.6.5：tauri features:test 直呼命令测试）
    fn mock_app() -> tauri::App<tauri::test::MockRuntime> {
        tauri::test::mock_app()
    }

    #[test]
    fn toggle_fullscreen_returns_flipped_state_true_on_non_fullscreen_window() {
        // mock 运行时窗口初始非全屏（is_fullscreen 恒 false）：toggle 契约 = 返回取反后的新状态
        let app = mock_app();
        let window = tauri::WebviewWindowBuilder::new(&app, "main", tauri::WebviewUrl::default())
            .build()
            .expect("mock 运行时创建测试窗口失败");
        assert_eq!(toggle_fullscreen(window), Ok(true));
    }

    #[test]
    fn is_window_fullscreen_reports_current_state_false_on_mock_window() {
        // 查询契约：mock 窗口初始非全屏 → Ok(false)（启动对齐消费的返回序列化形态）
        let app = mock_app();
        let window = tauri::WebviewWindowBuilder::new(&app, "main", tauri::WebviewUrl::default())
            .build()
            .expect("mock 运行时创建测试窗口失败");
        assert_eq!(is_window_fullscreen(window), Ok(false));
    }

    #[test]
    fn toggle_always_on_top_returns_flipped_state_true_on_normal_window() {
        // 置顶 toggle 契约：初始非置顶（mock is_always_on_top 恒 false）→ 返回 true
        let app = mock_app();
        let window = tauri::WebviewWindowBuilder::new(&app, "main", tauri::WebviewUrl::default())
            .build()
            .expect("mock 运行时创建测试窗口失败");
        assert_eq!(toggle_always_on_top(window), Ok(true));
    }

    #[test]
    fn set_webview_zoom_accepts_in_range_and_clamps_out_of_range_scale() {
        // 缩放契约：区间内值直通；越界值经钳制后仍设置成功（防御纵深不 reject）
        let app = mock_app();
        let window = tauri::WebviewWindowBuilder::new(&app, "main", tauri::WebviewUrl::default())
            .build()
            .expect("mock 运行时创建测试窗口失败");
        assert_eq!(set_webview_zoom(1.25, window.clone()), Ok(()));
        assert_eq!(set_webview_zoom(9.9, window.clone()), Ok(()));
        assert_eq!(set_webview_zoom(0.01, window), Ok(()));
    }

    #[test]
    fn set_webview_zoom_rejects_non_finite_scale_with_zoom_error() {
        // NaN 契约：f64::clamp 对 NaN 原样放行，命令层显式拒绝（前端告警回滚路径）；
        // 错误消息携带可判读的中文语义（Zoom 变体前缀 + 原因）
        let app = mock_app();
        let window = tauri::WebviewWindowBuilder::new(&app, "main", tauri::WebviewUrl::default())
            .build()
            .expect("mock 运行时创建测试窗口失败");
        let result = set_webview_zoom(f64::NAN, window);
        assert_eq!(
            result,
            Err(WindowControlError::Zoom("缩放系数须为有限数".to_string()))
        );
    }

    #[test]
    fn clamp_zoom_scale_converges_to_50_200_bounds() {
        // 档位边界钉桩：50%-200% 区间外取值收敛到边界（spec 范围自定的双端约束）
        assert_eq!(clamp_zoom_scale(1.1), 1.1);
        assert_eq!(clamp_zoom_scale(0.3), ZOOM_SCALE_MIN);
        assert_eq!(clamp_zoom_scale(3.5), ZOOM_SCALE_MAX);
    }

    #[test]
    fn create_main_window_labels_increment_from_main_2() {
        // 新窗口 label 契约：首建 main-2，次建 main-3（跳过存活占用，AC-M-16）
        let app = mock_app();
        let first = create_main_window(app.handle().clone()).expect("首建新窗口失败");
        assert_eq!(first, "main-2");
        let second = create_main_window(app.handle().clone()).expect("二建新窗口失败");
        assert_eq!(second, "main-3");
        assert!(app.get_webview_window("main-2").is_some());
        assert!(app.get_webview_window("main-3").is_some());
    }

    #[test]
    fn next_window_label_skips_all_occupied_labels() {
        // label 占用判定：main-2/main-3 均存活时跳到 main-4（while 循环逐位跳过）。
        // 注：关闭释放后的复用在 mock 运行时不可观测——destroy 经事件循环异步注销
        // 窗口，单测无运行循环；释放即复用的语义由 tauri core 窗口注销 + 本循环读
        // 存活表保证，真机路径留 P4 E2E。
        let app = mock_app();
        for label in ["main-2", "main-3"] {
            tauri::WebviewWindowBuilder::new(&app, label, tauri::WebviewUrl::default())
                .build()
                .expect("mock 运行时创建测试窗口失败");
        }
        assert_eq!(next_window_label(app.handle()), "main-4");
    }

    #[test]
    fn window_control_error_message_is_chinese_and_serialized_as_string() {
        // 错误序列化契约：各变体 Display 中文消息 → 字符串（前端 catch 消费形态）
        let cases = [
            (
                WindowControlError::Fullscreen("x".into()),
                "全屏切换失败: x",
            ),
            (
                WindowControlError::AlwaysOnTop("x".into()),
                "窗口置顶切换失败: x",
            ),
            (WindowControlError::Zoom("x".into()), "缩放设置失败: x"),
            (
                WindowControlError::CreateWindow("x".into()),
                "新建窗口失败: x",
            ),
        ];
        for (err, message) in cases {
            assert_eq!(err.to_string(), message);
            let json = serde_json::to_string(&err).expect("错误序列化失败");
            assert_eq!(json, format!("\"{message}\""));
        }
    }
}
