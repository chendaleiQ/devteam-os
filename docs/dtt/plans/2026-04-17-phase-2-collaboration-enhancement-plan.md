# 第二阶段团队协作能力增强 Plan

## 1. 目标

按已形成的 spec：`docs/dtt/specs/2026-04-17-phase-2-collaboration-enhancement-spec.md`，把 DevTeamOS 从“第一阶段本地交付闭环”推进到“更像真实研发团队的稳定协作系统”。

第二阶段完成后，系统应具备：

- Leader 能根据任务特征选择普通路径、会议路径、审批路径或阻塞路径。
- PM / Architect / Developer / QA 使用统一角色协议。
- 团队会议输出稳定的争议点、裁决理由、风险、action items 和老板确认需求。
- 测试失败、方案冲突、需求变化、风险升高都有明确回流路径。
- artifact 与上下文摘要能支撑长流程恢复和最终报告引用。
- 风险分级与审批触发规则可测试、可解释。
- 预留真实大模型接入边界，但不让模型绕过系统规则。

## 2. 决策结论

### 2.1 第二阶段形态

第二阶段继续保持纯 CLI 和本地执行能力，不做 Web 工作台。

原因：

- 第一阶段刚完成本地闭环，当前最大风险不是界面，而是协作协议、状态回流和长流程稳定性。
- Web 工作台属于第三阶段目标，提前引入会稀释第二阶段重点。

### 2.2 风险分级实现

风险分级先用规则实现，不先引入模型判断。

初始分级：

- `low`：Leader 可直接推进。
- `medium`：需要在报告中说明，并可能触发 Architect / QA 复核。
- `high`：进入会议、老板审批或阻塞状态。

### 2.3 角色协议实现

角色协议先用 TypeScript 类型固化，暂不引入 JSON schema / zod。

原因：

- 当前项目没有 schema 依赖，第二阶段不需要为协议固化增加额外运行时依赖。
- 先通过类型和测试稳定结构，后续如需要外部插件或跨进程通信，再升级为 schema。

### 2.4 上下文沉淀实现

长流程上下文摘要先扩展现有 `storage` / `artifacts`，不新增独立索引系统。

原因：

- 当前任务规模仍适合内嵌 checkpoint、artifact reference 和 context summary。
- 独立索引更适合第三或第四阶段的工作台、外部仓库和多任务并行。

### 2.5 真实大模型接入

第二阶段可以加入真实大模型，但应放在协议和风险规则稳定之后。

接入原则：

- 模型通过 `llm` provider 抽象接入，角色模块不得直接依赖某个供应商 SDK。
- 测试默认走 deterministic mock。
- PM / Architect / QA 优先支持真实模型。
- Developer 真实改代码能力延后，只允许先输出结构化实现建议或 patch plan。
- 状态流转、审批触发、安全命令和文件边界仍由系统规则控制。

## 3. 非目标

第二阶段不做：

- Web 工作台。
- 多用户系统。
- 云端执行环境。
- GitHub / GitLab 深度集成。
- 真正复杂的并行调度。
- 自动生产发布。
- 自动 Git commit / PR 流程编排。
- 让大模型直接绕过 Leader / workflow 执行命令或写文件。

## 4. 当前基础

第一阶段已经具备：

- Leader 单入口：`start`、`resume`、`approve`、`resolve-block`。
- LangGraphJS workflow 编排。
- PM / Architect / Developer / QA 独立角色模块。
- meeting / repo / runner / storage / artifacts 基础能力。
- checkpoint、waiting summary、delivery report。
- 测试失败回流和 CLI 兼容。

当前验证基线：

- `npm run typecheck`
- `npm test`
- `npm run build`

第二阶段每个批次都应至少保持 `typecheck` 和相关测试通过；阶段收口时必须三者都通过。

## 5. 实施批次

### Batch 1：统一角色协议

目标：让所有角色输入输出遵循稳定结构。

预计改动：

- `src/agents/types.ts`
  - 扩展 `AgentRunInput`：
    - `taskId`
    - `taskSummary`
    - `currentStatus`
    - `artifacts`
    - `contextSummary`
    - `riskSignals`
    - `requestedOutcome`
  - 扩展 `AgentRunOutput`：
    - `role`
    - `summary`
    - `confidence`
    - `riskLevel`
    - `risks`
    - `needsOwnerDecision`
    - `nextAction`
    - `artifact`
    - `failureReason`
- `src/agents/pm.ts`
- `src/agents/architect.ts`
- `src/agents/developer.ts`
- `src/agents/qa.ts`
  - 迁移到统一输出结构。
