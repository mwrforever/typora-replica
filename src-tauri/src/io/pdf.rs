//! PDF 导出命令（09 X2）
//!
//! 管线：前端生成完整导出 HTML（含 @page 页眉页脚 CSS）→ 本命令写入临时文件 →
//! 隐藏 WebView2 窗口加载 → ICoreWebView2_16::PrintToPdfStream 打印为 IStream →
//! 读字节经临时文件原子改名落盘 → 销毁隐藏窗口。
//! 重 IO 全程 spawn_blocking（宪法 A.3.4）；错误契约按 A.3.3 枚举化（ExportPdfError，
//! thiserror 派生 + 自定义 Serialize 输出中文消息字符串——前端消费形态与既有
//! string 错误一致，错误面不含完整内部路径）。
//! PDF 书签首版不做（PrintToPdfStream 无书签面，spec 允许降级，用户拍板）。
use serde::Serialize;
// callback 类型经 webview2_com crate 根再导出（callback 模块本身私有）
use webview2_com::Microsoft::Web::WebView2::Win32::{
    ICoreWebView2Controller, ICoreWebView2Environment6, ICoreWebView2PrintSettings,
    ICoreWebView2_16, ICoreWebView2_2,
};
use webview2_com::{NavigationCompletedEventHandler, PrintToPdfStreamCompletedHandler};
use windows::Win32::System::Com::IStream;
use windows_core::{Interface, BOOL, HSTRING};

/// 打印结果等待上限：超时视为管线卡死，关窗报错（秒）
const PRINT_TIMEOUT_SECS: u64 = 60;

/// PDF 默认页边距（英寸；与前端导出样式对齐）
const PDF_MARGIN_IN: f64 = 0.4;

/// IStream 读取缓冲（64KB 分块循环读，避免一次性申请 PDF 全量缓冲）
const STREAM_CHUNK_BYTES: usize = 64 * 1024;

/// PDF 打印设置 DTO（wire camelCase；与前端 PdfPrintSettingsDto 1:1）
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfPrintSettingsDto {
    /// 打印背景（暗色主题跟随载体，AC-X2-4）
    pub print_background: bool,
    /// 纸宽（英寸）
    pub page_width_in: f64,
    /// 纸高（英寸）
    pub page_height_in: f64,
}

/// PDF 导出错误枚举（A.3.3：thiserror + Serialize；消息中文、不含内部完整路径）
#[derive(Debug, thiserror::Error)]
pub enum ExportPdfError {
    /// 导出临时 HTML 写入失败
    #[error("写入导出临时文件失败: {0}")]
    TempWrite(std::io::Error),
    /// 隐藏导出窗口创建失败
    #[error("创建导出隐藏窗口失败: {0}")]
    WindowBuild(String),
    /// 导出临时 HTML 路径非法
    #[error("导出临时 HTML 路径非法")]
    InvalidTempUrl,
    /// 导出页面加载/导航失败
    #[error("导出页面加载失败: {0}")]
    Navigation(String),
    /// WebView2 打印接口调用失败
    #[error("打印接口调用失败: {0}")]
    Print(String),
    /// PDF 流读取失败
    #[error("PDF 流读取失败: {0}")]
    StreamRead(String),
    /// 打印超时（60s）
    #[error("PDF 打印超时（60s）")]
    Timeout,
    /// PDF 落盘失败
    #[error("PDF 落盘失败: {0}")]
    Persist(String),
    /// 主线程调度失败（with_webview）
    #[error("调度导出窗口任务失败: {0}")]
    Dispatch(String),
    /// 打印任务异常终止（join）
    #[error("PDF 导出任务异常终止: {0}")]
    Join(String),
}

