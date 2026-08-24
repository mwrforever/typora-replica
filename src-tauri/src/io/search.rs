// 跨文件搜索（06 搜索替换）：扫描纯函数层
//
// 职责：三开关 → regex 构建（regex crate 引擎线性时间无灾难回溯；\b 为 Unicode
// 词界，中文字符属词字符，全词语义与官方前端侧一致）；单文件扫描（头 8KB NUL
// 探测廉价跳二进制 → 全量读 + 全文 NUL 复查 → 复用 02 decode_text 编码探测
// 转码 → 逐行匹配收集，含结果上限与行文本截断）。
// 命令层（Channel 流式/取消/并行遍历）由 Task 8 在本文件下半部追加。
use std::fs;
use std::io::Read;
use std::path::Path;

// 最小适配：brief 原文未导入 RegexBuilder（build_matcher 使用）且导入了未使用的
// serde::{Deserialize, Serialize}（derive 已用全路径），此处修正以过编译与 clippy。
use regex::{Regex, RegexBuilder};

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

/// 单条匹配行 DTO（camelCase 对齐前端 GlobalSearchMatch）
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
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
}
