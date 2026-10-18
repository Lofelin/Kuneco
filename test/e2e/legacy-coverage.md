# 旧桌面脚本迁移对照

所有场景由 `npm run test:desktop` 经 `src/app/start.mjs → Kuneco.app → src/index.html` 运行。不得新建替代窗口、替换 workspace bridge 或用注入业务事件代替实际 IPC/CLI/HTTP 链路。

| 旧脚本 | 当前真实启动场景 | 断言范围 |
| --- | --- | --- |
| action-button-layout-smoke | controls-regression A1–A5 | 实际引导/页面/弹窗按钮、宽窄与加载、6px 图文/内边距、表单关联、非法/正常/禁用提交 |
| app-dialog-smoke | dialog-regression、components | 全部已挂载弹窗的关闭、Escape、hide、重复关闭、关闭保护、遮罩/分隔线及七个业务关闭入口 |
| browser-library-ui-smoke | browser-regression BL-01–BL-10 | 常规/高级分组、刷新、下载目录、密码导入与显式显示、七类管理窗、历史、清理、权限、图标 |
| browser-settings-smoke | browser-regression BS-01–BS-06 | 网络单选、保存失败回滚、同步等待/失败/重试、31站点、键盘/菜单隔离、云端清理失败保留本地数据 |
| chat-drafts-smoke | chat-regression D01–D06 | IndexedDB 重载、账号/环境/会话隔离、发件箱原子更新、真实事务阻塞下切换会话的竞态 |
| codex-turn-smoke | chat-regression C01–C07 | 真实 HTTP 409 合并、运行中延迟应用、过程时间与活动、图片/消息重载 |
| console-settings-smoke | controls-regression C1–C8 | 独占容器的真实终端、手动/自动连接、设置、确认/取消/Escape/过期粘贴、原始 bracketed-paste 字节 |
| interaction-border-smoke | controls-regression B1–B5 | 真实输入/下拉聚焦及失焦后20帧、展开/关闭、菜单文字及 label 部件 |
| message-actions-smoke | chat-regression M01–M11 | 悬停/键盘/时间、原始流式内容复制、取消编辑、回退重发、草稿与图片保留、图标 |
| message-images-smoke | chat-regression I01–I05、chat-interaction | 真实附件/传输、布局、九图历史、重载、预览/缩放/翻页 |
| preferences-smoke | controls-regression Q1–Q4 | 真实对话和自动化运行期间关闭、取消、Escape、已有弹窗保护、最终确认真实退出 |
| reasoning-state-smoke | chat-regression R01–R08 | 真实等待计时、手动折叠不被流式更新改变、停止/失败/完成、重载、键盘与窄栏 |
| session-model-picker-smoke | controls-regression M1–M4 | 真模型来源、打开期间异步刷新、面板宽度、关闭方式、选择持久化 |
| transparent-actions-smoke | controls-regression T1–T2 | 实际静态/动态透明控件及宿主/base 的默认、悬停、按下、移出与键盘焦点 |

浏览器目录选择另外覆盖真实容器设置页的 `filePicker`，以及主进程直接 IPC 的路径弹窗；均验证起始目录、取消、重开及保存。

旧脚本的人造 DOM 状态不作为生产协议：真实 Codex 无活动时也处于 process 阶段，计时按实际状态验证；真实发送的一轮历史为用户和助手两条，且运行中保留 pending assistant。测试保留旧断言的交互与数据保护目标，不复制人为多插入的消息。模型列表缓存照常使用，打开期间的异步刷新由正式 `runtimeInfo({refreshEngine:'codex'})` 驱动，不能凭空要求每次打开都访问模型提供方。

业务页面和 IPC 不替换。可控响应仅设在本地 CLI stdio、账号 HTTP、原生文件选择器及窗口关闭/应用退出请求边界；控制台使用带本轮标签的独占 Docker 容器和真正的终端 stdin/stdout，结束清理，不连接日常容器。测试结果位于 `artifacts/*-regression/`，全部通过后写 `artifacts/legacy-migration.json`。
