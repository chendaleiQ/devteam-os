# 第一阶段下一步 Spec：执行规则定稿与 LangGraphJS 轻接入

## 1. 背景

当前项目处于第一阶段：Leader 驱动的本地交付原型。

现有仓库已经具备自控版原型骨架：

- CLI 入口可触发 `start` / `resume` / `approve` / `resolve-block` 等任务动作。
- `leader.ts` 负责主控推进、暂停、审批、占位角色产物与交付报告。
- `workflow.ts` 已定义轻量状态机与关键回流。
- `storage` / `runner` / `artifacts` 等模块已支持本地状态、命令执行和产物沉淀。

本次不是进入路线图第二阶段，而是继续第一阶段的下一批工作：先把 `docs/phase-1-plan.md` 第 13 节的执行规则定下来，再把 workflow/orchestration 层轻量接入 LangGraphJS，避免后续状态流转和暂停恢复逻辑大面积返工。

## 2. 本批目标

本批目标是完成一个可验证的第一阶段升级闭环：

1. 将第一阶段执行规则从文档讨论转为代码/配置可消费的规则。
2. 将 LangGraphJS 接入在 workflow/orchestration 层，用于管理 Leader 主流程状态、条件分支、回流、暂停与恢复。
3. 保持 CLI、storage、runner、artifacts 等外围能力稳定，避免一次性重写整个系统。
4. 将 PM / Architect / Developer / QA 从 Leader 内部占位逻辑中抽象为角色适配层；本批可以仍使用占位实现，但调用边界要先独立出来。
5. 保持第一阶段“串行为主，会议作为结构化节点”的执行模型。

## 3. 非目标

本批不做以下内容：

- 不进入路线图第二阶段的完整团队协作增强。
- 不做 Web 工作台、多用户、云端执行环境。
- 不做复杂并行调度。
- 不自动执行破坏性 Git 操作、生产发布或高风险数据迁移。
- 不把整个系统替换成 deepagent / AutoGen / CrewAI 之类完整 Agent 框架。
- 不把 LangGraphJS 下沉到 CLI、文件读写、测试命令执行或 artifact 存储细节里。

## 4. 架构方案比较

### 方案 A：继续保留纯手写 workflow

优点：

- 改动最小。
- 短期实现最快。

缺点：

- 后续状态流转、回流、暂停恢复会持续堆在自定义逻辑里。
- 等到角色和会议机制变复杂后再迁移 LangGraphJS，重写成本更高。

### 方案 B：立即全面重写为 LangGraphJS / Agent 框架驱动

优点：

- 抽象更完整。
- 更接近未来复杂协作模型。

缺点：

- 第一阶段风险过高。
- 容易把 CLI、工具执行、存储和状态恢复全部卷入重构。
- 不利于保留当前已验证的本地原型骨架。

### 方案 C：推荐方案，LangGraphJS 轻接入 workflow/orchestration 层

做法：

- 保留 CLI、storage、runner、artifacts 的现有职责。
- 用 LangGraphJS 承接 Leader 主流程状态图和条件分支。
- 通过角色适配器调用 PM / Architect / Developer / QA。
- 继续使用现有 Task / Artifact / AgentRun / ApprovalRequest 等领域对象，必要时补充字段或转换层。

优点：

- 能尽早验证 LangGraphJS 是否适合当前项目。
- 降低后续 workflow 大重写概率。
- 保留第一阶段的强可控性和可测试性。

缺点：

- 需要处理现有状态机与 LangGraphJS graph state 的映射。
- 短期会出现过渡期适配代码。

结论：本批采用方案 C。

## 5. 执行规则决策

### 5.1 团队会议触发规则

默认由 Leader 直接决策，只有满足以下任一条件时触发团队会议：

- 用户明确要求会议、评审、多人同步或团队讨论。
- Planning 阶段识别到多个可行方案且会影响验收边界。
- Architect 或 QA 标记存在不确定风险，需要 PM / Architect / Developer / QA 共同给结论。
- 任务涉及跨模块变更，且 Developer 无法在单一实现路径下安全推进。

第一阶段会议仍是结构化汇总节点，不做真正并行协商。

### 5.2 老板长时间未回复规则

当任务进入 `clarifying` 或 `awaiting_owner_decision`：

- 系统必须保存完整 checkpoint。
- 任务保持等待态，不继续做会改变交付方向的动作。
- 本批不实现后台定时提醒服务。
- Leader 需要生成可展示的等待摘要，说明当前等待什么、为什么必须等待、批准后会继续到哪个状态。

