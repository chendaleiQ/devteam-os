# 第一阶段工程完成型收口 Plan

## 1. 目标

按已批准的 spec：`docs/dtt/specs/2026-04-17-phase-1-engineering-complete-spec.md`，把当前“自控版最小闭环”升级为第一阶段工程完成型收口版本。

完成后系统应具备：

- Leader 单入口。
- LangGraphJS 承接 workflow/orchestration 主流程。
- PM / Architect / Developer / QA 独立角色边界。
- meeting / repo / runner / artifacts / storage 的第一阶段最小工程能力。
- CLI 全链路兼容。
- typecheck、test、必要时 build 可验证。

## 2. 边界与限制

本计划只完成第一阶段，不进入第二阶段。

不做：

- Web 工作台。
- 多用户系统。
- 云端执行环境。
- 复杂并行调度。
- 自动生产发布。
- 未授权 Git commit / branch / destructive git 操作。
- deepagent / AutoGen / CrewAI 等完整 Agent 框架替换。

风险边界：

- LangGraphJS 只进入 workflow/orchestration 层。
- CLI、storage、runner、artifacts 保持职责稳定。
- 优先保留现有测试语义，再逐步扩展。

## 3. 当前状态摘要

当前源码：

- `src/domain.ts`：领域类型。
- `src/workflow.ts`：手写状态机。
- `src/leader.ts`：Leader 主控、占位角色、会议产物、暂停恢复、验证。
- `src/runner.ts`：安全 package script 执行。
- `src/storage.ts`：内存/文件任务存储。
- `src/artifacts.ts`：artifact 与 delivery report。
- `src/cli.ts`：CLI 命令入口。

当前测试：

- `tests/workflow.test.ts`
- `tests/leader.test.ts`
- `tests/runner.test.ts`
- `tests/storage.test.ts`
- `tests/cli.test.ts`

主要缺口：

- workflow 尚未由 LangGraphJS 承接。
- 角色逻辑仍在 `leader.ts` 内部。
- meeting / repo 模块尚未独立。
- runner 还缺少测试命令解析策略对象。
- delivery / checkpoint / waiting summary 仍偏最小实现。

## 4. 实施批次

### Batch 1：依赖与领域对象边界

目标：为工程化收口打底，不改变外部行为。

预计改动：

- `package.json`
  - 增加 LangGraphJS 依赖，优先使用 `@langchain/langgraph`。
- `package-lock.json`
  - 随依赖安装更新。
- `src/domain.ts`
  - 补充第一阶段所需结构，例如：
    - execution rule / decision reason 字段。
    - waiting summary 或 checkpoint 相关类型。
    - meeting result 类型。
    - test command resolution 结果类型。
- `src/workflow.ts`
  - 保留状态定义和合法流转工具，作为 LangGraphJS graph 的规则来源或兼容层。

验证：

- `npm run typecheck`
- `npm test -- workflow`

通过标准：

- 原有状态流转测试不退化。
- 新类型不破坏现有 public imports。

### Batch 2：角色适配层拆分

目标：Leader 不再硬编码全部角色输出细节。

新增文件建议：

- `src/agents/types.ts`
- `src/agents/pm.ts`
- `src/agents/architect.ts`
- `src/agents/developer.ts`
- `src/agents/qa.ts`
- `src/agents/index.ts`

修改文件：

- `src/leader.ts`
  - 将 `runPlaceholderAgent` 迁移为角色适配器调用。
  - 保持当前 deterministic placeholder 行为，以降低第一阶段风险。
- `tests/leader.test.ts`
  - 验证 agentRuns 与 artifacts 仍正确产生。

验证：

- `npm run typecheck`
- `npm test -- leader`

通过标准：

- PM / Architect / Developer / QA 均通过独立模块被调用。
- 现有 leader 分支测试继续通过。

### Batch 3：meeting 模块独立

目标：会议成为结构化汇总节点。

新增文件建议：

- `src/meeting.ts`

修改文件：

- `src/domain.ts`
  - 如 Batch 1 未完成，补充 meeting result 类型。
- `src/leader.ts`
  - 将 `createMeetingArtifact` 迁移为 meeting 模块调用。
- `tests/leader.test.ts` 或新增 `tests/meeting.test.ts`
  - 覆盖会议输出字段：topic、role summaries、decisions、risks、nextStep、needsOwnerDecision。

验证：

- `npm run typecheck`
- `npm test -- meeting`
- `npm test -- leader`

通过标准：

- 复杂任务进入 meeting。
- meeting_notes artifact 内容结构稳定。
- 会议可要求老板拍板并暂停。

### Batch 4：repo 与 runner 第一阶段能力补齐

目标：补齐仓库读写观察和测试命令来源规则。

新增文件建议：

- `src/repo.ts`

修改文件：

- `src/runner.ts`
  - 增加测试命令解析能力：用户指定 > 仓库配置 > package scripts 自动识别 > blocked。
  - 保持 allowlist 和无 shell 执行策略。
