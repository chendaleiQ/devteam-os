# DevTeamOS

AI 研发任务治理层。

DevTeamOS 当前不再继续沿着“自研完整 coding agent 平台”方向扩张，而是收缩为一个以 `Leader` 为入口的治理层：

- 老板只和 `Leader` 沟通
- `Leader` 负责任务接入、状态推进、审批触发、风险升级与阶段汇报
- 真实开发执行由外部执行器承担，例如 Devin、Open SWE、GitHub Copilot cloud agent、OpenHands
- 系统保留澄清、审批、阻塞、回流、artifact、checkpoint、delivery report 等治理能力

一句话定义：

> DevTeamOS 是一个围绕 `Leader` 构建的 AI 研发任务治理层，而不是一个继续自研到底层执行栈的 coding agent 平台。

## 当前文档

- 治理层收缩重构清单：`docs/governance-layer-refactor-checklist.md`
- 项目总览：`docs/project-overview.md`
- 全项目阶段性目标与路线图（主文档）：`docs/development-roadmap.md`
- 第二阶段总收口报告：`docs/dtt/reports/2026-04-19-phase-2-closeout-summary.md`
- 第二阶段真实模型接入阶段报告：`docs/dtt/reports/2026-04-18-phase-2-llm-integration-summary.md`
- 第二阶段 MiniMax provider 扩展阶段报告：`docs/dtt/reports/2026-04-18-phase-2-minimax-provider-extension-summary.md`
- 第一阶段重新收口 / 第二阶段 Batch 1 启动说明：`docs/dtt/reports/2026-04-18-phase-1-closure-and-phase-2-batch-1-summary.md`
- 第一阶段工程收口方案：`docs/dtt/plans/2026-04-17-phase-1-engineering-complete-plan.md`
- 技术架构：`docs/technical-architecture.md`

## 当前重点

截至 2026-04-19，仓库已完成一轮“Leader 驱动的本地交付原型”与“团队协作能力增强”的原型验证，证明以下能力是成立的：

- `Leader -> workflow -> artifact -> approval` 这条治理链条可以成立
- `clarifying / awaiting_owner_decision / blocked / reporting` 等暂停恢复语义成立
- 结构化 artifact、checkpoint、delivery report 具备沉淀价值

但当前仓库也暴露出一个明确结论：

> 不适合继续把 DevTeamOS 作为完整自研 agent 平台推进。

因此，当前正确的下一步不是继续扩张自研执行栈，而是进行**战略收缩**：

- 保留治理层：Leader、workflow、risk、artifact、storage、CLI operator console
- 冻结并逐步淘汰自研执行栈：内部角色 agent、LLM provider、patch proposal、repo/runner runtime
- 引入外部执行器 adapter，承接真实开发执行

当前工作重点：

- 对齐文档口径，正式把项目定义为治理层
- 抽象外部执行器接口
- 将 `leader-graph` 从“内部执行器 + workspace 写入”重构为“治理节点 + 外部执行器编排”
- 清理不再匹配方向的测试与模块

## 边界

当前不再作为主线继续投入的方向：

- 自研 LLM provider
- 自研 PM / Architect / Developer / QA 执行器
- 自研 patch proposal 协议
- 自研 repo 读写与命令执行 runtime

当前应继续保护的方向：

- `Leader` 统一入口
- workflow / risk / approval 规则
- checkpoint / artifact / delivery report
- 暂停恢复与老板决策链路
- 对外部执行器的编排能力
