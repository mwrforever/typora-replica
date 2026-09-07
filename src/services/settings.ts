// 偏好设置（02 文档管理，store 插件持久化）
//
// 键值：autoSave（开关+定时分钟）、defaultLineEnding（落盘行尾）、
// launch（启动行为：模式/自定义路径/上次文件夹/上次文件）、
// outline（大纲视图：折叠开关）、
// image（图片插入：copy to folder 开关+目标目录+相对路径+./ 前缀+URL 转义+插入行为）、
// theme（主题：亮/暗模式主题名）、
// export（导出：位置三模式+自定义目录+Include Outline+PDF 页眉页脚+h1 分页
// +YAML 覆盖/HTML head-body/HTML 主题/PDF 边距四预留键——09 导出管线后续迭代消费）、
// appearance（10 设置面板：状态栏+字号+阅读速度）、
// editor（10 设置面板：auto pair 括号与 Markdown 语法开关）、
// markdown（10 设置面板：语法开关组+代码围栏子组，随编辑器 create 注入、重启生效）。
// 自动保存默认开（差异化于 Typora 默认关——spec 待把关项按调研建议裁决，数据安全优先）。
import { load } from "@tauri-apps/plugin-store";
import type { LineEnding } from "./file-io";

/** 启动行为模式 */
export type LaunchMode = "new" | "restore-folder" | "restore-both" | "custom-folder";

/** 启动行为设置 */
export interface LaunchSettings {
  /** 启动模式：新建/恢复文件夹/恢复文件与文件夹/自定义文件夹 */
  mode: LaunchMode;
  /** 自定义文件夹路径（mode=custom-folder 时生效） */
  customPath: string;
  /** 上次打开的文件夹（restore-folder/restore-both 恢复目标） */
  lastFolder?: string;
  /** 上次打开的文件（restore-both 恢复目标） */
  lastFile?: string;
}

/** 自动保存设置 */
export interface AutoSaveSettings {
  /** 总开关（默认开） */
  enabled: boolean;
  /** 定时兜底分钟数（默认 5） */
  timerMinutes: number;
}

/** 大纲视图设置 */
export interface OutlineSettings {
  /** 大纲视图允许折叠和展开（默认 false = Flat，AC-F22-1） */
  collapsible: boolean;
}

/** 图片插入设置（07；四开关默认全关对齐 Typora 用户实测） */
export interface ImageSettings {
  /** copy to folder 总开关（关闭时粘贴图片不落盘，仅生成临时预览） */
  copyToFolderEnabled: boolean;
  /** 目标文件夹绝对路径（空串=未配置） */
  copyTargetDir: string;
  /** relative path 开关（存盘后插入相对引用而非绝对路径） */
  relativePathEnabled: boolean;
  /** ./ prefix 开关（相对引用前补 ./ 前缀） */
  dotSlashPrefixEnabled: boolean;
  /** URL 转义开关（路径含空格/特殊字符时按 JS escape() 语义转义，%XX/%uXXXX，非 RFC 3986 百分号编码） */
  urlEscapeEnabled: boolean;
  /** 插入时处理范围：仅本地图片 / 含在线图片（12.4；消费方为云上传接入后的 07 管线）
   * TODO(image-upload): 云上传接入后由 07 消费该键，计划于图片上传迭代引入 */
  insertBehavior: "local-only" | "all";
}

/** 主题设置（08；明暗分离存储，mode → 主题名映射） */
export interface ThemeSettings {
  /** 亮色模式主题名（文件名词干；设置值失效时由主题层回落内置主题） */
  lightTheme: string;
  /** 暗色模式主题名 */
  darkTheme: string;
}

