# 组件手工预览与真实桌面验收

## 自动验收

统一运行 `npm run test:desktop`。`test:dialogs`、`test:ui-preview`、`test:chat-ui`、`test:turn-card` 保留为同一真实桌面测试的别名，不再启动独立 Electron 页面。

测试通过正式 `src/app/start.mjs` 启动链路准备并运行 Kuneco.app，加载真实 `src/index.html`、renderer、preload 与 IPC。每次使用临时数据目录、随机调试端口、本地账号/代理/CLI 夹具，不访问日常账号或调用真实模型。场景放在 `test/e2e/scenarios/`，不能自行创建 BrowserWindow、替换主页面或创建模拟 workspace API。

`components.mjs` 检查实际设置与菜单控件、弹窗背景遮罩、边框和关闭操作；`chat-interaction.mjs` 检查真实聊天栏、附件预览、图片/PDF缩放与拖拽；`turn-change-card.mjs` 在临时项目中通过真实发送入口接收本地CLI回执，验证文件统计、展开、逐文件审查、撤销和刷新后的状态恢复。截图与报告位于忽略提交的 `artifacts/`。

只有运行时提供完整前后快照、文件存在性和项目目录的回合才能撤销，旧记录或只有补丁的回合会显示禁用原因。原文件以同目录 `.kuneco-undo-*.backup` 保留；异常补偿失败时需人工检查，多文件恢复不构成跨进程原子事务。

## 手工组件预览

运行 `npm run preview:ui` 打开带 Kuneco 名称和图标的独立组件目录，只供开发者手工查看。它没有业务 preload 和账号数据，也不作为自动测试或真实业务验收依据。`--verify` 已停用，请使用上面的统一桌面测试。

源码位于 `src/shared/ui/preview/`，继续复用全局 app-button、app-dialog、app-table 与样式 tokens。不要将示例加入生产设置或导航。

## 性能基准

`npm run benchmark:chat-diff` 是 JSDOM 基准，仅测量同机同输入的 Diff/代码追加成本，不代表真实桌面帧率或业务验收结果。