impl Serialize for ExportPdfError {
    /// 自定义序列化：输出 Display 中文消息字符串（前端 catch string 形态消费）
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

/// PDF 导出命令（重 IO：临时文件写入 + WebView2 打印 + 流读取，异步线程池执行）
///
/// 执行流程：整段管线移交阻塞线程池（A.3.4，命令线程立即返回）→ 临时 HTML 落盘 →
/// 隐藏窗口打印 → 字节原子落盘到目标路径（覆盖语义）→ 清理临时 HTML。
///
/// # 参数（wire camelCase，前端 pdf-export.ts 已锁定）
/// - `html_content`：完整导出 HTML（前端管线产物，含 @page CSS）
/// - `settings`：打印设置（纸张英寸尺寸 / 打印背景）
/// - `output_path`：PDF 目标落盘路径（覆盖语义：临时文件 + rename）
///
/// # 返回值
/// - `Ok(())`：PDF 已落盘
/// - `Err(ExportPdfError)`：Promise reject 为中文消息字符串（Serialize 定制）
///
/// # 异常
/// 任何管线环节失败（临时文件 / 窗口创建 / 导航 / 打印 / 读流 / 落盘）均收敛为
/// 枚举错误上抛，不 panic、不残留隐藏窗口与临时文件
#[tauri::command]
pub async fn export_pdf(
    app: tauri::AppHandle<tauri::Wry>,
    html_content: String,
    settings: PdfPrintSettingsDto,
    output_path: String,
) -> Result<(), ExportPdfError> {
    // 日志只带文件名，不落完整路径（B.5.2 日志安全）
    let output_name = std::path::Path::new(&output_path)
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| output_path.clone());
    eprintln!(
        "[MarkWell] PDF 导出任务开始（输出文件={output_name}，页面={}x{}in，背景={}）",
        settings.page_width_in, settings.page_height_in, settings.print_background
    );
    // 重 IO 移交阻塞线程池，命令线程立即返回（宪法 A.3.4）
    tauri::async_runtime::spawn_blocking(move || {
        print_html_to_pdf(&app, &html_content, &settings, &output_path)
    })
    .await
    .map_err(|e| ExportPdfError::Join(e.to_string()))?
}

/// 打印管线同步实现（运行于阻塞线程池线程）
///
/// # 参数
/// - `app`：应用句柄（用于创建隐藏导出窗口）
/// - `html_content`：完整导出 HTML 字符串
/// - `settings`：打印设置
/// - `output_path`：PDF 目标路径
///
/// # 返回值
/// - `Ok(())`：落盘成功
/// - `Err`：任一环节失败；临时 HTML 无论成败都会清理
fn print_html_to_pdf(
    app: &tauri::AppHandle<tauri::Wry>,
    html_content: &str,
    settings: &PdfPrintSettingsDto,
    output_path: &str,
) -> Result<(), ExportPdfError> {
    // 1. HTML 写临时文件（系统临时目录 + 进程 id + 毫秒时间戳命名，防并发互踩）
    let temp_html = std::env::temp_dir().join(format!(
        "markwell-export-{}-{}.html",
        std::process::id(),
        unix_millis()
    ));
    std::fs::write(&temp_html, html_content).map_err(ExportPdfError::TempWrite)?;
    // 2. 隐藏窗口打印取回 PDF 字节；成败都要清理临时 HTML（清理失败仅记日志，
    //    不掩盖主流程错误——残留物在系统临时目录，无业务危害）
    let result = print_via_webview(app, &temp_html, settings)
        .and_then(|bytes| write_pdf_bytes(std::path::Path::new(output_path), &bytes));
    if let Err(e) = std::fs::remove_file(&temp_html) {
        eprintln!(
            "[MarkWell] 清理导出临时 HTML 失败（{}）: {e}",
            temp_html.display()
        );
    }
    match &result {
        Ok(()) => eprintln!(
            "[MarkWell] PDF 导出完成（输出文件={output_name_part}）",
            output_name_part = std::path::Path::new(output_path)
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default()
        ),
        Err(e) => eprintln!("[MarkWell] PDF 导出失败: {e}"),
    }
    result
}

