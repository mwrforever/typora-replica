// 跨文件搜索（06 搜索替换）：扫描纯函数层 + 命令层
//
// 职责：三开关 → regex 构建（regex crate 引擎线性时间无灾难回溯；\b 为 Unicode
// 词界，中文字符属词字符，全词语义与官方前端侧一致）；单文件扫描（头 8KB NUL
// 探测廉价跳二进制 → 全量读 + 全文 NUL 复查 → 复用 02 decode_text 编码探测
// 转码 → 逐行匹配收集，含结果上限与行文本截断）；
// 命令层（Channel 流式推送/句柄替换取消/ignore 并行遍历）。
use std::fs;
use std::io::Read;
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{mpsc, Arc};

// 最小适配：brief 原文未导入 RegexBuilder（build_matcher 使用）且导入了未使用的
// serde::{Deserialize, Serialize}（derive 已用全路径），此处修正以过编译与 clippy。
use regex::{Regex, RegexBuilder};
use tauri::ipc::Channel;
use tauri::Manager;

use super::encoding::{decode_text, encoding_name};

/// 三开关选项（wire 形态 camelCase；maxResults 由前端固定注入 50）
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchOptions {
    /// 大小写敏感（缺省 false）
    #[serde(default)]
    pub case_sensitive: bool,
    /// 全词匹配（Unicode \b 词界，缺省 false）
    #[serde(default)]
    pub whole_word: bool,
    /// 正则模式（缺省 false；字面模式自动转义）
    #[serde(default)]
    pub regexp: bool,
    /// 结果上限（前端固定 50，AC-F26-3）
    #[serde(default = "default_max_results")]
    pub max_results: u32,
}

fn default_max_results() -> u32 {
    50
}

/// 单条匹配行 DTO（camelCase 对齐前端 GlobalSearchMatch；Deserialize 供测试端
/// 对 Channel 载荷做类型化反解）
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchMatchDto {
    /// 1 起行号
    pub line_number: u32,
    /// 匹配行整行文本（超长截断补 …）
    pub line_text: String,
    /// 该行首个命中的文件内全局序号（0 起；跨文件点击定位按序取位的依据）
    pub first_match_index: u32,
}

/// 单文件扫描产出
pub struct FileScanOutcome {
    /// 命中行（文档序）
    pub matches: Vec<SearchMatchDto>,
    /// 是否因达到 limit 提前截断（本文件尚有未扫描行）
    pub hit_limit: bool,
    /// 源编码名（AC-F26-5 非 UTF-8 标注来源；utf8/utf8-bom/gbk）
    pub encoding_name: &'static str,
}

/// 二进制探测读取字节数（读头探 NUL，避免为判型全量读入大文件）
const BINARY_PROBE_BYTES: u64 = 8192;
/// 匹配行文本截断上限（字符数；防压缩 JSON 类超长行撑爆 IPC 载荷）
const LINE_TEXT_MAX_CHARS: usize = 500;

/// 构建匹配器（三开关 → 正则）
///
/// 字面模式经 regex::escape 转义；全词包 `\b(?:...)\b`。空查询与非法正则
/// 返回 Err（中文消息，命令层原样作为 invoke 拒绝透传前端）。
pub fn build_matcher(query: &str, opts: &SearchOptions) -> Result<Regex, String> {
    if query.is_empty() {
        return Err("搜索词不能为空".to_string());
    }
    let mut pattern = if opts.regexp {
        query.to_string()
    } else {
        regex::escape(query)
    };
    if opts.whole_word {
        pattern = format!(r"\b(?:{pattern})\b");
    }
    RegexBuilder::new(&pattern)
        .case_insensitive(!opts.case_sensitive)
        .build()
        .map_err(|e| format!("无效的搜索表达式: {e}"))
}

/// 头部 NUL 探测（大文件只为判型不全量读入）
fn head_looks_binary(path: &Path) -> std::io::Result<bool> {
    let mut file = fs::File::open(path)?;
    let mut head = Vec::new();
    (&mut file)
        .take(BINARY_PROBE_BYTES)
        .read_to_end(&mut head)?;
    Ok(head.contains(&0))
}

