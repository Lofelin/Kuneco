# Kuneco 桌面品牌与 Electron 名称审查

核对日期：2026-10-21。此报告区分产品显示名称与真实技术依赖；不承诺移除或替换桌面底层引擎。

## 范围与方法

检查源码、脚本、测试、README 和文档中的大小写 Electron 名称，核对正式启动链路，并读取本机实际生成的 macOS 应用及四个辅助应用的 Info.plist。依赖目录、生成产物和域名规则数据不按普通文案批量替换；实际应用 bundle 另行检查。未读取或修改真实代理密码、账号凭据或浏览器资料。

## 已修复的产品品牌遗漏

| 位置 | 修复与当前行为 |
| --- | --- |
| `src/app/desktop-launcher.mjs:63` | 品牌缓存版本升级为 v7；正式启动重新准备包含辅助应用品牌的新 bundle。 |
| `src/app/desktop-launcher.mjs:75` | 顶层名称、显示名、可执行文件、应用标识与图标使用 Kuneco；图标来自 `src/assets/brand/kuneco.icns`。 |
| `src/app/desktop-launcher.mjs:89` | 原四个 Electron Helper 应用及其可执行文件改为 Kuneco Helper、Kuneco Helper (GPU)、Kuneco Helper (Plugin)、Kuneco Helper (Renderer)。 |
| `src/app/desktop-launcher.mjs:94` | 辅助应用的 CFBundleName、CFBundleDisplayName、CFBundleExecutable、CFBundleIdentifier 同步改名；标识使用 `io.github.lofelin.kuneco.helper` 及各角色后缀。 |
| `README.md:51`、`README.zh-CN.md:51` | 产品启动说明改为启动 Kuneco。 |
| `README.md:79`、`README.zh-CN.md:79` | 验收入口改称 Kuneco 桌面验收。 |
| `test/live/live-recovery.mjs:16`、`:39` | 真实网络验收改用正式品牌启动器提供的可执行文件，避免直接运行原运行时产生旧进程名称。此轮没有执行该脚本的真实代理故障模拟。 |

macOS 菜单及应用名称的现有装配已使用 Kuneco。本轮未发现业务页面标题、按钮或设置项直接使用 Electron 作为产品名称。

### 无参数打开应用与显式脚本兼容

直接打开开发版 Kuneco.app 不应显示上游默认欢迎页。启动器现在仅在 staged 副本中使用官方 `@electron/asar` 4.3.1 加入默认入口：没有应用路径时选择本项目根目录，随后使用原默认加载器；显式脚本、目录、`--app=`、`--require` 以及版本/ABI/REPL 等诊断参数保留原语义。Info.plist 中的归档头完整性哈希同步更新，并重新签名。上游 loader 主文件、资源及许可证不被批量删改，安装的原始运行时归档保持不变。

该路由保留直接点开应用进入 Kuneco 的产品行为，同时允许同一品牌可执行文件继续运行隔离验收脚本。没有采用固定 `Resources/app` 覆盖入口，因为固定打包入口会优先于显式应用路径。

### 辅助应用图标复核

实际新 bundle 的四个 Kuneco Helper Info.plist 均未声明 CFBundleIconFile，且其 `Contents/Resources` 没有图标资源；没有发现辅助应用引用或携带 Electron 图标的遗漏。因此未为辅助进程增加另一套图标配置，也未触碰框架内部资源。此结论来自真实 bundle 元数据及资源检查，不等同于声称已逐一目测活动监视器的图标渲染。

顶层应用明确使用 kuneco.icns，且自动测试核对图标文件与项目品牌资源逐字节一致。

## 应保留的真实技术名称