/// 隐藏窗口打印编排：建窗 → 主线程 COM 注册回调并导航 → 阻塞等打印字节
///
/// # 参数
/// - `app`：应用句柄
/// - `html_path`：导出临时 HTML 绝对路径（内部转 file:// URL）
/// - `settings`：打印设置
///
/// # 返回值
/// - `Ok(bytes)`：打印完成的 PDF 字节
/// - `Err`：建窗 / 调度 / 导航 / 打印 / 读流 / 超时错误
///
/// # 线程模型
/// 本函数运行于阻塞线程池；COM 调用全部在 `with_webview` 调度的主线程闭包内执行
/// （WebView2 STA 要求）；结果经 mpsc 信道跨线程送回，等待上限 60s
fn print_via_webview(
    app: &tauri::AppHandle<tauri::Wry>,
    html_path: &std::path::Path,
    settings: &PdfPrintSettingsDto,
) -> Result<Vec<u8>, ExportPdfError> {
    // 打印结果信道：COM 回调线程（主线程）→ 阻塞线程
    let (tx, rx) = std::sync::mpsc::channel::<Result<Vec<u8>, ExportPdfError>>();
    // 路径转 file:// URL（非法路径在此显式失败，不进建窗流程）
    let file_url =
        tauri::Url::from_file_path(html_path).map_err(|()| ExportPdfError::InvalidTempUrl)?;
    let url_text = file_url.as_str().to_string();
    // 窗口 label 带毫秒时间戳保证并发导出唯一（重复 label 会建窗失败）
    let label = format!("markwell-export-{}", unix_millis());
    let window = tauri::WebviewWindowBuilder::new(
        app,
        label.as_str(),
        tauri::WebviewUrl::External(file_url),
    )
    .title("MarkWell 导出")
    .visible(false)
    .build()
    .map_err(|e| ExportPdfError::WindowBuild(e.to_string()))?;
    eprintln!("[MarkWell] 导出隐藏窗口已创建（label={label}）");

    // 主线程 COM 编排（闭包内失败经信道即时回传，不等超时）
    let dispatch_result = {
        let tx = tx.clone();
        let settings = settings.clone();
        window.with_webview(move |platform| {
            if let Err(e) =
                begin_print_on_main_thread(platform.controller(), tx.clone(), &settings, url_text)
            {
                let _ = tx.send(Err(e));
            }
        })
    };
    if let Err(e) = dispatch_result {
        // 调度失败意味着闭包不会执行、无人发送结果——立即关窗并返回
        let _ = window.close();
        return Err(ExportPdfError::Dispatch(e.to_string()));
    }

    // 阻塞等打印结果（60s 上限）；所有分支统一关窗，不留隐藏窗口残留
    let outcome = match rx.recv_timeout(std::time::Duration::from_secs(PRINT_TIMEOUT_SECS)) {
        Ok(Ok(bytes)) => Ok(bytes),
        Ok(Err(e)) => Err(e),
        Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
            eprintln!("[MarkWell] PDF 打印超时（{PRINT_TIMEOUT_SECS}s，label={label}）");
            Err(ExportPdfError::Timeout)
        }
        // 信道关闭而未收到结果：主线程闭包提前消亡（如窗口被系统销毁）
        Err(_) => Err(ExportPdfError::Print(
            "打印任务异常中断（导出窗口提前关闭）".to_string(),
        )),
    };
    let _ = window.close();
    outcome
}