后续若接入工作台或通知系统，再扩展真正的自动提醒。

### 5.3 第一阶段交付物标准

第一阶段默认交付物为：

1. 工作区 diff 或变更摘要。
2. 测试/验证结果。
3. Leader 最终交付报告。

Git commit、本地分支、补丁文件作为可选增强，不作为本批必须交付标准。系统不得自动 commit 或执行破坏性 Git 操作，除非老板明确授权。

### 5.4 测试命令来源规则

测试命令按以下优先级确定：

1. 老板在任务中明确指定的命令。
2. 仓库配置中明确记录的命令。
3. 项目脚本自动识别，例如 `package.json` 的 `test`、`typecheck`、`build`。
4. 若无法确定安全命令，则进入 `blocked` 或输出待确认问题，不盲目执行未知命令。

对当前仓库，默认安全验证命令可以从 `package.json` 读取：

- `npm run typecheck`
- `npm test`
- 必要时 `npm run build`

## 6. 功能范围

### 6.1 LangGraphJS 接入边界

LangGraphJS 只接入以下范围：

- Leader 主流程 graph。
- 状态节点：`intake`、`clarifying`、`planning`、`meeting`、`developing`、`testing`、`reporting`、`awaiting_owner_decision`、`done`、`blocked`。
- 条件分支：是否需要澄清、是否需要会议、是否需要老板拍板、测试是否通过、是否阻塞。
- 回流：测试失败回到开发、等待老板审批后回到规划/开发/完成、阻塞解除后回到规划。

LangGraphJS 不负责：

- CLI 参数解析。
- 底层文件系统读写。
- 命令执行安全策略。
- artifact 持久化格式。
- Git 提交/分支管理。

### 6.2 角色适配层

本批需要建立角色调用边界：

- PM：需求澄清、验收标准、计划输入。
- Architect：影响范围、技术方案、风险。
- Developer：实现摘要、变更产物。
- QA：验证策略、测试结果、失败原因。

第一阶段可以继续使用 deterministic placeholder 实现，但 Leader 不应再直接硬编码所有角色输出细节；应通过统一角色接口调用。

### 6.3 状态与持久化

现有 Task 仍是业务主对象。LangGraphJS 的 graph state 应能映射到 Task：

- 当前状态。
- 已有 artifacts。
- agentRuns。
- transitions。
- approvalRequests。
- validation。
- deliveryReport。

任务暂停时必须保存 checkpoint，恢复时基于已有 Task 继续，而不是从头开始。

## 7. 验收标准

本批完成后，应满足：

1. 第 13 节四类执行规则已经在 spec/代码/配置中有明确表达。
2. 标准任务能通过 LangGraphJS workflow 从 intake 推进到 reporting/done。
3. 需求不清任务能进入 clarifying，并可在 resume 后继续。
4. 需要老板拍板的任务能进入 awaiting_owner_decision，并可在 approve 后继续。
5. 测试失败能回流到 developing，不能误报完成。
6. PM / Architect / Developer / QA 通过角色适配层被调用，即使当前仍是占位实现。
7. 现有 CLI 行为保持兼容。
8. 至少补充或更新测试覆盖：标准路径、澄清暂停/恢复、老板审批暂停/继续、测试失败回流。
9. 验证命令至少包括 `npm run typecheck` 与 `npm test`。

## 8. 风险与限制

- LangGraphJS 依赖引入后，类型定义和 ESM 配置可能需要调整。
- 现有手写 workflow 与 graph workflow 过渡期间可能出现重复逻辑，应通过清晰模块边界控制。
- 如果一次性拆太多目录，容易影响已跑通的 CLI，因此本批以最小可验证迁移为准。
- 如果无法稳定安装或使用 LangGraphJS，应先保留执行规则和角色适配层，再把 LangGraphJS 接入作为阻塞项报告。

## 9. 推荐推进顺序

1. 先落地执行规则模型。
2. 再抽出角色适配接口。
3. 然后引入 LangGraphJS workflow wrapper。
4. 最后把 Leader 的推进逻辑逐步切换到 graph，补齐测试。

## 10. 待审批结论

建议批准本 spec，并进入执行计划编写阶段。

批准后，下一步将生成具体 plan，明确文件改动、测试策略、分批实施顺序和评审点。
