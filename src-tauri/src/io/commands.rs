// 文件 IO 命令层（02 文档管理）
//
// 全部命令为薄封装：入参校验（路径安全）→ 纯函数实现 → DTO 序列化。
// DTO 统一 camelCase（serde rename_all），供前端 invoke 消费。
use serde::{Deserialize, Serialize};

use crate::io::atomic::{assert_safe_path, atomic_write};
use crate::io::encoding::{encoding_name, line_ending_name, normalize_line_ending, LineEnding};
use crate::io::fs::ListDirOptions;

/// 目录遍历结果项
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    /// 条目完整路径
    pub path: String,
    /// 相对根目录的路径（/ 分隔，不含根自身）
    pub name: String,
    /// 是否为目录
    pub is_dir: bool,
    /// 扩展名（不含点，目录为空串）
    pub ext: String,
    /// 修改时间（epoch 毫秒；元数据不可用时为 None）
    pub mtime: Option<u64>,
    /// 创建时间（epoch 毫秒；元数据不可用时为 None）
    pub ctime: Option<u64>,
}

/// 读文件结果（内容统一 UTF-8，编码/行尾探测结果）
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadResultDto {
    /// 解码后的文本内容（GBK 已转 UTF-8）
    pub content: String,
    /// 源编码：utf8 / utf8-bom / gbk
    pub encoding: String,
    /// 源行尾：lf / crlf
    pub line_ending: String,
}

/// 写文件选项
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteOptions {
    /// 落盘行尾：lf / crlf（非法值回落 lf）
    pub line_ending: String,
}

/// 草稿条目
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftEntry {
    /// 草稿完整路径
    pub path: String,
    /// 草稿文件名（含 .md）
    pub name: String,
    /// 文件名中的日期前缀（YYYY-MM-DD）
    pub date: String,
}

/// 目录监视事件
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchEvent {
    /// create / remove / modify / other（rename 事件由 notify 以 modify 形态到达）
    pub kind: String,
    /// 变更条目的完整路径
    pub path: String,
}

/// 启动命令行参数（02 启动行为，Task 13 实现并注册）
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliArgs {
    /// --new 已传入（覆盖启动设置，新建未命名文档）
    pub new: bool,
    /// --reopen-file=<path> 或 --reopen-file <path> 的目标路径
    pub reopen_file: Option<String>,
}

/// 解析启动命令行参数（纯函数，供单测）
///
/// 支持两种形态：`--reopen-file <path>` 与 `--reopen-file=<path>`；
/// 其余参数（tauri 自身参数）一律忽略。--new 与 --reopen-file 可同时存在，
/// 优先级裁决（--new 优先）由前端 resolveLaunch 负责。
/// @param args 完整参数列表（含程序名）
/// @returns 结构化启动参数
pub fn parse_cli_args(args: &[String]) -> CliArgs {
    let mut new = false;
    let mut reopen_file: Option<String> = None;
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--new" => new = true,
            "--reopen-file" => {
                // 分离形态：取下一参数为路径（缺省则忽略，防越界）
                if let Some(v) = args.get(i + 1) {
                    reopen_file = Some(v.clone());
                    i += 1;
                }
            }
            a if a.starts_with("--reopen-file=") => {
                reopen_file = Some(a["--reopen-file=".len()..].to_string())
            }
            _ => {}
        }
        i += 1;
    }
    CliArgs { new, reopen_file }
}

/// 启动参数命令（前端 getCliArgs 消费）
#[tauri::command]
pub fn get_cli_args() -> CliArgs {
    parse_cli_args(&std::env::args().collect::<Vec<_>>())
}

/// 读文件命令：编码探测 + 行尾探测（内容统一 UTF-8）
///
/// @param path 目标文件完整路径（拒绝 .. 逃逸）
/// @returns 解码内容 + 编码/行尾元信息；失败返回中文错误
#[tauri::command]
pub fn read_file(path: String) -> Result<ReadResultDto, String> {
    let p = std::path::Path::new(&path);
    assert_safe_path(p)?;
    let bytes = std::fs::read(p).map_err(|e| format!("读取文件失败: {e}"))?;
    let decoded = crate::io::encoding::decode_text(&bytes)?;
    Ok(ReadResultDto {
        content: decoded.text,
        encoding: encoding_name(decoded.encoding).to_string(),
        line_ending: line_ending_name(decoded.line_ending).to_string(),
    })
}

/// 写文件命令：行尾归一 + 原子写（落盘恒 UTF-8 无 BOM）
///
/// @param path 目标文件完整路径（父目录须存在）
/// @param content 完整文档内容（编辑器序列化产物，已补尾换行）
/// @param opts 写盘选项（lineEnding: lf/crlf，非法值回落 lf）
#[tauri::command]
pub fn write_file(path: String, content: String, opts: WriteOptions) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    assert_safe_path(p)?;
    let target = match opts.line_ending.as_str() {
        "crlf" => LineEnding::Crlf,
        // 未知取值按默认 LF（安全回落，不拒绝写盘）
        _ => LineEnding::Lf,
    };
    let normalized = normalize_line_ending(&content, target);
    atomic_write(p, &normalized)
}