/** 导出设置（09；HTML/PDF 导出共用面） */
export interface ExportSettings {
  /** 导出位置三选项：auto（文档目录优先）/ document-dir（同目录）/ custom（自定义目录） */
  locationMode: "auto" | "document-dir" | "custom";
  /** 自定义目录绝对路径（空串 = 未配置，custom 模式回落 auto 语义） */
  customDir: string;
  /** HTML 导出 Include Outline（body 前置大纲，默认关） */
  includeOutline: boolean;
  /** PDF 页眉模板（${title}/${pageNo}/${pageCount}；空串 = 不启用页眉） */
  pdfHeader: string;
  /** PDF 页脚模板（空串 = 不启用页脚） */
  pdfFooter: string;
  /** PDF h1 章节分页开关（默认关） */
  pdfPageBreakH1: boolean;
  /** YAML front matter 覆盖导出设置开关（默认关）
   * TODO(export): 09 导出管线后续迭代消费，计划于导出增强迭代引入 */
  yamlOverrides: boolean;
  /** HTML 导出追加 head/body 标签内容开关（默认关）
   * TODO(export): 09 导出管线后续迭代消费，计划于导出增强迭代引入 */
  htmlAppendHeadBody: boolean;
  /** HTML 导出主题名（空串 = 跟随当前主题）
   * TODO(export): 09 导出管线后续迭代消费，计划于导出增强迭代引入 */
  htmlThemeOverride: string;
  /** PDF 页边距（英寸，默认 0.4）
   * TODO(export): 09 导出管线后续迭代消费，计划于导出增强迭代引入 */
  pdfMarginIn: number;
}

/** 外观设置（10 设置面板；12.1 Appearance 分区） */
export interface AppearanceSettings {
  /** 状态栏显隐（默认开——调研自定；消费方 11 状态栏装配） */
  showStatusBar: boolean;
  /** 编辑器字号 px；undefined = 跟随主题（调研自定；消费方 11/12 装配） */
  fontSize?: number;
  /** 阅读速度 words/min（阅读时间统计口径，默认 200 自定；消费方 11） */
  readingSpeed: number;
}

/** 编辑器行为设置（12.2；auto pair 输入规则随编辑器 create 注入，重启生效） */
export interface EditorSettings {
  /** 自动配对括号/引号（默认开，01 实测口径） */
  autoPairBrackets: boolean;
  /** 自动配对 Markdown 语法标记（默认开） */
  autoPairMarkdown: boolean;
}

/** 代码围栏选项（12.3 Code Fences 子组；渲染与输入规则重启注入，重启生效） */
export interface CodeFenceSettings {
  /** 显示行号（默认关，调研自定） */
  lineNumbers: boolean;
  /** 长行自动换行（默认关，调研自定） */
  wrapLongLines: boolean;
  /** Shift+Tab 缩进选中行（默认开，官方载明） */
  shiftTabIndent: boolean;
  /** 缩进宽度（空格数，默认 4） */
  indentWidth: number;
  /** 默认代码语言（空串 = 无） */
  defaultLanguage: string;
  /** 新围栏使用上次语言（Last Used 语义，默认开；defaultLanguage 非空时优先） */
  useLastUsedLanguage: boolean;
}

/** Markdown 语法开关（12.3；schema/输入规则随编辑器 create 注入，重启生效） */
export interface MarkdownSettings {
  /** 行内数学（默认关，01 实测） */
  inlineMath: boolean;
  /** 图表（mermaid 类围栏渲染，默认关） */
  diagrams: boolean;
  /** 严格模式（官方载明需重启） */
  strictMode: boolean;
  /** ==高亮== 语法（默认关，自定） */
  highlight: boolean;
  /** 上标语法（默认关） */
  superscript: boolean;
  /** 下标语法（默认关） */
  subscript: boolean;
  /** 拼写检查（默认关） */
  spellcheck: boolean;
  /** 代码围栏选项组 */
  codeFence: CodeFenceSettings;
}

/** 应用偏好 */
export interface AppSettings {
  autoSave: AutoSaveSettings;
  /** 落盘行尾（默认 lf） */
  defaultLineEnding: LineEnding;
  launch: LaunchSettings;
  outline: OutlineSettings;
  /** 图片插入（07 模块消费） */
  image: ImageSettings;
  /** 主题（08 模块消费） */
  theme: ThemeSettings;
  /** 导出（09 模块消费） */
  export: ExportSettings;
  /** 外观（10 模块消费） */
  appearance: AppearanceSettings;
  /** 编辑器行为（10 模块消费） */
  editor: EditorSettings;
  /** Markdown 语法开关（10 模块消费） */
  markdown: MarkdownSettings;
}

