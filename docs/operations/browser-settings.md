# 浏览器设置

- 网络模式保留直接连接、使用应用代理、自动选择。`mixed` 保留原自动选择模式及传输路径，不转换为代理模式；自动选择在首次连接时优先代理，代理未就绪或隧道建立失败时尝试直连；成功后按域名固定线路，已选代理的域名后续失败不会切直连。切换模式时清除线路缓存。强制代理模式不可用时停止访问，绝不回退直连。回退只发生在转发业务请求之前，不重放已发送请求。直接连接状态不代表已检测公网连通性。
- Cookie 保存与同步按账号、环境隔离。同步状态包含等待、同步中、成功、失败和本次启动最近成功时间；失败可手动重试。切回本设备不会删除已有云端副本，重新启用同步可能恢复它。
- 站点列表合并当前 Cookie 域名与本版本记录的页面/子页面 origin；索引仅保存 origin，不保存路径、查询参数或 Cookie 值。历史未记录且无 Cookie 的站点不一定列出，但全环境清理仍覆盖它们。
- 缓存容量是当前浏览器 partition 的 HTTP 缓存总量，不代表单站容量。单站操作清理该域名 Cookie 及已记录 origin 的站点存储和缓存；共享域 Cookie 会影响使用它的子站点。
- 清理会关闭当前环境浏览器标签页。仅清缓存不清 Cookie；全部清理还移除当前环境的 HTTP 认证缓存。其他账号和环境不受影响。
- 云端模式下先提交云端 Cookie 清理，再清本地；云端请求失败时保留本地数据。若服务器已处理但响应中断，界面显示未完成，应刷新核对再重试。清理提交时不调用可能先修改本地数据的常规同步应用流程。
- Cookie 删除通过原 domain/path/name 精确写入过期时间；禁止以 `cookies.remove(url,name)` 代替，因为 Chromium 会误删同名父域 Cookie。

验证入口：

```sh
npm run check
node --test test/unit/browser/*.test.mjs test/integration/test-browser-cookies.mjs test/unit/shared/app-button-contract.test.mjs test/unit/shared/app-table*.test.mjs test/unit/shared/app-dialog.test.mjs
node_modules/.bin/electron test/integration/test-browser-routing.cjs
node_modules/.bin/electron test/integration/test-browser-site-data.cjs
node_modules/.bin/electron test/e2e/browser-settings-smoke.cjs
```

真实删除仅在临时 userData、内存 partition 和本地 HTTP 测试服务中验证。用户环境页面验收不执行数据清理，也不为验收切换真实 Cookie 云端保存模式。

## 浏览器工具与资料库

页面工具提供查找、收藏、按站点缩放、重新打开关闭标签和批注草稿。会话恢复在启用后、下次打开浏览器时恢复当前账号与环境的标签。历史和下载记录仅在本机按账号与环境隔离；收藏随账号同步，网站权限与智能体规则随环境同步；密码通过系统安全存储加密，填充需要明确操作与确认，不自动提交表单。联系信息入口已移除，已有加密数据保留。收藏、浏览历史和下载历史统一从浏览器菜单访问，密码导入位于密码管理器内；地址栏固定显示完整网址。扩展和站点工具收纳在默认折叠的“高级”分组。

下载支持目录选择、保存前询问、进度、暂停/继续、取消、重试及打开文件/所在目录。容器环境默认保存到`/workspace/Download`（新旧环境均自动补齐目录，自定义下载路径保持不变，可点击“恢复默认”重置）；更改目录和保存前询问均使用容器内绝对路径，本机环境仍使用系统下载目录。文件先在本机暂存，流式写入原容器成功后才标记完成，失败显示错误，不覆盖同名文件。容器文件的“打开/所在目录”会按需导出本机临时副本，原文件仍保留在容器。清除下载记录不会删除下载文件。导入支持 Cookie JSON/Netscape 文件和密码 CSV，数据只进入当前环境。

扩展仅支持解压后的扩展目录，安装前展示权限；兼容性受 Electron 扩展 API 支持范围限制，不支持直接安装 CRX 或保证全部 Chrome 扩展可用。网站工具需网页及 Chromium 提供 WebMCP 接口，无接口时明确返回不支持。

智能体浏览器默认开启，历史访问默认允许，新建环境同样使用此默认值。旧环境的关闭/询问旧默认值一次升级，升级后手动修改保持有效；禁止访问选项保留。启用后，Claude、Codex、DeepSeek 可调用受控浏览器工具；浏览、下载、历史读取分别执行授权，网站规则覆盖默认规则。Codex 的动态工具由新建会话注册，已存在的旧 Codex 会话需新建对话才能使用。批注时可勾选是否附带截图，成功生成批注后按账号同步上次选择；截图加入支持图片的对话草稿，由用户发送。

新增验证：

```sh
node --test test/unit/browser/*.test.mjs test/unit/runtimes/codex-browser-tools.test.mjs test/unit/runtimes/deepseek-browser-bridge.test.mjs
node_modules/.bin/electron test/integration/test-browser-features.cjs
node_modules/.bin/electron test/e2e/browser-library-ui-smoke.cjs
```

## 保存与同步范围

- 跟随账号：网页/本地链接打开偏好、收藏、批注截图偏好。相同账号的不同环境和设备共享。
- 跟随环境：容器环境的标签恢复开关与标签、下载目录和询问偏好、网站权限、智能体规则、站点工具、站点缩放、扩展配置。账号仍是隔离边界；本地环境的上述配置只保留在设备上，避免把本机路径和权限同步到其他设备。
- 仅本设备：网络模式、密码、浏览历史、下载记录、缓存与站点存储。密码保持系统加密存储。
- Cookie 保留本设备/云端选择。云端 Cookie 按账号与环境隔离；本次迁移不改变用户的 Cookie 同步开关，也不自动上传本地 Cookie。
- 扩展仅同步 ID、名称和启用配置，不传输本机路径或扩展文件。其他设备未安装时显示“待本机安装”。

共享设置通过 `/v1/me/browser-settings` 的账号/环境独立命名空间保存，服务端加密并校验 revision。写入冲突时只重放本次变化的字段或记录 ID，最多三次；失败明确返回错误，不假报保存成功。后台每 30 秒刷新当前范围，本地缓存提供离线读取；共享设置的修改需要服务确认，本地历史和密码仍可离线保存。

首次迁移以当前环境的常规偏好作为账号初值；其他环境的旧收藏按 URL 合并一次，环境配置独立迁移。旧本地资料库备份为 `.pre-scope`，不删除原密码和历史；账号偏好不会被后打开环境的旧值覆盖。后端升级需同时重启账号服务。回归覆盖 `browser-scoped-library.test.mjs` 和 Go `TestBrowserSettingsScopes`。
