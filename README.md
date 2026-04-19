# DevTeamOS

AI 研发团队操作系统。

DevTeamOS 的目标不是做一个单点 coding agent，而是做一个像真实研发团队一样工作的 AI 团队：老板只和 `Leader` 沟通，团队在后台 7x24 持续推进任务，只有在澄清、审批或高风险节点时才回到老板做决定。

## 当前文档

- 项目总览：`docs/project-overview.md`
- 全项目阶段性目标与路线图（主文档）：`docs/development-roadmap.md`
- 第二阶段真实模型接入阶段报告：`docs/dtt/reports/2026-04-18-phase-2-llm-integration-summary.md`
- 第二阶段 MiniMax provider 扩展阶段报告：`docs/dtt/reports/2026-04-18-phase-2-minimax-provider-extension-summary.md`
- 第一阶段重新收口 / 第二阶段 Batch 1 启动说明：`docs/dtt/reports/2026-04-18-phase-1-closure-and-phase-2-batch-1-summary.md`
- 第一阶段工程收口方案：`docs/dtt/plans/2026-04-17-phase-1-engineering-complete-plan.md`
- 技术架构：`docs/technical-architecture.md`

## 当前重点

第一阶段“Leader 驱动的本地交付原型”已于 2026-04-18 重新收口，并重新通过 `npm run typecheck`、`npm test`、`npm run build`。

当前仍处于**第二阶段：团队协作能力增强**，并且已经进入**第二阶段收尾**：在 Batch 1“协作基础稳定化”和受控真实模型接入 / provider 扩展之后，新增了**持续交互 CLI**，可在一个会话里持续处理澄清、审批与阻塞恢复，但这**不等于**已经进入第三阶段工作台。

- 默认无 `llm` 配置时仍保持现有兼容行为；PM / Architect / QA 默认走受控 mock provider 输出链路。
- 当前真实 provider 支持范围已从 OpenAI 扩展到 **OpenAI + MiniMax**；PM / Architect / QA 复用同一套结构化角色输出链路，Developer 的受控边界也保持不变。
- MiniMax 已对齐官方 Quickstart 口径：`DEVTEAM_LLM_PROVIDER=minimax`、`DEVTEAM_LLM_MODEL=MiniMax-M2.7`、`ANTHROPIC_BASE_URL=https://api.minimaxi.com/anthropic`、`ANTHROPIC_API_KEY=<key>`。
- Developer 仍保持更窄边界：默认无 `llm` 配置时继续走本地确定性 `code_summary` 兼容路径；但显式 `provider: 'mock'`、`provider: 'openai'` 或 `provider: 'minimax'` 时都会生成结构化 `patch proposal`，并在系统校验通过后进入受控写入。
- 新增持续交互 CLI：同一会话内可继续承接老板澄清、等待审批后的恢复推进，以及阻塞后的 resume，不需要把这些动作误解为第三阶段图形化工作台。
- 仍未开放 `delete` / `rename` / 直接自由写文件 / 直接执行命令等高风险能力。

当前口径仍然是：第二阶段已进入收尾，持续交互 CLI 属于第二阶段协作能力补齐；第三阶段“产品化工作台”定位不变，尚未开始，也不是图形化产品已落地。

## `.env` 配置

项目现在支持从 `.env` 读取 LLM 相关配置；也可以直接使用 shell 环境变量。

- shell env 优先于 `.env`
- 可参考 `.env.example` 复制为本地 `.env`
- 这里只是本地配置读取，不是多环境配置系统
- CLI 入口会从当前 `cwd` 加载 `.env`
- Leader / API 只有在显式传入 `workspaceRoot` 时才会加载该目录下的 `.env`
- 如果程序化调用没有传 `workspaceRoot`，则不会额外猜测目录，仍依赖调用方预先设置好环境变量

OpenAI：

```env
DEVTEAM_LLM_PROVIDER=openai
DEVTEAM_LLM_MODEL=gpt-4o-mini
OPENAI_API_KEY=...
```

MiniMax（按官方 Quickstart 口径）：

```env
DEVTEAM_LLM_PROVIDER=minimax
DEVTEAM_LLM_MODEL=MiniMax-M2.7
ANTHROPIC_BASE_URL=https://api.minimaxi.com/anthropic
ANTHROPIC_API_KEY=...
```