/// 字符级安全截断（char boundary 安全；截断补省略号）
fn truncate_chars(text: &str, max_chars: usize) -> String {
    if text.chars().count() <= max_chars {
        return text.to_string();
    }
    let mut out: String = text.chars().take(max_chars).collect();
    out.push('…');
    out
}

/// 扫描单个文件（纯函数，命令层与单测共用）
///
/// 二进制文件（头 8KB 或全文含 NUL）静默跳过返回 Ok(None)；解码失败（非 UTF-8
/// 且非 GBK）返回 Err，由命令层上报 Error 事件且不中断整体扫描。
///
/// @param path 文件路径
/// @param matcher 已构建匹配器
/// @param limit 本文件允许的最大命中行数（全局配额剩余量；0 直接返回截断态）
pub fn scan_file(
    path: &Path,
    matcher: &Regex,
    limit: u32,
) -> Result<Option<FileScanOutcome>, String> {
    if limit == 0 {
        return Ok(Some(FileScanOutcome {
            matches: Vec::new(),
            hit_limit: true,
            encoding_name: "utf8",
        }));
    }
    match head_looks_binary(path) {
        Ok(true) => return Ok(None),
        Ok(false) => {}
        Err(e) => return Err(format!("读取失败: {e}")),
    }
    let bytes = fs::read(path).map_err(|e| format!("读取失败: {e}"))?;
    // 全文 NUL 复查：NUL 位于探测窗口之外的二进制在解码前拦截（decode_text 亦兜底拒绝）
    if bytes.contains(&0) {
        return Ok(None);
    }
    let decoded = decode_text(&bytes)?;
    let encoding = encoding_name(decoded.encoding);
    let mut matches = Vec::new();
    let mut hit_limit = false;
    // 文件内全局命中计数：first_match_index 是前端 nthMatch 取位依据（序号对齐裁决，
    // 空/空白差异不影响命中顺序与数量，两侧天然对齐）
    let mut hit_count: u32 = 0;
    for (idx, line) in decoded.text.lines().enumerate() {
        if matches.len() as u32 >= limit {
            hit_limit = true;
            break;
        }
        let hits = matcher.find_iter(line).count();
        if hits > 0 {
            // 结果行语义保持「每命中行一条」；该行后续命中只累计序号不重复出条
            matches.push(SearchMatchDto {
                line_number: (idx + 1) as u32,
                line_text: truncate_chars(line, LINE_TEXT_MAX_CHARS),
                first_match_index: hit_count,
            });
            hit_count += hits as u32;
        }
    }
    Ok(Some(FileScanOutcome {
        matches,
        hit_limit,
        encoding_name: encoding,
    }))
}

/// 饱和递减（返回递减后新值）：并发 worker 各持满额预算时 taken 合计可能超过
/// 剩余配额，裸 fetch_sub 会下溢回绕致截断上限失效——CAS 循环钳制于 0
///
/// @param counter 配额计数器（全局剩余可命中条数）
/// @param amount 本次批次消耗量（调用方保证 > 0）
/// @returns 递减后的新值（0 表示配额耗尽，调用方据此置截断并退出遍历）
fn saturating_fetch_sub(counter: &AtomicU32, amount: u32) -> u32 {
    let mut prev = counter.load(Ordering::SeqCst);
    loop {
        let next = prev.saturating_sub(amount);
        match counter.compare_exchange_weak(prev, next, Ordering::SeqCst, Ordering::SeqCst) {
            Ok(_) => return next,
            // CAS 失败说明并发方已改写计数器，以最新值重试
            Err(actual) => prev = actual,
        }
    }
}

// —— 命令层（06 P3）：Channel 流式推送 + 句柄替换取消 ——

/// 流式事件（serde internally-tagged；字段 camelCase 对齐前端 SearchStreamEvent；
/// Deserialize 供测试端对 Channel 载荷做类型化反解，兼验 wire 契约）
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum SearchEvent {
    /// 文件级命中批次
    Result {
        /// 完整路径
        file_path: String,
        /// 文件名（末级）
        file_name: String,
        /// 非 UTF-8 编码标注（utf8 时 None，AC-F26-5）
        encoding: Option<String>,
        /// 命中行集
        matches: Vec<SearchMatchDto>,
    },
    /// 扫描收口（完成/取消/截断恒发一次；前端代次守卫丢弃过期代）
    Done {
        /// 是否因结果上限提前截断（AC-F26-3）
        truncated: bool,
    },
    /// 单文件读取失败（不中断整体扫描）
    Error {
        /// 文件路径
        path: String,
        /// 中文错误消息
        message: String,
    },
}

