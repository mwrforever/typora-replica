// 草稿备份与恢复（02 文档管理，F31 草稿）
//
// 草稿目录自定（app 数据目录 drafts/）；命名 {YYYY-MM-DD}-{文件名}.md，
// 未命名文档文件名由前端以首标题/首句生成后传入（本模块只做清洗与去重）。
// 恢复语义：读取内容后删除原草稿（恢复即清理，防堆积）。
// 已知取舍：日期用 UTC（无 chrono 依赖；Windows 本地时区 ±1 天边缘，12 可换）。
// 线程安全：无共享状态。
use crate::io::atomic::assert_safe_path;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Manager;

/// 草稿根目录（app 数据目录下 drafts/）
pub fn drafts_root(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("drafts")
}

/// 文件名清洗：非法字符与控制字符 → `_`；trim 空白；截断 100 字符；空 → "未命名"
///
/// @param name 原始文件名（可含路径非法字符）
/// @returns 安全文件名（不含分隔符）
pub fn sanitize_file_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| {
            if c.is_control() || "\\/:*?\"<>|".contains(c) {
                '_'
            } else {
                c
            }
        })
        .collect();
    let trimmed = cleaned.trim().to_string();
    if trimmed.is_empty() {
        "未命名".to_string()
    } else if trimmed.chars().count() > 100 {
        trimmed.chars().take(100).collect()
    } else {
        trimmed
    }
}

/// 今日日期（UTC，YYYY-MM-DD）
///
/// civil_from_days（Howard Hinnant 算法）：Unix 秒 → 天数 → 公历日期，
/// 无外部时间库依赖。
pub fn today_utc() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let days = (secs / 86_400) as i64;
    let (y, m, d) = civil_from_days(days);
    format!("{y:04}-{m:02}-{d:02}")
}

/// 天数 → 公历（Hinnant 算法，返回 (年, 月, 日)）
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

/// 保存草稿：`{YYYY-MM-DD}-{清洗名}.md`，重名追加 -1/-2 去重
///
/// @param dir 草稿目录（不存在自动创建）
/// @param file_name 原始文件名（未命名文档传前端提取的首标题/首句；已含 .md 扩展名则先剥除，
///   避免拼出 `{date}-名.md.md` 双扩展名——brief 测试锁定单扩展名）
/// @param content 草稿内容（编辑器序列化产物，已补尾换行）
/// @returns 实际保存的草稿完整路径
pub fn save_draft(dir: &Path, file_name: &str, content: &str) -> Result<PathBuf, String> {
    fs::create_dir_all(dir).map_err(|e| format!("创建草稿目录失败: {e}"))?;
    let sanitized = sanitize_file_name(file_name);
    let stem = sanitized.strip_suffix(".md").unwrap_or(&sanitized);
    let base = format!("{}-{}", today_utc(), stem);
    let mut candidate = dir.join(format!("{base}.md"));
    let mut n = 1;
    while candidate.exists() {
        candidate = dir.join(format!("{base}-{n}.md"));
        n += 1;
    }
    fs::write(&candidate, content).map_err(|e| format!("草稿写入失败: {e}"))?;
    Ok(candidate)
}

/// 列出全部草稿（按文件名日期倒序，最新在前）
///
/// @param dir 草稿目录（不存在返回空列表）
/// @returns 草稿条目列表
pub fn list_drafts(dir: &Path) -> Result<Vec<crate::io::commands::DraftEntry>, String> {
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let mut drafts: Vec<crate::io::commands::DraftEntry> = Vec::new();
    for entry in fs::read_dir(dir).map_err(|e| format!("读取草稿目录失败: {e}"))? {
        let entry = entry.map_err(|e| format!("读取草稿目录项失败: {e}"))?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if !name.ends_with(".md") {
            continue;
        }
        // 日期前缀按 get(..10) 字符边界安全切片：自产草稿前 10 字节恒为 ASCII 日期，
        // 但用户手动放入的非 ASCII 起始文件名（如 `笔记一二.md`，15 字节）第 10 字节
        // 可能落在多字节字符中间，旧 `name[..10]` 字节切片会 panic（违反库禁 panic 规则）；
        // 非字符边界或不足 10 字节时返回 None，date 置空串
        let date = name.get(..10).map(|s| s.to_string()).unwrap_or_default();
        drafts.push(crate::io::commands::DraftEntry {
            path: entry.path().to_string_lossy().into_owned(),
            name,
            date,
        });
    }
    // 倒序：日期字符串前缀 + 序号后缀，字典序倒排即最新在前
    drafts.sort_by(|a, b| b.name.cmp(&a.name));
    Ok(drafts)
}

/// 恢复草稿：读取内容并删除原草稿（恢复即清理）
///
/// @param dir 草稿目录
/// @param file_name 草稿文件名（仅文件名，拒绝路径分隔符与 .. 逃逸）
/// @returns 草稿内容（UTF-8）
pub fn recover_draft(dir: &Path, file_name: &str) -> Result<String, String> {
    if file_name.contains('/') || file_name.contains('\\') || file_name.contains("..") {
        return Err("草稿文件名非法（禁止路径分隔符与逃逸）".to_string());
    }
    let p = dir.join(file_name);
    assert_safe_path(&p)?;
    let content = fs::read_to_string(&p).map_err(|e| format!("读取草稿失败: {e}"))?;
    fs::remove_file(&p).map_err(|e| format!("删除草稿失败: {e}"))?;
    Ok(content)
}

