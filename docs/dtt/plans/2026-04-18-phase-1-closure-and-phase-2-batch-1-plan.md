# 第一阶段真实收口与第二阶段 Batch 1 启动 Plan

## 1. 目标

基于已批准 spec：`docs/dtt/specs/2026-04-18-phase-1-closure-and-phase-2-batch-1-spec.md`，先把第一阶段重新收口到“当前可验证完成”的状态，再立即启动第二阶段 Batch 1：协作基础稳定化。

本次 plan 完成后，应达到两层结果：

1. 第一阶段重新具备 fresh verification 支撑，`npm run typecheck`、`npm test`、`npm run build` 全部通过。
2. 第二阶段不只停留在路线图，而是已经有第一批实际代码、测试和文档交付，明确从协作基础稳定化起步。

## 2. 架构与执行摘要

当前最直接的问题不是功能缺失，而是“文档已完成”和“验证未通过”之间存在冲突。失败点集中在 planning / meeting / blocked 路由与测试预期之间的不一致。

因此本次执行遵循两个原则：

- **先恢复基线一致性**：先让第一阶段的行为、测试和文档重新一致。
- **再把修复延伸成第二阶段起点**：将路由、协议和测试的一致性固化为第二阶段 Batch 1 的第一批交付。

本次不把真实大模型接入作为首批实现重点；大模型仍属于第二阶段，但应建立在更稳定的协作协议和流程边界之上。

## 3. 批次与步骤

### Batch 0：收口前分析与边界确认

目标：确认当前 failing test 的根因，并明确第一阶段应保留的行为口径。

涉及文件：

- `src/workflow.ts`
- `src/leader-graph.ts`
- `src/meeting.ts`
- `tests/leader.test.ts`
- `tests/meeting.test.ts`
- `docs/dtt/reports/2026-04-17-phase-1-completion-summary.md`

执行内容：

- 核对 planning 阶段在 `forceMeeting + forceBlocked` 情况下的当前路由逻辑。
- 判断当前失败属于“实现回归”还是“测试预期过期”。
- 明确第一阶段的正式口径：
  - planning 是否允许直接进入 `blocked`
  - 何种场景必须先经过 `meeting`
  - meeting 进入 `blocked` 的证据条件是什么

通过标准：

- 给出单一、一致、可测试的状态路由口径。

### Batch 1：第一阶段真实收口修复

目标：修复当前 fresh verification 失败，并恢复第一阶段基线全绿。

优先涉及文件：

- `src/workflow.ts`
- `src/leader-graph.ts`
- `tests/leader.test.ts`
- 如有必要：`src/meeting.ts`、`tests/workflow.test.ts`、`tests/meeting.test.ts`

执行内容：

- 以最小改动修复 planning / meeting / blocked 路由与测试之间的不一致。
- 修正或补齐关键测试，确保行为约束清楚，而不是靠模糊字符串偶然通过。
- 如果第一阶段完成说明与最终行为口径冲突，补充或修正文档表述。

通过标准：

- `npm run typecheck` 通过。
- `npm test` 通过。
- `npm run build` 通过。
- 第一阶段相关行为能被测试和文档共同解释。

### Batch 2：第二阶段 Batch 1 —— 协作基础稳定化

目标：在已恢复的第一阶段基线上，完成第二阶段第一批“协作基础稳定化”交付。

优先涉及文件：

- `src/domain.ts`
- `src/agents/types.ts`
- `src/leader-graph.ts`
- `src/meeting.ts`
- `tests/agents-protocol.test.ts`
- `tests/leader.test.ts`
- `tests/meeting.test.ts`

必要时涉及：

- `src/agents/{pm,architect,developer,qa}.ts`
- `docs/development-roadmap.md`
- `docs/dtt/reports/` 下新增阶段记录

执行内容：

- 明确角色输出、会议结果、状态转移使用的统一决策信号。
- 让 routing / meeting / blocked / owner decision 的关系更可解释、更一致。
- 把当前这次收口修复转化为第二阶段第一批协作规则固化，而不只是单点修 bug。
- 保持 CLI 入口与第一阶段命令兼容。

通过标准：

- Leader / meeting / blocked / approval 的关键协作路径比修复前更清晰。
- 角色协议、会议结构和状态转移之间不存在明显重复或冲突表达。
- CLI 兼容不退化。

### Batch 3：阶段文档与启动记录

目标：让仓库能够清楚表达“第一阶段已真实收口，第二阶段已启动”。

优先涉及文件：

- `docs/development-roadmap.md`
- `README.md`
- 新增：`docs/dtt/reports/2026-04-18-phase-1-closure-and-phase-2-batch-1-summary.md`

执行内容：

- 更新当前阶段表述，避免继续出现“已完成”但缺少 fresh verification 的语义冲突。
- 新增阶段记录，说明：
  - 第一阶段收口修复内容
  - fresh verification 结果
  - 第二阶段 Batch 1 已启动的实际交付
  - 当前边界与下一批建议

通过标准：

- 文档能被老板直接阅读并理解当前阶段状态。
- 路线图、README、阶段报告口径一致。

## 4. 验证检查点

### 检查点 A：第一阶段收口前

- 明确 failing test 的根因
- 明确修复方案是改实现、改测试，还是两者共同调整

### 检查点 B：第一阶段真实收口

- `npm run typecheck`
- `npm test`
- `npm run build`

### 检查点 C：第二阶段 Batch 1 启动完成

- 协作基础稳定化相关测试通过
- CLI 兼容 smoke（如需要）通过
- 阶段记录已写出并与当前仓库状态一致

## 5. 风险与控制

### 风险 1：为修复一个 failing test 而引入更大范围回归

控制方式：

- 先分析行为口径，再做最小修复。
- 只在 planning / meeting / blocked 决策链条附近改动，不扩大到无关模块。

### 风险 2：第二阶段 Batch 1 范围膨胀

控制方式：

- 本批次只做“协作基础稳定化”，不扩展到工作台、平台集成或真实大模型接入。
- 优先解决统一决策信号、测试一致性和阶段记录。

### 风险 3：文档再次与代码状态脱节

控制方式：

- 只有在 fresh verification 通过后，才把第一阶段写成真正收口完成。
- 阶段报告必须包含本次验证结果和当前边界。

## 6. 预计输出

- 第一阶段收口修复代码
- 对应测试修复或补充
- 第二阶段 Batch 1 协作基础稳定化代码与测试
- 阶段收口/启动文档
- fresh verification 证据

## 7. 执行顺序

1. 先做 Batch 0：分析并确认行为口径。
2. 再做 Batch 1：修复第一阶段 failing test，恢复验证全绿。
3. 然后做 Batch 2：把本次修复延展为第二阶段 Batch 1 协作基础稳定化交付。
4. 最后做 Batch 3：更新路线图、README 和阶段报告。
5. 完成前统一执行验证与评审。
