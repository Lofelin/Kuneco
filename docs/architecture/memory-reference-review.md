# TencentDB Agent Memory 架构参考评估

核对日期：2026-10-21。查看仓库默认分支 `feat/server_team` 的中文 README、`l1-candidate-recall.ts`、`auto-recall.ts`、`l1-dedup.ts` 与 `storage/adapter.ts`。本次为源码评估，没有部署该项目，也未复现它的效果评测。

结论：值得参考核心机制，当前不需要整体引入团队记忆平台或替换 Kuneco 运行时调用链。

| 机制 | 源码/设计依据 | Kuneco 的适用方向 |
| --- | --- | --- |
| 分层记忆 | L0 原始对话、L1 原子事实、L2 场景、L3 画像 | 当前原子记忆之外，可增加项目/场景摘要，保留原文来源，不重复大规模注入历史 |
| 混合召回 | 关键词检索与向量检索并行，RRF 融合；支持存储原生检索能力 | 已增强同义表达召回，保留纯本机关键词路径，外部嵌入服务应独立明确配置 |
| 两阶段去重 | 先召回相关候选，再一次模型调用判断整批候选 | 降低重复提取成本，同时保留用户手动保护、修订号和冲突审核 |
| 存储接口解耦 | StorageAdapter、按租户范围限定存储视图 | 本机设备与云端同步共用业务规则，默认本机不访问记忆后端 |
| 结构化召回反馈 | 区分没有结果、超时、部分失败，并设置预算 | 已记录召回命中、耗时和降级原因，避免失败看起来像“没有记忆” |

需要有选择地使用：该项目还包含团队资产授权、Skill、Wiki、CodeGraph 和代理接入层，当前 Kuneco 主要需要个人记忆与跨运行时共享。去重源码也有在缺少检索能力时直接存储的降级路径，不能因采用同类架构就宣称去重必然成功。其基准成绩属于项目方报告，不等同于 Kuneco 已验证效果。

优先级建议：先稳定本机/云端的隐私边界与同步，再评估“关键词 + 向量混合召回”，最后考虑场景摘要和长期画像。已采用本机分层、BM25 + 本机语义向量 RRF 以及一次批量去重判断；未引入腾讯云服务或自动推断画像。

来源：

- [中文设计说明](https://github.com/TencentCloud/TencentDB-Agent-Memory/blob/feat/server_team/README_CN.md)
- [混合候选召回实现](https://github.com/TencentCloud/TencentDB-Agent-Memory/blob/feat/server_team/MemoryCore/src/core/tools/l1-candidate-recall.ts)
- [批量去重实现](https://github.com/TencentCloud/TencentDB-Agent-Memory/blob/feat/server_team/MemoryCore/src/core/record/l1-dedup.ts)
- [自动召回及结构化失败](https://github.com/TencentCloud/TencentDB-Agent-Memory/blob/feat/server_team/MemoryCore/src/core/hooks/auto-recall.ts)
- [存储适配与作用域隔离](https://github.com/TencentCloud/TencentDB-Agent-Memory/blob/feat/server_team/MemoryCore/src/core/storage/adapter.ts)

本机语义模型按需准备，不自动下载；没有模型时明确降级到关键词。实现边界和分层规则见 [统一记忆服务](memory-service.md)。