- `src/domain.ts`
  - 增加共享类型：`RiskLevel`、`NextAction`、`RoleDecision` 等。

测试：

- 增加或更新角色协议测试。
- 确认现有 leader / workflow 测试不退化。

通过标准：

- 四个角色输出结构一致。
- Leader 可以只依赖统一协议读取风险、下一步和审批需求。

### Batch 2：会议机制增强

目标：让 meeting 从结构化总结升级为可复用决策机制。

预计改动：

- `src/meeting.ts`
  - 增加会议输入结构：
    - topic
    - triggerReason
    - roleOutputs
    - knownRisks
    - ownerConstraints
  - 增加会议输出结构：
    - roleSummaries
    - disagreements
    - decision
    - decisionReason
    - riskLevel
    - risks
    - actionItems
    - needsOwnerDecision
    - ownerQuestion
- `src/domain.ts`
  - 固化 meeting result 类型。
- `src/leader-graph.ts`
  - 根据会议输出决定继续开发、进入审批或进入阻塞。

测试：

- meeting 输出字段完整性。
- 方案冲突触发会议。
- 高风险会议触发老板审批。

通过标准：

- 会议记录能解释为什么选择某条路径。
- meeting artifact 可被最终报告引用。

### Batch 3：风险分级与审批触发规则

目标：让风险和审批不依赖散落的字符串判断。

预计改动：

- 新增 `src/risk.ts`
  - `classifyRisk`
  - `shouldRequestOwnerDecision`
  - `collectRiskSignals`
- `src/domain.ts`
  - 增加 `ApprovalTrigger`、`RiskSignal` 类型。
- `src/leader-graph.ts`
  - 在 planning、meeting、developing、testing 节点统一应用风险规则。

初始审批触发：

- 范围变化。
- 高风险命令。
- 破坏性操作。
- 验收标准变化。
- 多方案且影响交付方向。
- 角色输出 `needsOwnerDecision = true`。

测试：

- low / medium / high 风险分类。
- 每类审批触发规则。
- 高风险进入 `awaiting_owner_decision`。

通过标准：

- 风险判断集中、可测试。
- Leader 报告能说明审批原因。

### Batch 4：回流机制增强

目标：补齐真实研发协作中的失败和争议回流。

预计改动：

- `src/leader-graph.ts`
  - 测试失败：QA -> Developer -> QA。
  - 方案冲突：Developer / Architect -> Meeting。
  - 需求变化：Leader -> PM -> Planning。
  - 风险升高：任一角色 -> Leader -> Owner decision。
- `src/workflow.ts`
  - 如需要，补充合法状态流转工具。
- `src/domain.ts`
  - 增加回流原因类型：`LoopbackReason`。

测试：

- 测试失败最多回流到开发，不能误报完成。
- 方案冲突进入 meeting。
- 需求变化重新经过 PM / planning。
- 风险升高进入审批。

通过标准：

- 每条回流都有明确原因和 artifact。
- 重复执行不会无限循环，必要时进入 blocked 或等待老板确认。

### Batch 5：上下文和产物沉淀

目标：让长流程恢复和最终报告有足够上下文。

预计改动：

- `src/artifacts.ts`
  - 增加 artifact 类型或 metadata：
    - role input snapshot
    - role output
    - meeting decision
    - risk assessment
    - loopback note
    - context summary
- `src/storage.ts`
  - 保存每个关键状态的 context summary。
  - checkpoint 引用关键 artifact ids。
- `src/leader.ts` / `src/leader-graph.ts`
  - 在暂停、审批、阻塞、完成时写入上下文摘要。

测试：

- checkpoint 保存并恢复 context summary。
- final delivery report 引用关键 artifact。
- blocked / awaiting_owner_decision 状态包含恢复建议。

通过标准：

- 老板恢复任务时能看到等待什么、为什么等待、恢复后走哪里。
- 最终报告不是纯文本堆叠，而能引用关键阶段产物。

### Batch 6：LLM Provider 抽象

目标：为真实大模型接入建立边界，同时保持测试稳定。

预计新增：

- `src/llm/types.ts`
- `src/llm/mock.ts`
- `src/llm/index.ts`

可选新增：

- `src/llm/openai.ts`

设计原则：

- `mock` provider 是默认测试实现。
- 真实 provider 只在显式配置环境变量时启用。
- 角色模块通过统一接口请求模型，不直接访问 API key。
- provider 输出必须映射回角色协议，不能直接驱动 workflow 状态。