- `src/leader.ts`
  - 验证阶段使用结构化 test command resolution。
- `tests/runner.test.ts`
  - 增加命令来源优先级测试。
- 新增 `tests/repo.test.ts`
  - 覆盖安全文件读取、变更摘要或 diff summary 的最小能力。

验证：

- `npm run typecheck`
- `npm test -- runner`
- `npm test -- repo`

通过标准：

- 未知/危险命令 blocked。
- 当前仓库可识别 `typecheck`、`test`、`build`。
- repo 模块不执行破坏性 Git 操作。

### Batch 5：LangGraphJS workflow/orchestration 接入

目标：让 LangGraphJS 实际承接主流程。

新增文件建议：

- `src/workflow/graph.ts`
  - 定义 graph state 与 Task 映射。
  - 定义 intake / planning / meeting / developing / testing / reporting / waiting / blocked / done 节点。
  - 定义条件边和回流。
- `src/workflow/index.ts`
  - 统一导出 graph workflow 与兼容工具。

可能需要保留/调整：

- `src/workflow.ts`
  - 可保留为状态规则兼容层；如迁移为目录，需要处理 import 路径兼容。

修改文件：

- `src/leader.ts`
  - 将 `continueLeaderTask` 的主推进委托给 graph workflow。
  - 保留 Leader 对外 API：
    - `runLeaderTask`
    - `resumeLeaderTask`
    - `approveLeaderTask`
    - `resolveBlockedTask`
- `tests/workflow.test.ts`
  - 增加 graph 流转测试。
- `tests/leader.test.ts`
  - 验证标准、澄清、审批、blocked、测试失败回流等路径。

验证：

- `npm run typecheck`
- `npm test -- workflow`
- `npm test -- leader`

通过标准：

- LangGraphJS 是主流程执行入口，而不是仅安装依赖。
- 标准任务可到 done。
- 澄清、审批、blocked 均可暂停并恢复。
- 测试失败可回流 developing，不能误报 done。

### Batch 6：artifacts / storage / checkpoint / waiting summary 收口

目标：确保长流程暂停恢复与交付报告像第一阶段产品能力。

修改文件：

- `src/artifacts.ts`
  - delivery report 包含关键 artifact、验证结果、等待/阻塞说明。
- `src/storage.ts`
  - 如 Task 新增 checkpoint 字段，确保内存与文件存储都能保存/恢复。
- `src/leader.ts`
  - 在 `clarifying` / `awaiting_owner_decision` / `blocked` 生成清晰 waiting summary。
- `tests/storage.test.ts`
  - 覆盖 checkpoint 持久化。
- `tests/leader.test.ts`
  - 覆盖等待摘要和最终交付报告。

验证：

- `npm run typecheck`
- `npm test -- storage`
- `npm test -- leader`

通过标准：

- 暂停任务可持久化并恢复。
- delivery report 能说明完成步骤、待处理项、验证情况。

### Batch 7：CLI 全链路兼容与最终验证

目标：确保用户仍通过 CLI 驱动完整闭环。

修改文件：

- `src/cli.ts`
  - 保持命令兼容。
  - 必要时增加输出字段，例如 waiting summary 或 validation summary。
- `tests/cli.test.ts`
  - 覆盖：
    - start 标准任务。
    - start 后 resume。
    - start 后 approve。
    - resolve-block。
    - verify scripts。

最终验证命令：

- `npm run typecheck`
- `npm test`
- `npm run build`

通过标准：

- 所有测试通过。
- CLI 旧用法继续可用。
- 第一阶段工程完成型验收标准全部可对应到测试或手动验证说明。

## 5. 推荐执行策略

执行时按 Batch 顺序推进，每个 Batch 完成后先运行对应局部验证。

如果某个 Batch 失败：

1. 不继续扩大范围。
2. 先定位失败原因。
3. 修复后重新运行该 Batch 的验证。
4. 只有局部验证通过后再进入下一批。

如果 LangGraphJS 依赖安装或 API 适配出现阻塞：

- 保留已完成的角色/meeting/repo/runner 拆分。
- 明确报告阻塞原因。
- 不用假实现冒充 LangGraphJS 主流程。

## 6. 评审点

实现完成后 reviewer 重点检查：

- 是否符合已批准 spec。
- LangGraphJS 是否实际承接 workflow 主流程。
- Leader 是否仍是唯一对外入口。
- 角色和 meeting 是否真正独立出边界。
- 测试失败/审批/阻塞是否不会误报完成。
- 是否存在越界的 Git、发布、 destructive action。

## 7. 完成判定

只有满足以下条件，才可声明第一阶段工程完成型收口：

- 所有计划内 Batch 完成。
- `npm run typecheck` 通过。
- `npm test` 通过。
- `npm run build` 通过或有明确无需 build 的理由。
- reviewer 未发现未解决的高风险问题。
- Leader 最终批准关闭。
