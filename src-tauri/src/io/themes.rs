// 主题目录服务（08 主题）
//
// 职责：命名规则校验与菜单标签转换（T4 纯函数）、目录扫描（T1）、
// 内置主题预置（T1，clean-room 原创 CSS）、主题命令薄壳。
// 线程安全：纯函数无共享状态；监视句柄生命周期见 watch_themes（Task 9）。
// 命名规则保证的附带性质：合法文件名 URL 安全（小写字母+连字符），拼接
// asset 协议 URL 无需编码（D-10）。

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

#[cfg(test)]
mod tests {
    use super::*;

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
}