/// 在途搜索任务句柄（AppState.search_job 持有；标志置位即尽快取消）
pub struct SearchJobHandle {
    /// 取消标志：扫描线程在文件粒度检查，置位即退出遍历
    pub cancelled: Arc<AtomicBool>,
}

/// 命令：跨文件搜索（Channel 流式事件流；新任务替换在途句柄即取消旧任务）
///
/// 启动编排全部为同步快路径（校验/构 matcher/换句柄/起线程），扫描在后台
/// 线程执行不阻塞主链路。事件先经 mpsc 汇集、由 flush_loop 合并窗口批量
/// 投递（watch_dir 防洪泛同款）。app 参数沿 watch_dir 的 AppHandle<R>
/// 可测性模式（mock 运行时直呼命令，wire 契约不变）。
///
/// @param root 扫描根目录（必须存在且为文件夹）
/// @param query 搜索词（字面或正则取决于 opts.regexp；非法正则同步拒绝）
/// @param opts 三开关选项 + 结果上限（wire camelCase）
/// @param channel 前端通道（事件按 100ms 合并窗口批量投递；收口恒发 Done）
/// @returns Ok 已启动后台扫描；Err 目录无效/正则非法（invoke 拒绝直达前端，
///          此时不产生任何线程、不动在途任务槽位）
#[tauri::command]
pub fn search_in_folder<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    root: String,
    query: String,
    opts: SearchOptions,
    channel: Channel<Vec<SearchEvent>>,
) -> Result<(), String> {
    let root_path = std::path::PathBuf::from(&root);
    if !root_path.is_dir() {
        return Err(format!("目录不存在或不是文件夹: {root}"));
    }
    // 非法正则在此快速失败：invoke 拒绝直达前端 globalError，不产生任何线程
    let matcher = build_matcher(&query, &opts)?;

    let cancelled = Arc::new(AtomicBool::new(false));
    {
        // State 为临时值须先绑定再取锁（E0716，watch.rs 同款注释）
        let state = app.state::<crate::AppState>();
        let mut guard = state
            .search_job
            .lock()
            .map_err(|_| "搜索状态锁损坏".to_string())?;
        // 替换语义：旧任务立即置位取消（AC-F26-6 新词取消前次）
        if let Some(prev) = guard.replace(SearchJobHandle {
            cancelled: cancelled.clone(),
        }) {
            prev.cancelled.store(true, Ordering::SeqCst);
        }
    }

    let (tx, rx) = mpsc::channel::<SearchEvent>();
    std::thread::spawn(move || {
        super::watch::flush_loop(rx, move |batch| {
            // Channel 发送失败（前端已销毁/切换）忽略：发送端随遍历线程结束而 drop
            let _ = channel.send(batch);
        });
    });

    let quota_hit = Arc::new(AtomicBool::new(false));
    let remaining = Arc::new(AtomicU32::new(opts.max_results));
    let scan_root = root_path;
    let walk_cancelled = cancelled;
    let quota = quota_hit.clone();
    std::thread::spawn(move || {
        ignore::WalkBuilder::new(scan_root)
            // 显式跳过隐藏文件/目录（.git 等）；工作区 gitignore 默认生效（spec F26 行为）
            .hidden(true)
            .build_parallel()
            .run(|| {
                let tx = tx.clone();
                let cancelled = walk_cancelled.clone();
                let remaining = remaining.clone();
                let quota = quota.clone();
                let matcher = matcher.clone();
                Box::new(move |entry| {
                    // 取消检查（文件粒度）：置位即刻退出整轮遍历
                    if cancelled.load(Ordering::SeqCst) {
                        return ignore::WalkState::Quit;
                    }
                    let Ok(entry) = entry else {
                        return ignore::WalkState::Continue;
                    };
                    if !entry.file_type().is_some_and(|ft| ft.is_file()) {
                        return ignore::WalkState::Continue;
                    }
                    let limit = remaining.load(Ordering::SeqCst);
                    match scan_file(entry.path(), &matcher, limit) {
                        Ok(Some(outcome)) => {
                            let taken = outcome.matches.len() as u32;
                            if taken > 0 {
                                // 饱和递减防并发下溢回绕（回绕后 remaining==0 永不
                                // 触发，截断上限 AC-F26-3 会被静默突破）
                                let _ = saturating_fetch_sub(&remaining, taken);
                                let _ = tx.send(SearchEvent::Result {
                                    file_path: entry.path().to_string_lossy().into_owned(),
                                    file_name: entry.path().file_name().map_or_else(
                                        || "未命名".to_string(),
                                        |n| n.to_string_lossy().into_owned(),
                                    ),
                                    encoding: if outcome.encoding_name == "utf8" {
                                        None
                                    } else {
                                        Some(outcome.encoding_name.to_string())
                                    },
                                    matches: outcome.matches,
                                });
                            }
                            // 配额耗尽：置截断标志并停止整轮（约 50 条语义允许批内少量越界）
                            if outcome.hit_limit || remaining.load(Ordering::SeqCst) == 0 {
                                quota.store(true, Ordering::SeqCst);
                                cancelled.store(true, Ordering::SeqCst);
                                return ignore::WalkState::Quit;
                            }
                        }
                        Ok(None) => {} // 二进制静默跳过
                        Err(message) => {
                            // 单文件失败上报 Error 不中断整体（spec §5.3① 契约）
                            let _ = tx.send(SearchEvent::Error {
                                path: entry.path().to_string_lossy().into_owned(),
                                message,
                            });
                        }
                    }
                    ignore::WalkState::Continue
                })
            });
        let _ = tx.send(SearchEvent::Done {
            truncated: quota.load(Ordering::SeqCst),
        });
    });
    Ok(())
}

