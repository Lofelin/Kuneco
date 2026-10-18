# 桌面验收

从仓库根目录运行 `npm run validate`（构建、单元/契约、桌面、Claude/Codex 协议握手），弹窗、聊天交互、文件变更卡片及全部旧桌面脚本的迁移场景均包含在统一桌面验收中。

`desktop-smoke.mjs` 仅管理本地 HTTP/代理/账号/CLI 夹具和 正式启动器与 Kuneco 生命周期，场景放入 `scenarios/`：

- `workspace.mjs`：组件装载、运行时注册与会话创建、空白标签、全部当前设置页间距、主题、通知刷新持久化、环境门禁、代理导入/连接/断开/出口锁定、账号偏好隔离。
- `browser-security.mjs`：语言、字体、iframe、worker、WebRTC/STUN 和 DNS 保护。
- `browser-navigation.mjs`：POST 弹窗、opener 回调、导航中止和重定向、多标签切换与关闭。
- `components.mjs`、`chat-interaction.mjs`、`turn-change-card.mjs`：真实全局组件、预览、附件及每轮文件回执与审查/撤销/刷新。
- `chat-regression.mjs`：草稿事务与切换竞态、消息操作、九图历史、云端冲突合并和过程状态时序。
- `browser-regression.mjs`：浏览器资料库、同步、站点清理回滚、密码、历史、权限及本机/容器目录选择。
- `controls-regression.mjs`：引导、按钮与表单、透明控件、交互边框、模型列表、真实终端及最终退出保护。
- `dialog-regression.mjs`：全部已挂载弹窗的生命周期、关闭保护、分隔线与真实遮罩。

所有自动验收必须通过 `src/app/start.mjs` 启动 Kuneco.app，加载真实 `src/index.html`；禁止直接运行 Electron 脚本创建替代主窗口。`test:dialogs`、`test:ui-preview`、`test:chat-ui`、`test:turn-card` 均为同一入口别名。

每次使用独立临时数据目录、随机端口和本地模拟 CLI，不调用真实账号或模型。控制台场景使用本轮独占的 Docker 容器（要求本机容器引擎运行且已缓存 `node:24-bookworm-slim`），结束后移除；不连接或更改日常容器。结束后关闭测试进程和连接、清理临时数据；截图写入忽略的 `artifacts/`。设置入口先打开账号菜单，再点击菜单项，避免隐藏 Web Awesome 菜单项忽略点击。

旧的 `WORKSPACE_TEST_*_ONLY` 临时分支不再支持，显式报错以避免误以为运行了对应验收。真实 Docker 与终端测试使用 `npm run test:docker`、`npm run test:console`；其他需要真实依赖的脚本位于 `test/integration/`、`test/live/`，不应将桌面夹具通过表述为真实服务验收通过。

## 已停用的独立窗口脚本

已删除根目录的旧 `*-smoke.cjs` 和独立 component/card/polish 启动器。历史实现可从 Git 查看；不得恢复直接 Electron 启动或以替代页面冒充业务验收。

14 个旧脚本的逐项迁移关系、真实协议与旧人工状态的差异见 [迁移对照](legacy-coverage.md)。场景逐项写入 `artifacts/*-regression/results.json`；只有全部场景及最终确认退出通过，才写入 `artifacts/legacy-migration.json`。业务页面、preload 与 IPC 保持真实，仅在 CLI stdio、账号 HTTP 与系统文件选择器及原生窗口关闭/应用退出请求边界提供可控输入。现有 unit/integration 覆盖继续保留。
