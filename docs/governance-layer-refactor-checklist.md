# DevTeamOS 治理层收缩重构清单

## 1. 目标

本次重构不再继续把 DevTeamOS 作为“自研完整 coding agent 平台”推进，而是把它收缩为：

> **一个以 Leader 为入口的 AI 研发任务治理层。**

它负责：

- 任务接入与状态推进
- 澄清、审批、阻塞、回流
- 风险分级与老板决策触发
- 结构化 artifact、checkpoint、delivery report
- 对外部执行器（Devin / Open SWE / Copilot / OpenHands 等）的统一编排

它不再继续负责：

- 自研 LLM provider 体系
- 自研角色级别 PM / Architect / Developer / QA 执行器
- 自研 patch proposal 协议
- 自研 repo 读写与测试执行 runtime

## 2. 重构原则

1. **保留治理语义，不保留自研执行栈扩张方向**
2. **优先抽象执行器接口，而不是继续增强内部 agent**
3. **文档口径先统一，再做代码删除和迁移**
4. **测试重点从“保护自研 runtime”切到“保护治理规则”**

## 3. 模块处置表

### 3.1 保留为核心资产

这些模块构成治理层最小内核，应继续维护。

| 文件 | 处置 | 原因 |
| --- | --- | --- |
| `src/domain.ts` | 保留 | 定义 `Task`、`Artifact`、`ApprovalRequest`、`Checkpoint` 等核心对象 |
| `src/workflow.ts` | 保留 | 状态迁移规则是治理层核心资产 |
| `src/risk.ts` | 保留 | 风险分级、审批触发、升级路径是产品差异点 |
| `src/artifacts.ts` | 保留 | artifact / context / delivery report 生成逻辑应继续存在 |
| `src/storage.ts` | 保留 | 任务持久化与恢复必须保留 |
| `src/leader.ts` | 保留 | 统一任务入口 API，适合作为上层 facade |
| `src/meeting.ts` | 保留并简化 | 保留“多方结论汇总”，去掉对内部固定角色链的强耦合 |
| `src/cli.ts` | 保留并收缩 | 作为 operator console，而不是完整本地 coding CLI |

### 3.2 保留，但改造为外部执行器编排层

这些模块不应删除，但职责要变。

| 文件 | 处置 | 新职责 |
| --- | --- | --- |
| `src/leader-graph.ts` | 保留并重构 | 从“内部角色执行 + workspace 写入”改成“治理节点 + 外部执行器派发/轮询/回收” |
| `src/agents/index.ts` | 重构 | 从内部角色 registry 改为外部执行器 adapter registry |
| `src/agents/types.ts` | 重构 | 改成统一 `ExternalExecutor` 协议，而不是内部角色协议 |
| `src/env.ts` | 保留并收缩 | 用于加载执行器接入配置，而不是继续扩张自研 provider 配置 |

### 3.3 立即冻结，不再新增功能

这些模块暂时保留在仓库中，但应该停止扩展。

| 文件 | 处置 | 说明 |
| --- | --- | --- |
| `src/agents/pm.ts` | 冻结 | 未来不再作为主路径增强 |
| `src/agents/architect.ts` | 冻结 | 同上 |
| `src/agents/developer.ts` | 冻结 | 同上 |
| `src/agents/qa.ts` | 冻结 | 同上 |
| `src/agents/llm-adapter.ts` | 冻结 | 仅用于过渡，不再新增 provider/协议能力 |

### 3.4 逐步淘汰或移出主路径

这些模块是“自研执行栈”的核心，应从主架构中退出。

| 文件 | 处置 | 原因 |
| --- | --- | --- |
| `src/llm/index.ts` | 淘汰 | 不再维护自研 provider factory |
| `src/llm/openai.ts` | 淘汰 | 同上 |
| `src/llm/minimax.ts` | 淘汰 | 同上 |
| `src/llm/mock.ts` | 淘汰 | 同上 |
| `src/llm/types.ts` | 淘汰 | 同上 |
| `src/patch-proposal.ts` | 淘汰 | 不再以自研 patch proposal 作为系统中心协议 |
| `src/repo.ts` | 淘汰 | 不再把本地 repo 读写能力作为主线产品能力 |
| `src/runner.ts` | 淘汰 | 不再继续维护本地命令执行 runtime |

