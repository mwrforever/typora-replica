// 主题目录服务（08 主题）
//
// 职责：命名规则校验与菜单标签转换（T4 纯函数）、目录扫描（T1）、
// 内置主题预置（T1，clean-room 原创 CSS）、主题命令薄壳。
// 线程安全：纯函数无共享状态；监视句柄生命周期见 watch_themes（Task 9）。
// 命名规则保证的附带性质：合法文件名 URL 安全（小写字母+连字符），拼接
// asset 协议 URL 无需编码（D-10）。
use std::fs;
use std::path::Path;

use serde::Serialize;

/// 主题文件名合法性（AC-T4-2/3，官方规则对齐：非字母字符仅连字符、数字禁用）
///
/// 规则：词干仅小写字母、以连字符分段且分段非空（禁首尾/连续连字符、下划线、
/// 数字、大写），扩展名恒为小写 .css。手写字符循环而非正则：零初始化错误分支
/// （库代码禁 expect），语义与正则 `^[a-z]+(-[a-z]+)*\.css$` 等价。
pub fn is_valid_theme_file_name(file_name: &str) -> bool {
    // 词干 = 剥离末尾 .css；无该后缀直接拒绝（扩展名大小写不放宽——AC-T4-3 同源规则）
    let Some(stem) = file_name.strip_suffix(".css") else {
        return false;
    };
    // 每个连字符分段须非空且全为小写 ASCII 字母：
    // 空段即首尾/连续连字符，非小写字母即数字/大写/下划线等非法字符
    stem.split('-')
        .all(|w| !w.is_empty() && w.chars().all(|c| c.is_ascii_lowercase()))
}

