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

- 项目总览：`docs/project-overview.md`
- 全项目路线图：`docs/development-roadmap.md`

## 当前重点

截至 2026-04-19，仓库已经稳定在治理层主线，核心能力包括：

- `Leader -> workflow -> artifact -> approval` 这条治理链条可以成立
- `clarifying / awaiting_owner_decision / blocked / reporting` 等暂停恢复语义成立
- 结构化 artifact、checkpoint、delivery report 具备沉淀价值
- 真实开发执行已改由外部执行器承担，当前默认接入 `OpenHands`

当前工作重点：

- 稳定 `OpenHands` 执行链路
- 补齐 operator console 视图
- 继续接入更多外部执行器

## 运行方式

默认执行器为 `OpenHands`。运行前请准备：

- `openhands` CLI 可执行文件
- `MINIMAX_API_KEY`
- 可选 `MINIMAX_MODEL`，默认 `MiniMax-M2.7`
- 可选 `MINIMAX_BASE_URL`，默认 `https://api.minimaxi.com/v1`

DevTeamOS 会在运行时把 `MINIMAX_*` 自动映射成 OpenHands headless mode 需要的 `LLM_*` 配置。

项目准则：不再提供 `mock-executor`、fake executor 或伪造执行结果的首跑路径。所谓“可用”，必须建立在真实 `OpenHands` 执行链路上，而不是用 mock 兜底。

最小启动方式：

```bash
npm run dev -- start "请实现一个本地 JSON 落盘与恢复的 TypeScript 原型"
```

如需显式指定命令路径：

```bash
DEVTEAM_OPENHANDS_COMMAND=/path/to/openhands npm run dev -- interactive "请实现一个本地 JSON 落盘与恢复的 TypeScript 原型"
```

推荐先复制 `.env.example` 到 `.env`，然后只填入真实的 `MINIMAX_API_KEY`。占位值会在本地前置校验里被拦住，不会拿着假 key 去远端执行。

## 边界

当前不再作为主线继续投入的方向：

- 自研模型 provider
- 自研 PM / Architect / Developer / QA 执行器
- 自研 patch proposal 协议
- 自研 repo 读写与命令执行 runtime

当前应继续保护的方向：

- `Leader` 统一入口
- workflow / risk / approval 规则
- checkpoint / artifact / delivery report
- 暂停恢复与老板决策链路
- 对外部执行器的编排能力