/** 默认偏好（缺失键回落基准） */
export const DEFAULT_SETTINGS: AppSettings = {
  autoSave: { enabled: true, timerMinutes: 5 },
  defaultLineEnding: "lf",
  launch: { mode: "restore-folder", customPath: "" },
  outline: { collapsible: false },
  image: {
    copyToFolderEnabled: false,
    copyTargetDir: "",
    relativePathEnabled: false,
    dotSlashPrefixEnabled: false,
    urlEscapeEnabled: false,
    // 云上传首版未开放，仅本地图片进入处理管线（12.4 存储面先行，消费归图片上传迭代）
    insertBehavior: "local-only",
  },
  // 默认名与 Rust BUILT_IN_THEMES 预置文件同名，首启即可解析到主题
  theme: { lightTheme: "markwell-light", darkTheme: "markwell-dark" },
  // 导出默认：位置 auto、大纲关、页眉页脚空、h1 分页关（不改变用户最小导出预期）；
  // 四预留键默认关/空（与既有导出行为零差异，09 后续迭代消费时再启用）
  export: {
    locationMode: "auto",
    customDir: "",
    includeOutline: false,
    pdfHeader: "",
    pdfFooter: "",
    pdfPageBreakH1: false,
    yamlOverrides: false,
    htmlAppendHeadBody: false,
    htmlThemeOverride: "",
    pdfMarginIn: 0.4,
  },
  // 外观默认：状态栏开、字号跟随主题（fontSize 缺省 = undefined）、阅读速度 200 词/分（调研自定）
  appearance: { showStatusBar: true, readingSpeed: 200 },
  // 编辑器行为默认：auto pair 全开（01 实测口径，不改变既有输入体验）
  editor: { autoPairBrackets: true, autoPairMarkdown: true },
  // Markdown 语法默认全关（01 实测行内数学关 + 其余自定，保持既有渲染行为零变化）；
  // codeFence：行号/换行关、Shift+Tab 缩进开（官方载明）、缩进 4、无默认语言、Last Used 开
  markdown: {
    inlineMath: false,
    diagrams: false,
    strictMode: false,
    highlight: false,
    superscript: false,
    subscript: false,
    spellcheck: false,
    codeFence: {
      lineNumbers: false,
      wrapLongLines: false,
      shiftTabIndent: true,
      indentWidth: 4,
      defaultLanguage: "",
      useLastUsedLanguage: true,
    },
  },
};

/** store 文件名（tauri-plugin-store 自动持久化到 app 数据目录） */
const STORE_FILE = "markwell-settings.json";

