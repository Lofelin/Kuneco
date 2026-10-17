# 桌面验收

从仓库根目录运行 `npm run validate`（构建、单元/契约、桌面、Claude/Codex 协议握手），并运行 `npm run test:dialogs` 检查真实弹窗边界。

`desktop-smoke.mjs` 仅管理本地 HTTP/代理/账号/CLI 夹具和 Electron 生命周期，场景放入 `scenarios/`：

- `workspace.mjs`：组件装载、运行时注册与会话创建、空白标签、七个设置页间距、主题、通知刷新持久化、环境门禁、代理导入/连接/断开/出口锁定、账号偏好隔离。
- `browser-security.mjs`：语言、字体、iframe、worker、WebRTC/STUN 和 DNS 保护。
- `browser-navigation.mjs`：POST 弹窗、opener 回调、导航中止和重定向、多标签切换与关闭。

每次使用独立临时数据目录、随机端口和本地模拟 CLI，不调用真实账号或模型，不更改用户 Docker 环境。结束后关闭测试进程和连接、清理临时数据；截图写入忽略的 `artifacts/`。设置入口先打开账号菜单，再点击菜单项，避免隐藏 Web Awesome 菜单项忽略点击。

旧的 `WORKSPACE_TEST_*_ONLY` 临时分支不再支持，显式报错以避免误以为运行了对应验收。真实 Docker 与终端测试使用 `npm run test:docker`、`npm run test:console`；其他需要真实依赖的脚本位于 `test/integration/`、`test/live/`，不应将桌面夹具通过表述为真实服务验收通过。