/// 菜单标签转换（AC-T4-1）：连字符分词 + 每词首字母大写
///
/// 输入为词干（不含扩展名）；空段已由命名规则排除，此处 filter 为防御。
pub fn theme_menu_label(name: &str) -> String {
    name.split('-')
        .filter(|w| !w.is_empty())
        .map(|w| {
            // 首字母大写 + 其余原样（合法词干已保证全小写）
            let mut chars = w.chars();
            match chars.next() {
                Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// 主题条目 DTO（camelCase 供前端消费；name=文件名词干，为 settings 持久化键）
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemeDto {
    /// 主题名（文件名词干，settings.theme 存储键）
    pub name: String,
    /// 文件名（含 .css；asset link 拼接用）
    pub file_name: String,
    /// 菜单标签（连字符分词首字母大写，Themes 菜单直接展示）
    pub label: String,
    /// 同名词干 .user.css 是否存在（4 层第 4 层开关）
    pub has_user_css: bool,
}

/// 目录扫描结果 DTO
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemeListDto {
    /// 主题目录绝对路径（前端 convertFileSrc 基准；asset 授权与 link 拼接共用）
    pub dir: String,
    /// 合法主题列表（按名称升序，菜单展示序）
    pub themes: Vec<ThemeDto>,
    /// base.user.css 是否存在（4 层第 3 层开关）
    pub has_base_user_css: bool,
}

/// 目录扫描（T1：合法 .css 过滤 + 排序 + user.css 探测）
///
/// 目录缺失则创建（首启预置/打开目录前的边缘兜底）。
/// 大小写敏感：Windows 文件系统大小写不敏感，`Path::exists()` 会误命中
/// 大小写不同的 {theme}.user.css（AC-T6-3）——一次 read_dir 收集文件名后
/// 精确字符串比对（D-8）。
pub fn scan_themes(dir: &Path) -> Result<ThemeListDto, String> {
    fs::create_dir_all(dir).map_err(|e| format!("创建主题目录失败: {e}"))?;
    let entries = fs::read_dir(dir).map_err(|e| format!("读取主题目录失败: {e}"))?;
    let mut names: Vec<String> = Vec::new();
    for entry in entries {
        let Ok(entry) = entry else { continue };
        // 仅普通文件（用户误放子目录/符号链接不参与匹配）
        if !entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
            continue;
        }
        names.push(entry.file_name().to_string_lossy().into_owned());
    }
    let mut themes: Vec<ThemeDto> = Vec::new();
    for file_name in &names {
        if !is_valid_theme_file_name(file_name) {
            continue;
        }
        // 命名规则已保证 .css 后缀存在，match 兜底防御性跳过（禁 unwrap）
        let Some(name) = file_name.strip_suffix(".css") else {
            continue;
        };
        let has_user_css = names.iter().any(|n| n == &format!("{name}.user.css"));
        themes.push(ThemeDto {
            name: name.to_string(),
            file_name: file_name.clone(),
            label: theme_menu_label(name),
            has_user_css,
        });
    }
    themes.sort_by(|a, b| a.name.cmp(&b.name));
    let has_base_user_css = names.iter().any(|n| n == "base.user.css");
    Ok(ThemeListDto {
        dir: dir.to_string_lossy().into_owned(),
        themes,
        has_base_user_css,
    })
}

/// 内置主题表（词干, CSS 全文）：include_str! 编译期嵌入二进制，打包零配置（D-1）
pub const BUILT_IN_THEMES: &[(&str, &str)] = &[
    (
        "markwell-light",
        include_str!("../../assets/themes/markwell-light.css"),
    ),
    (
        "markwell-dark",
        include_str!("../../assets/themes/markwell-dark.css"),
    ),
];

/// 预置内置主题到主题目录（T1：亮/暗各一套起步）
///
/// 仅缺失才写——用户对内置主题的修改不被启动覆盖；目录缺失则建。
/// @returns 失败返回中文错误（setup 钩子调用方记录日志并降级，不阻断启动）
pub fn ensure_builtin_themes(dir: &Path) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|e| format!("创建主题目录失败: {e}"))?;
    for (name, css) in BUILT_IN_THEMES {
        let target = dir.join(format!("{name}.css"));
        if target.exists() {
            continue;
        }
        fs::write(&target, css).map_err(|e| format!("预置内置主题失败({name}): {e}"))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    // ---- is_valid_theme_file_name ----
    #[test]
    fn valid_names_accepted() {
        assert!(is_valid_theme_file_name("github.css"));
        assert!(is_valid_theme_file_name("my-first-theme.css"));
        assert!(is_valid_theme_file_name("a.css"));
    }

    #[test]
    fn digit_in_name_rejected_ac_t4_2() {
        // 官方规则：数字属非字母字符，含数字的文件名不安装（用户实测回填）
        assert!(!is_valid_theme_file_name("theme2.css"));
        assert!(!is_valid_theme_file_name("my-theme2.css"));
    }

    #[test]
    fn uppercase_rejected_ac_t4_3() {
        assert!(!is_valid_theme_file_name("MyTheme.css"));
        assert!(!is_valid_theme_file_name("my-theme.CSS")); // 扩展名大写同拒
    }

    #[test]
    fn malformed_names_rejected() {
        assert!(!is_valid_theme_file_name("readme.txt")); // 非 css
        assert!(!is_valid_theme_file_name("theme")); // 无扩展名
        assert!(!is_valid_theme_file_name("")); // 空串
        assert!(!is_valid_theme_file_name(".css")); // 空词干
        assert!(!is_valid_theme_file_name("-theme.css")); // 首连字符（空段）
        assert!(!is_valid_theme_file_name("theme-.css")); // 尾连字符
        assert!(!is_valid_theme_file_name("my--theme.css")); // 连续连字符
        assert!(!is_valid_theme_file_name("my_theme.css")); // 下划线
        assert!(!is_valid_theme_file_name("theme.css.bak")); // 扩展名不在末尾
    }

    // ---- theme_menu_label ----
    #[test]
    fn label_splits_and_capitalizes_ac_t4_1() {
        assert_eq!(theme_menu_label("my-first-theme"), "My First Theme");
        assert_eq!(theme_menu_label("github"), "Github");
        assert_eq!(theme_menu_label("a-b-c"), "A B C");
    }

    // ---- scan_themes（测试模块顶部先加 tempdir 助手）----
    fn temp_dir() -> std::path::PathBuf {
        static COUNTER: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
        let n = COUNTER.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        let dir = std::env::temp_dir().join(format!("markwell-themes-{}-{n}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn scan_filters_and_sorts_valid_css_ac_t1_1() {
        let dir = temp_dir();
        fs::write(dir.join("zeta.css"), "x").unwrap();
        fs::write(dir.join("alpha.css"), "x").unwrap();
        fs::write(dir.join("my-first-theme.css"), "x").unwrap();
        // 非法项：数字/大写/非 css/子目录，均不得出现在列表（AC-T4-2/3 的扫描侧证据）
        fs::write(dir.join("theme2.css"), "x").unwrap();
        fs::write(dir.join("NoUpper.css"), "x").unwrap();
        fs::write(dir.join("readme.txt"), "x").unwrap();
        fs::create_dir(dir.join("dir.css")).unwrap();
        let dto = scan_themes(&dir).unwrap();
        let names: Vec<&str> = dto.themes.iter().map(|t| t.name.as_str()).collect();
        assert_eq!(names, vec!["alpha", "my-first-theme", "zeta"]); // 升序 + 过滤
        assert_eq!(dto.themes[1].label, "My First Theme"); // 标签一并输出
        assert_eq!(dto.themes[1].file_name, "my-first-theme.css");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn scan_detects_user_css_case_sensitive_ac_t6_1_2_3() {
        let dir = temp_dir();
        fs::write(dir.join("solar-mint.css"), "x").unwrap();
        fs::write(dir.join("solar-mint.user.css"), "x").unwrap();
        fs::write(dir.join("base.user.css"), "x").unwrap();
        // 大小写不匹配（Windows 文件系统不敏感，扫描必须精确字符串比对——AC-T6-3）
        fs::write(dir.join("SOLAR-MINT.USER.CSS"), "x").unwrap();
        let dto = scan_themes(&dir).unwrap();
        assert!(dto.has_base_user_css);
        let mint = dto.themes.iter().find(|t| t.name == "solar-mint").unwrap();
        assert!(mint.has_user_css); // 精确命中
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn scan_creates_missing_dir_and_returns_empty() {
        let dir = temp_dir().join("not-yet");
        let dto = scan_themes(&dir).unwrap();
        assert!(dir.is_dir()); // 缺失即建（open_theme_folder 首启边缘依赖）
        assert!(dto.themes.is_empty());
        assert!(!dto.has_base_user_css);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn dto_serializes_camel_case_wire_shape() {
        // wire 契约钉桩（D-6：命令层不 mock 直呼，序列化形态在此锁死）
        let dir = temp_dir();
        fs::write(dir.join("solar-mint.css"), "x").unwrap();
        fs::write(dir.join("solar-mint.user.css"), "x").unwrap();
        let json = serde_json::to_value(scan_themes(&dir).unwrap()).unwrap();
        assert_eq!(json["hasBaseUserCss"], serde_json::json!(false));
        assert_eq!(
            json["themes"][0]["fileName"],
            serde_json::json!("solar-mint.css")
        );
        assert_eq!(json["themes"][0]["hasUserCss"], serde_json::json!(true));
        assert!(json["dir"].is_string());
        let _ = fs::remove_dir_all(&dir);
    }

    // ---- ensure_builtin_themes ----
    #[test]
    fn builtin_seeded_when_missing() {
        let dir = temp_dir();
        ensure_builtin_themes(&dir).unwrap();
        for (name, css) in BUILT_IN_THEMES {
            let path = dir.join(format!("{name}.css"));
            assert!(path.is_file(), "内置主题 {name} 未预置");
            assert_eq!(fs::read_to_string(&path).unwrap(), *css);
        }
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn builtin_existing_file_not_overwritten() {
        // 用户可能修改内置主题（Typora 惯例）：已存在不覆盖
        let dir = temp_dir();
        fs::write(dir.join("markwell-light.css"), "/* 用户自定义 */").unwrap();
        ensure_builtin_themes(&dir).unwrap();
        assert_eq!(
            fs::read_to_string(dir.join("markwell-light.css")).unwrap(),
            "/* 用户自定义 */"
        );
        // 另一套（缺失）仍正常预置
        assert!(dir.join("markwell-dark.css").is_file());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn builtin_ensure_creates_missing_dir() {
        let dir = temp_dir().join("nested/themes");
        ensure_builtin_themes(&dir).unwrap();
        assert!(dir.join("markwell-light.css").is_file());
        let _ = fs::remove_dir_all(&dir);
    }
}