## 4. 测试处置表

### 4.1 应继续保护的测试

- `tests/workflow.test.ts`
- `tests/risk.test.ts`
- `tests/storage.test.ts`
- `tests/meeting.test.ts`
- `tests/leader.test.ts`
- `tests/cli.test.ts`

这些测试代表治理层规则，应优先保留。

### 4.2 应重写或删除的测试

- `tests/agents-protocol.test.ts`
- `tests/llm-provider.test.ts`
- `tests/patch-proposal.test.ts`
- `tests/repo.test.ts`
- `tests/runner.test.ts`

这些测试主要保护自研执行栈，不再匹配新的产品方向。

## 5. 目标架构

重构后的最小执行链路应是：

1. `Leader` 接收老板需求
2. `workflow` 判断是否需要澄清 / 审批 / 阻塞恢复
3. `Leader` 将可执行任务派发给外部执行器
4. 外部执行器返回状态、摘要、PR、artifact、验证结果
5. `Leader` 统一沉淀结果并决定下一状态
6. 必要时回到老板做决策

建议的统一接口：

```ts
export interface ExternalExecutor {
  submitTask(input: ExecutorTaskInput): Promise<ExecutorSubmission>;
  pollRun(runId: string): Promise<ExecutorRunStatus>;
  requestChanges(runId: string, note: string): Promise<void>;
  approve(runId: string): Promise<void>;
  collectArtifacts(runId: string): Promise<ExecutorArtifacts>;
}
```

## 6. 分批执行清单

### Batch 1：文档与边界冻结

- [x] 更新 `README.md`
- [x] 更新 `docs/project-overview.md`
- [x] 更新 `docs/development-roadmap.md`
- [x] 在仓库层明确“停止扩张自研执行栈”
- [x] 新增本清单文档

### Batch 2：抽象外部执行器接口

- [ ] 将 `src/agents/types.ts` 改为外部执行器协议
- [ ] 将 `src/agents/index.ts` 改为 adapter registry
- [ ] 新增 `src/executors/` 目录
- [ ] 提供至少一个占位 adapter（例如 `noop` 或 `mock-executor`）

### Batch 3：从 graph 中剥离本地执行栈

- [ ] `planning` 节点只负责形成执行请求，不直接依赖内部 PM 产物
- [ ] `developing` 节点改为提交/轮询外部执行器
- [ ] `testing` 节点改为消费外部执行器验证结果
- [ ] 移除 `applyWorkspaceChanges()`、`parsePatchProposal()`、本地 runner 在主路径中的直接调用

### Batch 4：治理层 artifact 对齐

- [ ] 统一外部执行器返回的摘要、风险、链接、PR、验证结论
- [ ] 保留 `deliveryReport` / `checkpoint` / `waitingSummary`
- [ ] 明确哪些 artifact 是治理层内生，哪些来自外部执行器

### Batch 5：清理遗留代码与测试

- [ ] 删除或归档 `src/llm/`
- [ ] 删除或归档 `src/patch-proposal.ts`
- [ ] 删除或归档 `src/repo.ts`
- [ ] 删除或归档 `src/runner.ts`
- [ ] 重写测试，确保主线只保护治理层

## 7. 验收标准

完成本次收缩后，应满足：

1. 项目对外定义已明确为“Leader 治理层”，而不是完整自研 agent 平台。
2. 主路径不再依赖自研 LLM provider、patch proposal、repo runtime、runner runtime。
3. 至少接通一个外部执行器 adapter。
4. `clarifying / awaiting_owner_decision / blocked / reporting` 等治理语义保持完整。
5. 任务状态、artifact、checkpoint、delivery report 仍可持续工作。

## 8. 不做事项

本轮收缩不做：

- 重做完整 Web 工作台
- 新增自研沙箱或执行环境
- 扩张内部角色数
- 新增更多 provider
- 继续增强 patch proposal 协议

## 9. 结论

DevTeamOS 继续做下去的合理方式，不是“把完整 agent 平台做完”，而是：

> **保留 Leader、workflow、risk、artifact、approval 这些治理内核；把执行能力外包给现成 agent。**
