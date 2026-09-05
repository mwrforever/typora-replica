# E2E 测试说明

本项目有两套端到端验证，覆盖相同的验证目标（应用启动、前端渲染、编辑器挂载）：

## 0. 跑前必读：debug 二进制时效

拉取（或切换到）含 **Rust 侧变更**（新增/修改 Tauri command、插件接线等）的分支后，
必须先重编 debug 二进制再跑 WebDriver E2E，否则 tauri-driver 拉起的是
`src-tauri/target/debug/typora-replica.exe` 旧产物——缺新命令时前端 invoke 静默降级
（catch 后保底），用例表现为「元素在但状态不更新」的假红：

```bash
cd src-tauri && cargo build && cd ..   # 先于 npm run test:e2e 执行
```

事故案例（2026-08-26，07 模块 T12）：image-display E2E 首轮断言 img.src 未解析为
asset 协议 URL——二进制落后两天提交，缺 `resolve_image_path` 运行时授权链路；
`cargo build` 重编后同一用例即绿。

## 0.1 theme.e2e.ts 的系统色系前提

theme E2E 依赖系统亮色（D-3「系统跟随」注入：默认激活 markwell-light，本机系统为
暗色时用例假红）。WebView2 152 起忽略 `WEBVIEW2_*` 环境变量通道（宪法 C.6.5 同类
先例），置亮只能走注册表；跑完须还原原值（已实测）：

```bash
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize" /v AppsUseLightTheme /t REG_DWORD /d 1 /f   # 运行前临时置亮
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize" /v AppsUseLightTheme /t REG_DWORD /d 0 /f   # 同一 shell finally 还原为暗色原值 0
```

## 1. CI 冒烟测试（GitHub Actions，确定性验证）

- 脚本：`e2e/smoke-ci.mjs`
- 原理：以进程/网络层证据做确定性断言——
  1. 应用进程启动并存活（tasklist）
  2. WebView2 初始化（子进程存活 + user data 目录建立）
  3. 前端页面真实加载（WebView2 进程与 vite dev server 建立 ESTABLISHED 连接）
- 触发：Build Verification workflow 的 e2e job（PR 与 main 推送）

### 为什么 CI 不用 CDP/WebDriver

CI runner 镜像自带 WebView2 Runtime **150.0.4078.105**，该版本存在微软上游回归
（WebView2Feedback#5639）：宿主进程**提权**时 CDP 调试端口静默不监听。runner 的
job 进程天生提权，导致所有依赖调试端口的方案（msedgedriver/WebdriverIO、
`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` 注入、固定端口直连）在 CI 均不可用。
已尝试并排除：runas 降权（服务上下文静默失败）、schtasks /IT 降权与新建非管理
用户（疑 runner 禁用 UAC，令牌仍提权）、151 固定版本运行库（不理会调试参数环境
变量与注册表策略注入）、安装器升级（服务会话挂起）。本地（WebView2 151、非提权）
全部正常。

因此 CI 冒烟不依赖调试端口，改验证「应用能启动、WebView2 能初始化、前端能加载」。
待微软修复回归或 runner 镜像升级 WebView2 后，可将 CI 恢复为完整 CDP 方案。

## 2. 完整 WebDriver E2E（本地执行）

- 配置：`e2e/wdio.conf.ts`，用例：`e2e/specs/*.e2e.ts`
- 技术：WebdriverIO 9 + tauri-driver + msedgedriver
- 前置：先启动 Vite dev server 与 tauri-driver，再执行

```bash
npm run dev &                       # 终端 1：前端 dev server
tauri-driver --native-driver e2e/.driver/msedgedriver.exe &   # 终端 2：WebDriver 服务
npm run test:e2e                    # 终端 3：运行测试
```

驱动下载（需与 Edge/WebView2 版本匹配）：

```bash
mkdir -p e2e/.driver
EDGEDRIVER_CACHE_DIR="$PWD/e2e/.driver" npx edgedriver --version
```