| 类别 | 例子与理由 |
| --- | --- |
| 依赖及锁文件 | `package.json:55` 的 electron 44.7.0、package-lock.json 中对应包名、下载路径和依赖关系。改名会导致依赖解析或构建错误。 |
| 模块 API | `src/app/start.mjs:3`、`src/app/preload.cjs:1` 及主进程中的 `import/require('electron')`；这是运行时模块名。 |
| 运行时环境变量 | `src/features/git/git-executor.mjs:9`、`git-operations.mjs:20`、`src/features/environments/environment-gate.mjs:23` 的 ELECTRON_RUN_AS_NODE 是引擎识别的真实开关。 |
| 密钥与平台 API 说明 | safeStorage、contextBridge、ipcRenderer 等实际 API 名称以及相关技术注释。不能以产品品牌替代后声称实现发生改变。 |
| 框架和第三方组件 | Electron Framework.framework、其二进制和链接依赖，以及第三方许可证和版权信息。改名不能仅靠文字替换，许可证不得冒用品牌。 |
| 技术栈与架构文档 | README 中明确说明桌面技术栈的 Electron 名称属于事实；代码目录、底层集成测试、引擎能力限制中的技术称呼同理。 |
| 直接底层集成测试 | `docs/operations/browser-settings.md` 中原运行时集成测试命令用于底层行为测试，文档已说明不替代真实业务页面验收。不能仅为消除关键词而把包命令改成不存在的 Kuneco 包。 |

浏览器移入环境容器与桌面外壳所用引擎是两个边界。容器浏览器迁移不意味着 Kuneco 桌面外壳已经改用其他框架；相关文档应按真实实现更新，不能把名称清理描述为引擎迁移。

## 历史说明

`docs/archive/legacy-notes.zh-CN.md:336` 已将“开发菜单可能显示 Electron”明确归为旧阶段，并补充当前正式启动器准备 Kuneco.app 和辅助进程品牌的行为。历史日志、截图及当时的架构事实保留原貌。

归档中关于宿主内嵌浏览器、旧 partition 或旧验收行为的描述用于记录当时状态，不能作为新版本容器浏览器隔离已验收的证据。当前浏览器行为及其验收范围以本轮实际实现、操作文档与实测结果为准。

## 跨平台待发行打包

`src/app/desktop-launcher.mjs:58` 在非 macOS 平台仍直接返回原运行时可执行文件。这一分支的现有测试仅保证行为保持；没有验证 Windows/Linux 的 Kuneco 可执行名、图标、应用元数据、安装包或任务管理器显示名称。

Windows/Linux 应通过各自的发行打包流程统一品牌，并在对应系统验收。本轮不宣称已完成跨平台发行品牌处理。macOS 当前是本地开发签名，严格签名验证通过也不代表已完成 Developer ID 发布签名或公证。

## 本轮验证证据

- `node --test test/unit/app/desktop-launcher.test.mjs`：3 项通过、0 项失败；覆盖四个辅助应用名称、标识、可执行权限、旧辅助应用路径消失、顶层品牌与图标、缓存复用、上游 Info.plist 未修改，以及 `codesign --verify --deep --strict`。
- 实际参数路由验收：空参数加载临时默认应用成功；仅带 `--test-fixture` 时仍选默认应用；显式 `.cjs` 入口真实运行成功，没有误进默认应用。
- 实际项目从系统临时 cwd 启动新可执行文件，仅传 `--test-fixture` 和调试端口、没有应用路径，并使用独立临时资料目录；CDP 确认加载 `file:///Users/lifulin/Kuneco/src/index.html`，没有显示默认欢迎页。诊断进程已退出，未终止用户真实进程。
- 实际项目缓存 bundle：`node_modules/.cache/kuneco-desktop/86656f87b7101736/Kuneco.app`。正式启动器已成功生成，并完成严格深度签名验证。
- 使用该实际可执行文件，在临时独立资料目录启动沙箱窗口并加载本地 data 页面成功；进程列表确认主进程 Kuneco、辅助进程 Kuneco Helper 及 Kuneco Helper (Renderer)。测试窗口和进程已退出，临时目录已清理；没有以此替代真实账号的完整桌面或容器浏览器验收。
- `node --check src/app/desktop-launcher.mjs`、`node --check test/live/live-recovery.mjs` 及 `git diff --check` 通过。
- 初次签名尝试因磁盘空间不足失败；改用系统 ditto 的 APFS 克隆复制后，完整聚焦测试与实际 bundle 签名均通过。没有通过跳过签名检查来绕过失败。