/** 读取偏好（缺失键逐层回落默认值） */
export async function loadSettings(): Promise<AppSettings> {
  const store = await load(STORE_FILE, { autoSave: true });
  const stored = {
    autoSave: ((await store.get("autoSave")) ?? {}) as Partial<AutoSaveSettings>,
    defaultLineEnding: (await store.get("defaultLineEnding")) as LineEnding | undefined,
    launch: ((await store.get("launch")) ?? {}) as Partial<LaunchSettings>,
    outline: ((await store.get("outline")) ?? {}) as Partial<OutlineSettings>,
    image: ((await store.get("image")) ?? {}) as Partial<ImageSettings>,
    theme: ((await store.get("theme")) ?? {}) as Partial<ThemeSettings>,
    export: ((await store.get("export")) ?? {}) as Partial<ExportSettings>,
    appearance: ((await store.get("appearance")) ?? {}) as Partial<AppearanceSettings>,
    editor: ((await store.get("editor")) ?? {}) as Partial<EditorSettings>,
    markdown: ((await store.get("markdown")) ?? {}) as Partial<MarkdownSettings>,
  };
  // codeFence 子组存量可能整体缺失（10 之前的存量数据无该键），先兜空对象再逐键回落
  const storedCodeFence = (stored.markdown.codeFence ?? {}) as Partial<CodeFenceSettings>;
  return {
    autoSave: {
      enabled: stored.autoSave.enabled ?? DEFAULT_SETTINGS.autoSave.enabled,
      timerMinutes: stored.autoSave.timerMinutes ?? DEFAULT_SETTINGS.autoSave.timerMinutes,
    },
    defaultLineEnding: stored.defaultLineEnding ?? DEFAULT_SETTINGS.defaultLineEnding,
    launch: {
      mode: stored.launch.mode ?? DEFAULT_SETTINGS.launch.mode,
      customPath: stored.launch.customPath ?? DEFAULT_SETTINGS.launch.customPath,
      lastFolder: stored.launch.lastFolder,
      lastFile: stored.launch.lastFile,
    },
    outline: {
      collapsible: stored.outline.collapsible ?? DEFAULT_SETTINGS.outline.collapsible,
    },
    image: {
      copyToFolderEnabled:
        stored.image.copyToFolderEnabled ?? DEFAULT_SETTINGS.image.copyToFolderEnabled,
      // 空串是合法存量值（=未配置），仅 undefined 回落默认
      copyTargetDir: stored.image.copyTargetDir ?? DEFAULT_SETTINGS.image.copyTargetDir,
      relativePathEnabled:
        stored.image.relativePathEnabled ?? DEFAULT_SETTINGS.image.relativePathEnabled,
      dotSlashPrefixEnabled:
        stored.image.dotSlashPrefixEnabled ?? DEFAULT_SETTINGS.image.dotSlashPrefixEnabled,
      urlEscapeEnabled: stored.image.urlEscapeEnabled ?? DEFAULT_SETTINGS.image.urlEscapeEnabled,
      insertBehavior: stored.image.insertBehavior ?? DEFAULT_SETTINGS.image.insertBehavior,
    },
    theme: {
      lightTheme: stored.theme.lightTheme ?? DEFAULT_SETTINGS.theme.lightTheme,
      darkTheme: stored.theme.darkTheme ?? DEFAULT_SETTINGS.theme.darkTheme,
    },
    export: {
      locationMode: stored.export.locationMode ?? DEFAULT_SETTINGS.export.locationMode,
      // 空串是合法存量值（=未配置），仅 undefined 回落默认
      customDir: stored.export.customDir ?? DEFAULT_SETTINGS.export.customDir,
      includeOutline: stored.export.includeOutline ?? DEFAULT_SETTINGS.export.includeOutline,
      pdfHeader: stored.export.pdfHeader ?? DEFAULT_SETTINGS.export.pdfHeader,
      pdfFooter: stored.export.pdfFooter ?? DEFAULT_SETTINGS.export.pdfFooter,
      pdfPageBreakH1: stored.export.pdfPageBreakH1 ?? DEFAULT_SETTINGS.export.pdfPageBreakH1,
      yamlOverrides: stored.export.yamlOverrides ?? DEFAULT_SETTINGS.export.yamlOverrides,
      htmlAppendHeadBody:
        stored.export.htmlAppendHeadBody ?? DEFAULT_SETTINGS.export.htmlAppendHeadBody,
      // 空串是合法存量值（=跟随当前主题），仅 undefined 回落默认
      htmlThemeOverride:
        stored.export.htmlThemeOverride ?? DEFAULT_SETTINGS.export.htmlThemeOverride,
      pdfMarginIn: stored.export.pdfMarginIn ?? DEFAULT_SETTINGS.export.pdfMarginIn,
    },
    appearance: {
      showStatusBar: stored.appearance.showStatusBar ?? DEFAULT_SETTINGS.appearance.showStatusBar,
      // 字号无回落键：undefined 直通 = 跟随主题（显式"未设置"语义，不落默认数值）
      fontSize: stored.appearance.fontSize,
      readingSpeed: stored.appearance.readingSpeed ?? DEFAULT_SETTINGS.appearance.readingSpeed,
    },
    editor: {
      autoPairBrackets: stored.editor.autoPairBrackets ?? DEFAULT_SETTINGS.editor.autoPairBrackets,
      autoPairMarkdown: stored.editor.autoPairMarkdown ?? DEFAULT_SETTINGS.editor.autoPairMarkdown,
    },
    markdown: {
      inlineMath: stored.markdown.inlineMath ?? DEFAULT_SETTINGS.markdown.inlineMath,
      diagrams: stored.markdown.diagrams ?? DEFAULT_SETTINGS.markdown.diagrams,
      strictMode: stored.markdown.strictMode ?? DEFAULT_SETTINGS.markdown.strictMode,
      highlight: stored.markdown.highlight ?? DEFAULT_SETTINGS.markdown.highlight,
      superscript: stored.markdown.superscript ?? DEFAULT_SETTINGS.markdown.superscript,
      subscript: stored.markdown.subscript ?? DEFAULT_SETTINGS.markdown.subscript,
      spellcheck: stored.markdown.spellcheck ?? DEFAULT_SETTINGS.markdown.spellcheck,
      codeFence: {
        lineNumbers: storedCodeFence.lineNumbers ?? DEFAULT_SETTINGS.markdown.codeFence.lineNumbers,
        wrapLongLines:
          storedCodeFence.wrapLongLines ?? DEFAULT_SETTINGS.markdown.codeFence.wrapLongLines,
        shiftTabIndent:
          storedCodeFence.shiftTabIndent ?? DEFAULT_SETTINGS.markdown.codeFence.shiftTabIndent,
        indentWidth: storedCodeFence.indentWidth ?? DEFAULT_SETTINGS.markdown.codeFence.indentWidth,
        defaultLanguage:
          storedCodeFence.defaultLanguage ?? DEFAULT_SETTINGS.markdown.codeFence.defaultLanguage,
        useLastUsedLanguage:
          storedCodeFence.useLastUsedLanguage ??
          DEFAULT_SETTINGS.markdown.codeFence.useLastUsedLanguage,
      },
    },
  };
}

