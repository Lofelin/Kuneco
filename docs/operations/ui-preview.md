# 组件手工预览

## 手工组件预览

运行 `npm run preview:ui` 打开带 Kuneco 名称和图标的独立组件目录，只供开发者手工查看。它没有业务 preload 和账号数据，也不作为自动测试或真实业务验收依据。`--verify` 已停用，请使用上面的统一桌面测试。

源码位于 `src/shared/ui/preview/`，继续复用全局 app-button、app-dialog、app-table 与样式 tokens。不要将示例加入生产设置或导航。

## 性能基准

`npm run benchmark:chat-diff` 是 JSDOM 基准，仅测量同机同输入的 Diff/代码追加成本，不代表真实桌面帧率或业务验收结果。
