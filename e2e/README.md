# E2E 测试说明

本项目有两套端到端验证，覆盖相同的验证目标（应用启动、前端渲染、Rust 命令链路）：

## 1. CI 冒烟测试（GitHub Actions）

- 脚本：`e2e/smoke-ci.mjs`
- 原理：通过 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=0` 让
  WebView2 开启调试端口并写 `DevToolsActivePort` 文件，脚本通过 CDP 协议连接页面，
  执行 JS 断言。
- 触发：Build Verification workflow 的 e2e job（PR 与 main 推送）

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

## 为什么 CI 用冒烟而不是完整 WebDriver

GitHub Actions 的 windows-latest 镜像自带 WebView2 Runtime 150.x，该版本与
msedgedriver 的自动化握手存在环境兼容问题（会话创建报
`DevToolsActivePort file doesn't exist`）。已排查并排除：驱动版本匹配、
user data 目录指定、进程残留、调试参数注入失效等（详见 git 历史）。
CDP 冒烟测试绕开 WebDriver 握手，验证能力等价（启动/渲染/命令链路），
且本地完整 WebDriver E2E 不受影响。待微软修复 WebView2 150 或 runner
镜像升级后，可将 CI 恢复为完整 WebDriver 方案。