/// 主线程 COM 编排：注册导航完成回调（回调内发起 PrintToPdfStream）→ Navigate 启动加载
///
/// # 参数
/// - `controller`：Tauri 交付的 WebView2 控制器
/// - `tx`：打印结果发送端（成功与失败都经它回传）
/// - `settings`：打印设置（纸张尺寸 / 背景）
/// - `file_url`：导出临时 HTML 的 file:// URL 文本
///
/// # 返回值
/// - `Ok(())`：打印已成功发起，结果由 PrintToPdfStream 完成回调经 tx 回传
/// - `Err`：同步阶段（取 WebView / 取环境 / 设打印参数 / 注册回调 / 发起导航）失败
fn begin_print_on_main_thread(
    controller: ICoreWebView2Controller,
    tx: std::sync::mpsc::Sender<Result<Vec<u8>, ExportPdfError>>,
    settings: &PdfPrintSettingsDto,
    file_url: String,
) -> Result<(), ExportPdfError> {
    // SAFETY: controller 为 Tauri 主线程交付的有效 COM 控制器，CoreWebView2 是其标准只读属性
    let webview = unsafe { controller.CoreWebView2() }
        .map_err(|e| ExportPdfError::Print(format!("获取导出窗口 WebView 实例失败: {e}")))?;
    // cast 走标准 QueryInterface（windows-core 已封装为安全方法）
    let environment2 = webview.cast::<ICoreWebView2_2>().map_err(|e| {
        ExportPdfError::Print(format!("导出运行时缺少 WebView2 环境接口（版本过旧）: {e}"))
    })?;
    // SAFETY: environment2 为有效 COM 对象，Environment 是其标准只读属性
    let environment = unsafe { environment2.Environment() }
        .map_err(|e| ExportPdfError::Print(format!("获取 WebView2 环境失败: {e}")))?;
    let environment6 = environment
        .cast::<ICoreWebView2Environment6>()
        .map_err(|e| {
            ExportPdfError::Print(format!("导出运行时缺少打印设置接口（版本过旧）: {e}"))
        })?;
    // SAFETY: environment6 为有效 COM 对象，CreatePrintSettings 是其工厂方法
    //（该接口声明于 ICoreWebView2Environment6，1.0.1020.30 引入）
    let print_settings = unsafe { environment6.CreatePrintSettings() }
        .map_err(|e| ExportPdfError::Print(format!("创建打印设置失败: {e}")))?;
    // SAFETY: print_settings 为刚创建的有效 COM 对象，各 Set 方法仅写入进程内打印配置
    unsafe {
        print_settings
            .SetPageWidth(settings.page_width_in)
            .map_err(|e| ExportPdfError::Print(format!("设置纸张宽度失败: {e}")))?;
        print_settings
            .SetPageHeight(settings.page_height_in)
            .map_err(|e| ExportPdfError::Print(format!("设置纸张高度失败: {e}")))?;
        print_settings
            .SetMarginTop(PDF_MARGIN_IN)
            .map_err(|e| ExportPdfError::Print(format!("设置上边距失败: {e}")))?;
        print_settings
            .SetMarginBottom(PDF_MARGIN_IN)
            .map_err(|e| ExportPdfError::Print(format!("设置下边距失败: {e}")))?;
        print_settings
            .SetMarginLeft(PDF_MARGIN_IN)
            .map_err(|e| ExportPdfError::Print(format!("设置左边距失败: {e}")))?;
        print_settings
            .SetMarginRight(PDF_MARGIN_IN)
            .map_err(|e| ExportPdfError::Print(format!("设置右边距失败: {e}")))?;
        print_settings
            .SetShouldPrintBackgrounds(settings.print_background)
            .map_err(|e| ExportPdfError::Print(format!("设置背景打印失败: {e}")))?;
        // 页眉页脚由前端 @page CSS 承担（09 spec 裁决），关闭 WebView2 系统模板
        print_settings
            .SetShouldPrintHeaderAndFooter(false)
            .map_err(|e| ExportPdfError::Print(format!("关闭系统页眉页脚失败: {e}")))?;
    }

    // 先注册导航完成回调，再主动 Navigate 一次：builder 建窗时虽已带 URL，但页面可能在
    // 回调注册前就加载完成而错过事件；重新 Navigate 保证 NavigationCompleted 必然触发
    let printed = std::cell::Cell::new(false);
    let nav_handler = NavigationCompletedEventHandler::create({
        let tx = tx.clone();
        let print_settings = print_settings.clone();
        Box::new(move |webview, args| {
            // 打印只发起一次：重定向/二次导航不重复触发 PrintToPdfStream
            if printed.get() {
                return Ok(());
            }
            printed.set(true);
            // 导航失败（如临时 HTML 被清理）不进入打印，即时回传错误避免等满超时
            if let Some(args) = args {
                let mut success = BOOL::default();
                // SAFETY: args 为 COM 事件交付的有效参数对象，IsSuccess 是其标准出参读取
                if unsafe { args.IsSuccess(&mut success) }.is_ok() && !success.as_bool() {
                    let _ = tx.send(Err(ExportPdfError::Navigation(
                        "导出页面未成功加载".to_string(),
                    )));
                    return Ok(());
                }
            }
            let outcome = start_print(&webview, &print_settings, &tx);
            if let Err(e) = outcome {
                let _ = tx.send(Err(e));
            }
            Ok(())
        })
    });
    // SAFETY: webview 与 nav_handler 均为主线程持有的有效 COM 对象，add_ 走标准事件订阅
    let mut nav_token = 0i64;
    unsafe { webview.add_NavigationCompleted(&nav_handler, &mut nav_token) }
        .map_err(|e| ExportPdfError::Print(format!("注册导航完成回调失败: {e}")))?;

    // SAFETY: webview 为有效 COM 对象；Navigate 的 HSTRING 在调用期间存活
    let uri = HSTRING::from(file_url);
    unsafe { webview.Navigate(&uri) }
        .map_err(|e| ExportPdfError::Navigation(format!("发起导出页面导航失败: {e}")))?;
    Ok(())
}