环境变量建议：

- `DEVTEAM_LLM_PROVIDER`
- `OPENAI_API_KEY`
- `DEVTEAM_LLM_MODEL`

测试：

- mock provider deterministic。
- 未配置真实 key 时不发网络请求。
- 角色可在 mock provider 下保持稳定输出。

通过标准：

- 不配置大模型时，现有 CLI 和测试行为不变。
- 配置大模型后，PM / Architect / QA 可选择使用真实模型生成结构化输出。

### Batch 7：角色接入真实模型试点

目标：在受控范围内验证真实大模型价值。

优先接入：

- PM：澄清问题、验收标准、任务拆解。
- Architect：影响范围、方案比较、风险识别。
- QA：测试策略、失败原因总结。

暂不开放：

- Developer 直接自由改代码。

Developer 可先支持：

- 输出实现计划。
- 输出文件级改动建议。
- 输出 patch plan。

测试：

- mock 路径覆盖所有角色。
- 真实模型路径只做可选 smoke 或手动验证，不作为默认 CI 必需条件。

通过标准：

- 模型输出不破坏角色协议。
- 模型建议不会绕过风险和审批规则。

### Batch 8：CLI 兼容与阶段收口

目标：保证第一阶段能力不退化，并形成第二阶段报告。

预计改动：

- `README.md`
  - 更新当前阶段说明。
- `docs/dtt/reports/2026-04-17-phase-2-collaboration-enhancement-summary.md`
  - 记录完成内容、验证结果、剩余边界和第三阶段建议。

验证：

- `npm run typecheck`
- `npm test`
- `npm run build`
- CLI smoke：
  - `start`
  - `resume`
  - `approve`
  - `resolve-block`

通过标准：

- 第一阶段命令继续兼容。
- 第二阶段验收标准全部有测试或文档说明。
- 阶段报告清楚说明是否已接入真实大模型，以及启用方式。

## 6. 风险与控制

### 6.1 协议扩展导致测试大面积改动

控制方式：

- 先在角色层兼容旧字段，再逐步让 Leader 读取新字段。
- 每个批次只迁移一类行为。

### 6.2 会议和回流规则变复杂

控制方式：

- 风险规则集中到 `risk.ts`。
- 回流原因使用枚举或联合类型，避免散落字符串。
- 为每条回流路径加单元测试。

### 6.3 LLM 输出不稳定

控制方式：

- 默认测试使用 mock。
- 真实 provider 必须经过结构化解析和协议映射。
- 模型输出只作为角色建议，不直接控制安全边界。

### 6.4 Developer 接入模型风险过高

控制方式：

- 第二阶段不开放自由代码修改。
- 先输出 patch plan，再由现有 workflow 和安全规则决定是否执行。

## 7. 验收标准

第二阶段完成时应满足：

1. Leader 能基于任务特征选择普通路径、会议路径、审批路径或阻塞路径。
2. 角色输出遵循统一结构，测试覆盖角色协议。
3. 会议输出包含争议点、裁决理由、风险和 action items。
4. 测试失败、方案冲突、需求变化都有明确回流路径。
5. artifact 和上下文摘要可支撑长流程恢复。
6. 风险分级和审批触发有测试覆盖。
7. CLI 入口继续兼容第一阶段命令。
8. 真实大模型如接入，必须通过 provider 抽象，不影响 mock 测试稳定性。
9. `npm run typecheck`、`npm test`、`npm run build` 通过。

## 8. 推荐执行顺序

优先顺序：

1. Batch 1：统一角色协议。
2. Batch 2：会议机制增强。
3. Batch 3：风险分级与审批触发规则。
4. Batch 4：回流机制增强。
5. Batch 5：上下文和产物沉淀。
6. Batch 6：LLM Provider 抽象。
7. Batch 7：角色接入真实模型试点。
8. Batch 8：CLI 兼容与阶段收口。

不建议先做 LLM 接入。

原因：

- 当前角色协议还不够稳定，先接模型会放大调试难度。
- 真实模型输出需要被协议、风险规则和审批机制约束。
- 先稳定组织规则，模型能力才有明确落点。

## 9. 本 plan 的结论

第二阶段应先完成协作协议、会议、风险、回流和上下文沉淀，再接入真实大模型。

真实大模型不是不做，而是作为第二阶段中后段能力接入：先有 `llm` provider 抽象和 mock，再逐步让 PM / Architect / QA 使用真实模型，最后再评估 Developer 的受控代码能力。