/// 命令：取消当前全局搜索（幂等：无在途任务亦成功；面板关闭时调用）
///
/// 置位在途句柄的取消标志并清空槽位；扫描线程在下一个文件边界感知后退出。
/// @returns 恒 Ok（幂等）；锁损坏时 Err
#[tauri::command]
pub fn cancel_search<R: tauri::Runtime>(app: tauri::AppHandle<R>) -> Result<(), String> {
    let state = app.state::<crate::AppState>();
    let mut guard = state
        .search_job
        .lock()
        .map_err(|_| "搜索状态锁损坏".to_string())?;
    if let Some(job) = guard.take() {
        job.cancelled.store(true, Ordering::SeqCst);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    /// 进程内唯一临时目录（watch.rs 测试同款惯例：pid + 自增序号防并发冲突）
    fn temp_dir() -> PathBuf {
        static COUNTER: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
        let n = COUNTER.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        let dir = std::env::temp_dir().join(format!("markwell-search-{}-{n}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// 写文件并返回路径（内容字节直写，覆盖 GBK/二进制形态）
    fn write_file(dir: &Path, name: &str, content: &[u8]) -> PathBuf {
        let p = dir.join(name);
        fs::write(&p, content).unwrap();
        p
    }

    fn opts(case_sensitive: bool, whole_word: bool, regexp: bool) -> SearchOptions {
        SearchOptions {
            case_sensitive,
            whole_word,
            regexp,
            max_results: 50,
        }
    }

    #[test]
    fn literal_search_case_insensitive_by_default() {
        let m = build_matcher("cat", &opts(false, false, false)).unwrap();
        assert!(m.is_match("the Cat"));
        let cs = build_matcher("cat", &opts(true, false, false)).unwrap();
        assert!(cs.is_match("a cat"));
        assert!(!cs.is_match("the Cat"));
    }

    #[test]
    fn empty_query_and_invalid_regex_rejected_with_chinese_message() {
        assert_eq!(
            build_matcher("", &opts(false, false, false)).unwrap_err(),
            "搜索词不能为空"
        );
        let err = build_matcher("(", &opts(false, false, true)).unwrap_err();
        assert!(err.starts_with("无效的搜索表达式"), "实际: {err}");
    }

    #[test]
    fn literal_mode_escapes_regex_metacharacters() {
        let m = build_matcher("a.b", &opts(false, false, false)).unwrap();
        assert!(m.is_match("a.b"));
        assert!(!m.is_match("axb")); // 字面模式不解释 .
    }

    #[test]
    fn whole_word_unicode_boundary_matches_typora_semantics() {
        // ASCII：concatenate 不被 cat 全词命中（AC-F25-6 同源语义）
        let ascii = build_matcher("cat", &opts(false, true, false)).unwrap();
        assert!(ascii.is_match("a cat here"));
        assert!(!ascii.is_match("concatenate"));
        // CJK：两侧均为汉字（Unicode 词字符）→ 词界不成立；左邻标点且右为文本
        // 边界 → 成立（brief 原例「学中文课，中文课」第二处右侧邻「课」仍属词
        // 字符，右词界不成立，与 Unicode 词界定义相悖，已按定义修正示例）
        let cjk = build_matcher("中文", &opts(false, true, false)).unwrap();
        assert!(!cjk.is_match("学中文课"));
        assert!(cjk.is_match("学中文课，中文")); // 第一处拒绝（两侧邻字均词字符）、第二处命中
    }

    #[test]
    fn scan_file_reports_line_numbers_for_each_hit() {
        let dir = temp_dir();
        let p = write_file(
            &dir,
            "a.md",
            b"no hit\nfirst target\nplain\nsecond target\n",
        );
        let m = build_matcher("target", &opts(false, false, false)).unwrap();
        let out = scan_file(&p, &m, 50).unwrap().unwrap();
        assert_eq!(out.matches.len(), 2);
        assert_eq!(out.matches[0].line_number, 2);
        assert_eq!(out.matches[1].line_number, 4);
        // 命中序跨行累计（前端 nthMatch 取位依据）
        assert_eq!(out.matches[0].first_match_index, 0);
        assert_eq!(out.matches[1].first_match_index, 1);
        assert_eq!(out.matches[0].line_text, "first target");
        assert!(!out.hit_limit);
        assert_eq!(out.encoding_name, "utf8");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn scan_file_transcodes_gbk_and_marks_encoding() {
        let dir = temp_dir();
        // 「中文测试」GBK 字节（encoding.rs 测试夹具同款）
        let mut content = vec![0xD6, 0xD0, 0xCE, 0xC4, 0xB2, 0xE2, 0xCA, 0xD4];
        content.push(b'\n');
        // 「第二行 目标词」整行 GBK 字节（PowerShell 代码页 936 实测）。夹具须
        // 整文件纯 GBK：brief 原文混入 UTF-8 字节，会被 UTF-8 严格校验与 GBK
        // 回退双双拒绝（decode_text 契约），与本用例「GBK 转码成功」前提相悖。
        content.extend_from_slice(&[
            0xB5, 0xDA, 0xB6, 0xFE, 0xD0, 0xD0, 0x20, 0xC4, 0xBF, 0xB1, 0xEA, 0xB4, 0xCA,
        ]);
        content.push(b'\n');
        let p = write_file(&dir, "legacy.txt", &content);
        let m = build_matcher("目标词", &opts(false, false, false)).unwrap();
        let out = scan_file(&p, &m, 50).unwrap().unwrap();
        assert_eq!(out.encoding_name, "gbk"); // AC-F26-5 标注
        assert_eq!(out.matches[0].line_number, 2);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn scan_file_silently_skips_binary_head_probe_and_full_check() {
        let dir = temp_dir();
        // 头部即含 NUL：探测窗口内拦截
        let head_bin = write_file(&dir, "head.bin", &[0x61, 0x00, 0x62]);
        // NUL 在探测窗口之外（8KB 后）：全文复查拦截
        let mut tail_bytes = vec![b'a'; 9000];
        tail_bytes.push(0);
        let tail_bin = write_file(&dir, "tail.bin", &tail_bytes);
        let m = build_matcher("a", &opts(false, false, false)).unwrap();
        assert!(scan_file(&head_bin, &m, 50).unwrap().is_none());
        assert!(scan_file(&tail_bin, &m, 50).unwrap().is_none());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn scan_file_no_hit_returns_some_empty_outcome() {
        let dir = temp_dir();
        let p = write_file(&dir, "clean.md", b"nothing special\n");
        let m = build_matcher("zzz", &opts(false, false, false)).unwrap();
        let out = scan_file(&p, &m, 50).unwrap().unwrap();
        assert!(out.matches.is_empty() && !out.hit_limit); // 与二进制的 None 区分
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn scan_file_respects_limit_and_sets_hit_flag() {
        let dir = temp_dir();
        let p = write_file(&dir, "many.md", b"hit\nhit\nhit\nhit\n");
        let m = build_matcher("hit", &opts(false, false, false)).unwrap();
        let out = scan_file(&p, &m, 2).unwrap().unwrap();
        assert_eq!(out.matches.len(), 2);
        assert!(out.hit_limit); // 第 3 行起因配额截断
                                // 配额恰好在末行耗尽：不再有未扫描行时不得误报截断
        let out_exact = scan_file(&p, &m, 4).unwrap().unwrap();
        assert_eq!(out_exact.matches.len(), 4);
        assert!(!out_exact.hit_limit);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn scan_file_truncates_overlong_line_at_char_boundary() {
        let dir = temp_dir();
        let long = format!("{}\ntail 目标\n", "x".repeat(600));
        let p = write_file(&dir, "long.md", long.as_bytes());
        let m = build_matcher("目标", &opts(false, false, false)).unwrap();
        let out = scan_file(&p, &m, 50).unwrap().unwrap();
        // 命中的是第 2 行（首行超长但不含查询词）；行文本截断逻辑单独验证
        assert_eq!(out.matches[0].line_number, 2);
        // 超长命中行：600 个「目」→ 截断为 500 字符 + …
        let long_only = write_file(&dir, "long2.md", "目".repeat(600).as_bytes());
        let m2 = build_matcher("目", &opts(false, false, false)).unwrap();
        let out2 = scan_file(&long_only, &m2, 50).unwrap().unwrap();
        assert_eq!(out2.matches[0].line_text.chars().count(), 501); // 500 字符 + …
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn scan_file_zero_limit_short_circuits_as_truncated() {
        let dir = temp_dir();
        let p = write_file(&dir, "z.md", b"hit\n");
        let m = build_matcher("hit", &opts(false, false, false)).unwrap();
        let out = scan_file(&p, &m, 0).unwrap().unwrap();
        assert!(out.matches.is_empty() && out.hit_limit);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn scan_file_unreadable_path_errors() {
        let m = build_matcher("x", &opts(false, false, false)).unwrap();
        assert!(scan_file(Path::new("Z:/no-such-file-xyz.md"), &m, 50).is_err());
    }

    #[test]
    fn saturating_fetch_sub_clamps_at_zero_without_wrapping() {
        // 裸 fetch_sub 在 5-7 时会下溢回绕至约 4.29e9，截断上限 AC-F26-3 随之失效
        let counter = AtomicU32::new(5);
        let next = saturating_fetch_sub(&counter, 7);
        assert_eq!(next, 0); // 钳制于 0 而非回绕
        assert_eq!(counter.load(Ordering::SeqCst), 0);
        // 配额已尽后继续消耗仍稳定为 0（幂等饱和）
        assert_eq!(saturating_fetch_sub(&counter, 3), 0);
    }

    #[test]
    fn saturating_fetch_sub_concurrent_decrement_never_wraps_below_zero() {
        // 并发压测简化版：4 线程各 1000 次递减 1，初值 10 远小于总量 4000——
        // 终值须恰为 max(初值-总量, 0) 且全程无 panic（join 传播失败即测败）
        let counter = Arc::new(AtomicU32::new(10));
        let mut handles = Vec::new();
        for _ in 0..4 {
            let worker_counter = counter.clone();
            handles.push(std::thread::spawn(move || {
                for _ in 0..1000 {
                    saturating_fetch_sub(&worker_counter, 1);
                }
            }));
        }
        for handle in handles {
            handle.join().unwrap();
        }
        assert_eq!(
            counter.load(Ordering::SeqCst),
            10u32.saturating_sub(4 * 1000)
        );
    }

    // —— 命令层测试（mock 运行时直呼命令，wire 契约不变）——

    use std::time::{Duration, Instant};

    /// 构造收集型 Channel（批量事件汇入共享容器，供断言）
    ///
    /// 最小适配：tauri 2.11 的 Channel::new 回调形态为 InvokeResponseBody（brief
    /// 骨架按旧版 Vec<T> 直收形态书写）；send(Vec<SearchEvent>) 序列化为 Json
    /// 载荷，此处反解还原事件集，顺带校验 wire 契约（camelCase tag/字段）可逆。
    fn collect_channel() -> (
        Channel<Vec<SearchEvent>>,
        Arc<std::sync::Mutex<Vec<SearchEvent>>>,
    ) {
        let collected: Arc<std::sync::Mutex<Vec<SearchEvent>>> = Arc::default();
        let sink = collected.clone();
        let channel = Channel::<Vec<SearchEvent>>::new(move |body| {
            if let tauri::ipc::InvokeResponseBody::Json(text) = body {
                let mut batch: Vec<SearchEvent> =
                    serde_json::from_str(&text).expect("SearchEvent 批次反序列化失败");
                sink.lock().unwrap().append(&mut batch);
            }
            Ok(())
        });
        (channel, collected)
    }

    /// 轮询等待 Done 事件到达（最多 5s；异步线程收口）
    fn wait_done(collected: &Arc<std::sync::Mutex<Vec<SearchEvent>>>) -> bool {
        let deadline = Instant::now() + Duration::from_secs(5);
        while Instant::now() < deadline {
            if collected
                .lock()
                .unwrap()
                .iter()
                .any(|e| matches!(e, SearchEvent::Done { .. }))
            {
                return true;
            }
            std::thread::sleep(Duration::from_millis(25));
        }
        false
    }

    /// 构造挂载 AppState 的 mock 应用（返回类型以 tauri::test::mock_app 实际形态为准）
    fn managed_app() -> tauri::App<tauri::test::MockRuntime> {
        let app = tauri::test::mock_app();
        app.manage(crate::AppState {
            watcher: std::sync::Mutex::new(std::collections::HashMap::new()),
            search_job: std::sync::Mutex::new(std::option::Option::None),
        });
        app
    }

    #[test]
    fn search_in_folder_streams_results_marks_encoding_and_skips_hidden_binary() {
        let app = managed_app();
        let handle = app.handle().clone();
        let dir = temp_dir();
        // UTF-8 命中文件须含查询词「目标」：brief 夹具仅含 ASCII「target」，与
        // 查询词不匹配会令 nested/hit 断言必败；最小修正为补入中文命中词，
        // 全部断言语义保持不变
        fs::write(dir.join("hit.md"), "target line 目标\nplain\n").unwrap();
        fs::create_dir_all(dir.join("sub")).unwrap();
        fs::write(dir.join("sub").join("nested.md"), "deep target 目标\n").unwrap();
        // GBK 文件：「目标」= C4 BF B1 EA
        fs::write(dir.join("legacy.txt"), [0xC4, 0xBF, 0xB1, 0xEA]).unwrap();
        fs::write(dir.join("blob.bin"), [0x61, 0x00, 0x62]).unwrap();
        fs::write(dir.join(".hidden.md"), "目标 hidden\n").unwrap();

        let (channel, collected) = collect_channel();
        search_in_folder(
            handle,
            dir.to_string_lossy().into_owned(),
            "目标".to_string(),
            opts(false, false, false),
            channel,
        )
        .unwrap();
        assert!(wait_done(&collected));

        let events = collected.lock().unwrap().clone();
        let files: Vec<(String, Option<String>)> = events
            .iter()
            .filter_map(|e| match e {
                SearchEvent::Result {
                    file_path,
                    encoding,
                    ..
                } => Some((file_path.clone(), encoding.clone())),
                _ => None,
            })
            .collect();
        // 嵌套命中（递归）+ GBK 转码标注（AC-F26-1/5）
        assert!(files
            .iter()
            .any(|(p, enc)| p.ends_with("nested.md") && enc.is_none()));
        let legacy = files
            .iter()
            .find(|(p, _)| p.ends_with("legacy.txt"))
            .unwrap();
        assert_eq!(legacy.1.as_deref(), Some("gbk"));
        // 隐藏文件与二进制跳过（spec F26 行为）
        assert!(!files.iter().any(|(p, _)| p.ends_with(".hidden.md")));
        assert!(!files.iter().any(|(p, _)| p.ends_with("blob.bin")));
        // 根目录 UTF-8 文件正常命中
        assert!(files.iter().any(|(p, _)| p.ends_with("hit.md")));
        assert!(events
            .iter()
            .any(|e| matches!(e, SearchEvent::Done { truncated: false })));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn search_in_folder_truncates_at_max_results_with_flag() {
        let app = managed_app();
        let handle = app.handle().clone();
        let dir = temp_dir();
        fs::write(dir.join("many.md"), b"t\nt\nt\nt\nt\n").unwrap(); // 5 行命中
        let (channel, collected) = collect_channel();
        search_in_folder(
            handle,
            dir.to_string_lossy().into_owned(),
            "t".to_string(),
            SearchOptions {
                case_sensitive: false,
                whole_word: false,
                regexp: false,
                max_results: 3,
            },
            channel,
        )
        .unwrap();
        assert!(wait_done(&collected));
        let events = collected.lock().unwrap().clone();
        let hit_lines: usize = events
            .iter()
            .filter_map(|e| match e {
                SearchEvent::Result { matches, .. } => Some(matches.len()),
                _ => None,
            })
            .sum();
        assert_eq!(hit_lines, 3); // 截断到上限
        assert!(events
            .iter()
            .any(|e| matches!(e, SearchEvent::Done { truncated: true }))); // AC-F26-3 标志
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn invalid_regex_rejects_fast_without_touching_job_slot() {
        let app = managed_app();
        let handle = app.handle().clone();
        let dir = temp_dir();
        let (channel, _collected) = collect_channel();
        let err = search_in_folder(
            handle,
            dir.to_string_lossy().into_owned(),
            "(".to_string(),
            SearchOptions {
                case_sensitive: false,
                whole_word: false,
                regexp: true,
                max_results: 50,
            },
            channel,
        )
        .unwrap_err();
        assert!(err.starts_with("无效的搜索表达式"));
        // 未产出任何线程/句柄：槽位保持空
        let state = app.state::<crate::AppState>();
        assert!(state.search_job.lock().unwrap().is_none());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn cancel_search_clears_slot_idempotent_and_replace_cancels_previous() {
        let app = managed_app();
        let handle = app.handle().clone();

        // 预置在途假任务 → cancel 置位并清槽
        let flag_a = Arc::new(AtomicBool::new(false));
        {
            let state = app.state::<crate::AppState>();
            *state.search_job.lock().unwrap() = Some(SearchJobHandle {
                cancelled: flag_a.clone(),
            });
        }
        cancel_search(handle.clone()).unwrap();
        assert!(flag_a.load(Ordering::SeqCst));
        let state = app.state::<crate::AppState>();
        assert!(state.search_job.lock().unwrap().is_none());
        // state 借用随最后一次使用自然结束（State 未实现 Drop，禁显式 drop——
        // clippy::drop_non_drop）；后续 cancel_search 为不可变借用，无冲突
        // 幂等：空槽再取消仍 Ok
        cancel_search(handle.clone()).unwrap();

        // 新搜索替换在途句柄：假句柄被置位，槽位指向新句柄
        let flag_b = Arc::new(AtomicBool::new(false));
        {
            let state = app.state::<crate::AppState>();
            *state.search_job.lock().unwrap() = Some(SearchJobHandle {
                cancelled: flag_b.clone(),
            });
        }
        let dir = temp_dir();
        fs::write(dir.join("a.md"), b"x\n").unwrap();
        let (channel, collected) = collect_channel();
        search_in_folder(
            handle,
            dir.to_string_lossy().into_owned(),
            "x".to_string(),
            opts(false, false, false),
            channel,
        )
        .unwrap();
        assert!(flag_b.load(Ordering::SeqCst)); // 旧任务被新任务取消（AC-F26-6）
        assert!(wait_done(&collected));
        let _ = fs::remove_dir_all(&dir);
    }
}