/// 发起 PrintToPdfStream 并挂接完成回调（读取 IStream 字节后经 tx 回传）
///
/// # 参数
/// - `webview`：导航完成事件交付的 WebView 实例
/// - `print_settings`：已配好的打印设置
/// - `tx`：打印结果发送端
///
/// # 返回值
/// - `Ok(())`：打印已发起（结果走完成回调）
/// - `Err`：运行时缺打印接口（WebView2 < 1.0.1158）或发起调用 HRESULT 失败
fn start_print(
    webview: &Option<webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2>,
    print_settings: &ICoreWebView2PrintSettings,
    tx: &std::sync::mpsc::Sender<Result<Vec<u8>, ExportPdfError>>,
) -> Result<(), ExportPdfError> {
    let Some(webview) = webview else {
        return Err(ExportPdfError::Print(
            "导航完成事件未携带 WebView 实例".to_string(),
        ));
    };
    let webview16 = webview.cast::<ICoreWebView2_16>().map_err(|e| {
        ExportPdfError::Print(format!("导出运行时缺少 PDF 打印接口（版本过旧）: {e}"))
    })?;
    // 完成回调：HRESULT 失败 / 无流 / 读流错误均经 tx 回传，由阻塞侧统一关窗
    let completed = PrintToPdfStreamCompletedHandler::create({
        let tx = tx.clone();
        Box::new(move |hr, stream| {
            let result = if hr.is_err() {
                Err(ExportPdfError::Print(format!(
                    "打印完成回调返回错误（HRESULT {hr:?}）"
                )))
            } else {
                match stream {
                    Some(stream) => read_pdf_stream(&stream),
                    None => Err(ExportPdfError::StreamRead(
                        "打印完成回调未返回 PDF 流".to_string(),
                    )),
                }
            };
            let _ = tx.send(result);
            Ok(())
        })
    });
    // SAFETY: webview16 / print_settings / completed 均为主线程有效 COM 对象
    unsafe { webview16.PrintToPdfStream(print_settings, &completed) }
        .map_err(|e| ExportPdfError::Print(format!("发起 PDF 打印失败: {e}")))?;
    Ok(())
}