/** 更新偏好（深合并后写回并返回新值；调用方拿返回值继续链路） */
export async function updateSettings(
  // launch/outline/image/theme/export/appearance/editor/markdown 允许部分字段且均走纯
  // Partial（文档会话等调用方只传 lastFile/lastFolder、05 大纲只传 collapsible、07 图片
  // 粘贴只传 image 组内增量、08 主题切换只传 lightTheme/darkTheme 单键、09 导出装配只传
  // export 组内增量、10 面板传各新组增量）——与 launch/outline 同一收口机制：排除在 Omit
  // 外单独声明 Partial，避免「整组必填」误约束增量调用方；markdown.codeFence 子组单独
  // Partial（面板只改缩进宽度等单字段，codeFence 整组必填会误约束）
  patch: Partial<
    Omit<
      AppSettings,
      "launch" | "outline" | "image" | "theme" | "export" | "appearance" | "editor" | "markdown"
    >
  > & {
    launch?: Partial<LaunchSettings>;
    outline?: Partial<OutlineSettings>;
    image?: Partial<ImageSettings>;
    theme?: Partial<ThemeSettings>;
    export?: Partial<ExportSettings>;
    appearance?: Partial<AppearanceSettings>;
    editor?: Partial<EditorSettings>;
    markdown?: Partial<Omit<MarkdownSettings, "codeFence">> & {
      codeFence?: Partial<CodeFenceSettings>;
    };
  },
): Promise<AppSettings> {
  const current = await loadSettings();
  const next: AppSettings = {
    autoSave: { ...current.autoSave, ...patch.autoSave },
    defaultLineEnding: patch.defaultLineEnding ?? current.defaultLineEnding,
    launch: { ...current.launch, ...patch.launch },
    outline: { ...current.outline, ...patch.outline },
    image: { ...current.image, ...patch.image },
    theme: { ...current.theme, ...patch.theme },
    export: { ...current.export, ...patch.export },
    appearance: { ...current.appearance, ...patch.appearance },
    editor: { ...current.editor, ...patch.editor },
    // codeFence 嵌套深合并：单字段增量（如仅 indentWidth）不丢同组其余键
    markdown: {
      ...current.markdown,
      ...patch.markdown,
      codeFence: { ...current.markdown.codeFence, ...patch.markdown?.codeFence },
    },
  };
  const store = await load(STORE_FILE, { autoSave: true });
  await store.set("autoSave", next.autoSave);
  await store.set("defaultLineEnding", next.defaultLineEnding);
  await store.set("launch", next.launch);
  await store.set("outline", next.outline);
  await store.set("image", next.image);
  await store.set("theme", next.theme);
  await store.set("export", next.export);
  await store.set("appearance", next.appearance);
  await store.set("editor", next.editor);
  await store.set("markdown", next.markdown);
  return next;
}

/** 设置失效事件名（10 设置面板保存后 dispatch；07 图片设置快照监听刷新——对接契约） */
export const SETTINGS_INVALIDATED_EVENT = "markwell-settings-updated";