/// 目录遍历命令：递归列出根下全部条目（过滤 + 排序，03 扩展）
///
/// @param path 遍历根目录（必须存在）
/// @param ext_filter 扩展名过滤（仅文件；None/null 不过滤）
/// @param opts 过滤/排序选项（None/null 回落 02 语义：目录优先 + 自然序 + 升序）
#[tauri::command]
pub fn list_dir(
    path: String,
    ext_filter: Option<String>,
    opts: Option<ListDirOptions>,
) -> Result<Vec<DirEntry>, String> {
    crate::io::fs::list_dir(
        std::path::Path::new(&path),
        ext_filter.as_deref(),
        opts.as_ref(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    /// 创建独立临时目录（进程内自增后缀防并发冲突）
    fn temp_dir() -> std::path::PathBuf {
        static COUNTER: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
        let n = COUNTER.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        let dir = std::env::temp_dir().join(format!("markwell-cmd-{}-{n}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn read_file_utf8_with_metadata() {
        let dir = temp_dir();
        let p = dir.join("doc.md");
        fs::write(&p, "中文\n第二行").unwrap();
        let out = read_file(p.to_string_lossy().into_owned()).unwrap();
        assert_eq!(out.content, "中文\n第二行");
        assert_eq!(out.encoding, "utf8");
        assert_eq!(out.line_ending, "lf");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn read_file_crlf_detected() {
        let dir = temp_dir();
        let p = dir.join("doc.md");
        fs::write(&p, "a\r\nb\r\n").unwrap();
        let out = read_file(p.to_string_lossy().into_owned()).unwrap();
        assert_eq!(out.line_ending, "crlf");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn read_file_missing_rejected() {
        assert!(read_file("Z:/no-such-file-xyz.md".into()).is_err());
    }

    #[test]
    fn write_file_converts_line_ending() {
        let dir = temp_dir();
        let p = dir.join("doc.md");
        write_file(
            p.to_string_lossy().into_owned(),
            "a\nb\n".into(),
            WriteOptions {
                line_ending: "crlf".into(),
            },
        )
        .unwrap();
        let raw = fs::read(&p).unwrap();
        assert_eq!(String::from_utf8(raw).unwrap(), "a\r\nb\r\n");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn write_file_defaults_to_lf_on_unknown_option() {
        let dir = temp_dir();
        let p = dir.join("doc.md");
        write_file(
            p.to_string_lossy().into_owned(),
            "a\r\nb\r\n".into(),
            WriteOptions {
                line_ending: "weird".into(),
            },
        )
        .unwrap();
        let raw = fs::read(&p).unwrap();
        assert_eq!(String::from_utf8(raw).unwrap(), "a\nb\n");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn write_file_dotdot_rejected() {
        assert!(write_file(
            "a/../b.md".into(),
            "x".into(),
            WriteOptions {
                line_ending: "lf".into()
            }
        )
        .is_err());
    }

    #[test]
    fn list_dir_command_with_filter() {
        let dir = temp_dir();
        fs::write(dir.join("x.md"), "").unwrap();
        fs::write(dir.join("y.txt"), "").unwrap();
        let out = list_dir(dir.to_string_lossy().into_owned(), Some("md".into()), None).unwrap();
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].name, "x.md");
        assert!(!out[0].is_dir);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn parse_cli_args_new_flag() {
        let args = vec!["app.exe".to_string(), "--new".to_string()];
        let out = parse_cli_args(&args);
        assert!(out.new);
        assert!(out.reopen_file.is_none());
    }

    #[test]
    fn parse_cli_args_reopen_file_equals_form() {
        let args = vec![
            "app.exe".to_string(),
            "--reopen-file=C:/docs/a.md".to_string(),
        ];
        let out = parse_cli_args(&args);
        assert!(!out.new);
        assert_eq!(out.reopen_file.as_deref(), Some("C:/docs/a.md"));
    }

    #[test]
    fn parse_cli_args_reopen_file_separate_form() {
        let args = vec![
            "app.exe".to_string(),
            "--reopen-file".to_string(),
            "C:/b.md".to_string(),
        ];
        let out = parse_cli_args(&args);
        assert_eq!(out.reopen_file.as_deref(), Some("C:/b.md"));
    }

    #[test]
    fn parse_cli_args_ignores_unknown_args() {
        let args = vec![
            "app.exe".to_string(),
            "--use-localhost".to_string(),
            "x".to_string(),
        ];
        let out = parse_cli_args(&args);
        assert_eq!(out, CliArgs::default());
    }

    #[test]
    fn parse_cli_args_collects_both_flags() {
        // --new 与 --reopen-file 同时存在：优先级由前端 resolveLaunch 裁决（--new 优先），
        // 本函数只做结构化收集
        let args = vec![
            "app.exe".to_string(),
            "--new".to_string(),
            "--reopen-file=C:/a.md".to_string(),
        ];
        let out = parse_cli_args(&args);
        assert!(out.new);
        assert_eq!(out.reopen_file.as_deref(), Some("C:/a.md"));
    }
}