/// 命令：保存草稿（app 数据目录下 drafts/）
#[tauri::command]
pub fn save_draft_cmd(
    app: tauri::AppHandle,
    file_name: String,
    content: String,
) -> Result<String, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("获取应用数据目录失败: {e}"))?;
    let saved = save_draft(&drafts_root(&dir), &file_name, &content)?;
    Ok(saved.to_string_lossy().into_owned())
}

/// 命令：列出草稿（日期倒序）
#[tauri::command]
pub fn list_drafts_cmd(
    app: tauri::AppHandle,
) -> Result<Vec<crate::io::commands::DraftEntry>, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("获取应用数据目录失败: {e}"))?;
    list_drafts(&drafts_root(&dir))
}

/// 命令：恢复草稿（读后删除，内容转 UTF-8 探测返回）
#[tauri::command]
pub fn recover_draft_cmd(
    app: tauri::AppHandle,
    file_name: String,
) -> Result<crate::io::commands::ReadResultDto, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("获取应用数据目录失败: {e}"))?;
    let content = recover_draft(&drafts_root(&dir), &file_name)?;
    let decoded = crate::io::encoding::decode_text(content.as_bytes())?;
    Ok(crate::io::commands::ReadResultDto {
        content: decoded.text,
        encoding: crate::io::encoding::encoding_name(decoded.encoding).to_string(),
        line_ending: crate::io::encoding::line_ending_name(decoded.line_ending).to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    /// 创建独立临时目录（进程内自增后缀防并发冲突）
    fn temp_dir() -> std::path::PathBuf {
        static COUNTER: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
        let n = COUNTER.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        let dir = std::env::temp_dir().join(format!("markwell-draft-{}-{n}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn draft_naming_rule() {
        let dir = temp_dir();
        let p = save_draft(&dir, "笔记.md", "内容").unwrap();
        let name = p.file_name().unwrap().to_string_lossy().into_owned();
        // {YYYY-MM-DD}-笔记.md
        assert!(name.len() > 10, "name={name}");
        assert_eq!(&name[10..], "-笔记.md");
        assert!(fs::read_to_string(&p).unwrap() == "内容");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn duplicate_names_suffixed() {
        let dir = temp_dir();
        let p1 = save_draft(&dir, "a.md", "1").unwrap();
        let p2 = save_draft(&dir, "a.md", "2").unwrap();
        let n1 = p1.file_name().unwrap().to_string_lossy().into_owned();
        let n2 = p2.file_name().unwrap().to_string_lossy().into_owned();
        assert_ne!(n1, n2);
        assert!(n2.contains("-1.md"), "n2={n2}");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn sanitize_illegal_chars() {
        // 输入含 9 个非法字符：c 之前 2 个（/、\）成为分隔下划线，c 之后 7 个（:*?"<>|）连成 7 个下划线。
        // 故期望 = a_b_c + 7 个下划线 + d；brief 原字面量 `a_b_c_________d` 为 11 个下划线（笔误），
        // 此处以 repeat(7) 精确构造期望值。
        assert_eq!(
            sanitize_file_name("a/b\\c:*?\"<>|d"),
            format!("a_b_c{}d", "_".repeat(7))
        );
        assert_eq!(sanitize_file_name("  ..  "), ".."); // trim 后点仍保留（不 trim 点）
        assert_eq!(sanitize_file_name("   "), "未命名");
        assert_eq!(sanitize_file_name(""), "未命名");
        let long = "x".repeat(200);
        assert_eq!(sanitize_file_name(&long).len(), 100);
    }

    #[test]
    fn list_drafts_newest_first() {
        let dir = temp_dir();
        let older = dir.join("2026-08-01-old.md");
        let newer = dir.join("2026-08-15-new.md");
        fs::write(&older, "a").unwrap();
        fs::write(&newer, "b").unwrap();
        let drafts = list_drafts(&dir).unwrap();
        assert_eq!(drafts.len(), 2);
        assert_eq!(drafts[0].name, "2026-08-15-new.md");
        assert_eq!(drafts[0].date, "2026-08-15");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn list_drafts_non_ascii_name_no_panic() {
        let dir = temp_dir();
        // 非 ASCII 起始文件名：UTF-8 共 15 字节且第 10 字节落在多字节字符（二）中间，
        // 旧实现 name[..10] 字节切片必 panic；get(..10) 应安全返回且 date 置空串
        let weird = dir.join("笔记一二.md");
        fs::write(&weird, "x").unwrap();
        let drafts = list_drafts(&dir).unwrap();
        assert_eq!(drafts.len(), 1);
        assert_eq!(drafts[0].name, "笔记一二.md");
        assert_eq!(drafts[0].date, "");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn recover_reads_and_removes() {
        let dir = temp_dir();
        let p = dir.join("2026-08-15-x.md");
        fs::write(&p, "内容").unwrap();
        let content = recover_draft(&dir, "2026-08-15-x.md").unwrap();
        assert_eq!(content, "内容");
        assert!(!p.exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn recover_rejects_path_traversal() {
        let dir = temp_dir();
        assert!(recover_draft(&dir, "../evil.md").is_err());
        assert!(recover_draft(&dir, "sub/evil.md").is_err());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn today_utc_format() {
        let t = today_utc();
        assert_eq!(t.len(), 10);
        assert_eq!(&t[4..5], "-");
        assert_eq!(&t[7..8], "-");
    }
}