/// PDF 流字节读取：ISequentialStream::Read 64KB 分块循环，读到 0 即终止
///
/// # 参数
/// - `stream`：打印完成回调交付的 PDF 流
///
/// # 返回值
/// - `Ok(bytes)`：完整 PDF 字节
/// - `Err(StreamRead)`：任一次 Read 返回失败 HRESULT
fn read_pdf_stream(stream: &IStream) -> Result<Vec<u8>, ExportPdfError> {
    let mut buffer = vec![0u8; STREAM_CHUNK_BYTES];
    let mut pdf = Vec::new();
    loop {
        let mut read: u32 = 0;
        // SAFETY: stream 为回调交付的有效 COM 流对象；Read 仅写入本函数局部缓冲
        let hr = unsafe {
            stream.Read(
                buffer.as_mut_ptr().cast(),
                buffer.len() as u32,
                Some(&mut read),
            )
        };
        if hr.is_err() {
            return Err(ExportPdfError::StreamRead(format!(
                "IStream 读取失败（HRESULT {hr:?}）"
            )));
        }
        // Read 返回 0 字节即流结束（COM 流式读取标准终止约定）
        if read == 0 {
            return Ok(pdf);
        }
        pdf.extend_from_slice(&buffer[..read as usize]);
    }
}

/// PDF 原子落盘：同目录临时文件写入后 rename 覆盖目标（Windows rename 带 REPLACE_EXISTING）
///
/// 同目录保证 rename 不跨卷（跨卷退化为复制语义，失去原子性）；
/// rename 失败时清理临时文件，不留孤儿。
///
/// # 参数
/// - `target`：PDF 目标路径（覆盖语义）
/// - `bytes`：PDF 字节
///
/// # 返回值
/// - `Ok(())`：落盘成功
/// - `Err(Persist)`：临时写失败或改名失败
pub(crate) fn write_pdf_bytes(
    target: &std::path::Path,
    bytes: &[u8],
) -> Result<(), ExportPdfError> {
    let temp_pdf = target.with_extension("pdf.tmp");
    std::fs::write(&temp_pdf, bytes)
        .map_err(|e| ExportPdfError::Persist(format!("写入临时 PDF 失败: {e}")))?;
    if let Err(e) = std::fs::rename(&temp_pdf, target) {
        // 覆盖失败回收临时文件（如目标被占用只读），错误冒泡给前端提示
        let _ = std::fs::remove_file(&temp_pdf);
        return Err(ExportPdfError::Persist(format!("PDF 改名落盘失败: {e}")));
    }
    Ok(())
}

/// 当前 Unix 毫秒时间戳（时钟回拨等异常兜底 0，仅影响临时名/label 唯一性）
fn unix_millis() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    // —— 09 PDF 导出：DTO 反序列化与落盘单测（真实打印 e2e 冒烟覆盖）——
    use super::*;

    #[test]
    fn pdf_print_settings_dto_deserializes_camel_case_wire() {
        let json = r#"{"printBackground":true,"pageWidthIn":8.27,"pageHeightIn":11.69}"#;
        let dto: PdfPrintSettingsDto = serde_json::from_str(json).expect("测试上下文允许 expect");
        assert!(dto.print_background);
        assert!((dto.page_width_in - 8.27).abs() < f64::EPSILON);
    }

    #[test]
    fn export_pdf_error_serializes_as_chinese_message_string() {
        let err = ExportPdfError::TempWrite(std::io::Error::other("磁盘满"));
        let value = serde_json::to_value(&err).expect("测试上下文允许 expect");
        assert_eq!(
            value,
            serde_json::Value::String("写入导出临时文件失败: 磁盘满".to_string())
        );
    }

    #[test]
    fn write_pdf_bytes_writes_via_temp_then_renames() {
        let dir = std::env::temp_dir().join(format!("mw-pdf-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("测试上下文允许 expect");
        let target = dir.join("out.pdf");
        write_pdf_bytes(&target, b"%PDF-1.7 test").expect("落盘应成功");
        assert_eq!(
            std::fs::read(&target).expect("测试上下文允许 expect"),
            b"%PDF-1.7 test"
        );
        // 覆盖写（rename 语义 REPLACE_EXISTING）
        write_pdf_bytes(&target, b"%PDF-1.7 v2").expect("覆盖落盘应成功");
        assert_eq!(
            std::fs::read(&target).expect("测试上下文允许 expect"),
            b"%PDF-1.7 v2"
        );
        std::fs::remove_dir_all(&dir).ok();
    }
}
