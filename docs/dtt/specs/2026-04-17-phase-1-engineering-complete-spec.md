# 第一阶段收口 Spec（工程完成型）

## 1. 背景

当前仓库已经有第一阶段原型骨架：CLI、Leader、workflow、storage、runner、artifacts 与基础测试。但它更接近“自控版最小闭环”，还没有真正达到“第一阶段工程完成型收口”。

本次目标不是进入第二阶段，而是把第一阶段做完整：在保留本地原型边界的前提下，把文档里承诺的主要模块、状态流转、暂停恢复、测试回流、交付报告与角色协作边界补齐到一个可持续演进的工程化版本。

## 2. 收口目标

第一阶段完成后，DevTeamOS 应满足：

1. 老板只通过 Leader 入口推进任务。
2. 系统能跑通澄清、规划、会议、开发、测试、汇报、审批等待、阻塞恢复的完整闭环。
3. workflow/orchestration 层使用 LangGraphJS 承接主流程，而不是继续完全依赖手写推进逻辑。
4. PM / Architect / Developer / QA 具备独立模块边界，即使部分实现仍可先用占位逻辑。
5. repo / runner / artifacts / storage / meeting 等模块具备第一阶段所需的最小工程化能力。
6. 现有 CLI 保持可用，并能驱动完整状态机。
7. 至少具备可信的 typecheck + test 验证覆盖。

## 3. 方案比较

### 方案 A：演示完成型

只保证链路能演示，模块可以继续混在 Leader 内部。

- 优点：最快。
- 缺点：后续接第二阶段时重构成本高。

### 方案 B：工程完成型（本次采用）

补齐第一阶段核心模块与边界，但不进入平台化和复杂并行。

- 优点：能作为第二阶段的稳定底座。
- 缺点：范围明显大于最小 demo。

### 方案 C：超前平台化

直接做工作台、多用户、复杂调度、外部集成。

- 优点：一步到位幻想更多。
- 缺点：明显超出第一阶段，风险过高。

结论：采用方案 B。

## 4. 执行规则定稿

### 4.1 团队会议触发规则

默认 Leader 直接决策。只有满足以下任一条件时才进入会议节点：

- 用户明确要求会议、评审、团队讨论。
- 规划阶段存在两个以上可行方案，且会影响验收边界。
- Architect / QA 标记存在高不确定性，需要多角色共同给结论。
- 跨模块改动较大，Developer 无法在单一路径下安全推进。

会议仍是结构化汇总节点，不实现真正复杂并行。

### 4.2 老板长时间未回复规则

当任务进入 `clarifying` 或 `awaiting_owner_decision`：

- 必须保存 checkpoint。
- 任务维持等待态，不继续改变交付方向。
- Leader 生成等待摘要，说明等待原因、所需输入、恢复后下一状态。
- 第一阶段不实现后台自动催办服务。

### 4.3 第一阶段交付物标准

默认交付物为：

1. 变更摘要或工作区 diff 说明。
2. 测试/验证结果。
3. Leader 最终交付报告。
4. 关键阶段 artifact（需求说明、方案、会议结论、测试报告等）。

Git commit、本地分支、patch 文件不是第一阶段必须项；除非用户明确要求，不自动执行 commit。

### 4.4 测试命令来源规则

测试命令优先级：

1. 用户明确指定。
2. 仓库配置明确给出。
3. 自动识别项目脚本。
4. 若仍无法确认，则进入 `blocked` 或等待确认，不盲跑未知命令。

对当前仓库，默认安全验证为：

- `npm run typecheck`
- `npm test`
- 必要时 `npm run build`

## 5. 工程范围

### 5.1 workflow / orchestration

使用 LangGraphJS 接管主流程状态图，覆盖：

- `intake`
- `clarifying`
- `planning`
- `meeting`
- `developing`
- `testing`
- `reporting`
- `awaiting_owner_decision`
- `blocked`
- `done`

需要支持：

- 状态条件分支
- 测试失败回流开发
- 老板审批后继续推进
- 阻塞解除后恢复规划
- checkpoint 与 resume

### 5.2 Leader 层

Leader 负责：

- 接收老板输入
- 组织 graph 执行
- 汇总角色结果
- 生成审批请求和最终交付

Leader 不再硬编码全部角色输出流程；具体角色执行应通过适配层调用。

### 5.3 角色层

需要形成独立模块边界：

- PM：澄清问题、验收标准、计划输入
- Architect：影响范围、方案、风险
- Developer：实现摘要、代码改动执行
- QA：验证策略、测试结果、失败原因

第一阶段允许角色内部仍有占位实现，但必须从 Leader 内部分离成明确接口。

### 5.4 meeting 模块

需要独立生成结构化会议输出，至少包含：

- 当前议题
- 各角色意见摘要
- 一致结论
- 风险列表
- 下一步动作
- 是否需要老板拍板

### 5.5 repo 模块

需要具备第一阶段最小能力：

- 仓库搜索
- 文件读取
- 变更摘要
- 可选的工作区 diff 汇总

不做复杂 Git 流程自动化。

### 5.6 runner 模块

需要统一：

- 安全命令执行
- 测试命令解析
- 测试结果结构化输出
- 失败结果回流给 QA / Leader

### 5.7 artifacts / storage

需要保证：

- 各阶段 artifact 有稳定结构
- Task / AgentRun / ApprovalRequest / StateTransition 可持久化
- pause / resume 依赖 checkpoint 恢复，而不是重新跑全流程

### 5.8 CLI 兼容

现有 `start` / `resume` / `approve` / `resolve-block` 命令必须继续可用。

## 6. 非目标

本次不做：

- Web 工作台
- 多用户系统
- 云端执行环境
- 真正复杂并行调度
- 自动生产发布
- 高风险 Git 自动化
- 第二阶段的完整组织增强能力

## 7. 验收标准

第一阶段工程完成型收口必须满足以下条件：

1. 标准任务路径可从输入需求推进到最终汇报/完成。
2. 模糊需求能进入澄清并在恢复后继续。
3. 复杂任务能进入会议并产出结构化结论。
4. 需要老板决策的任务能暂停在审批状态，并在批准后继续。
5. 测试失败能回流到开发，不能误报完成。
6. LangGraphJS 已实际承接 workflow/orchestration 主流程。
7. PM / Architect / Developer / QA 已形成独立模块边界。
8. repo / runner / artifacts / storage / meeting 模块具备第一阶段最小工程能力。
9. CLI 保持兼容。
10. `npm run typecheck` 与 `npm test` 通过；如涉及构建链路，还需 `npm run build` 通过。

## 8. 风险

- LangGraphJS 接入会引入状态映射与类型适配工作。
- 角色拆分和 workflow 迁移若同时推进，容易改动过大。
- meeting / repo / runner 边界如果定义不清，后续仍会回流到 Leader 内。

因此实施上应按批次推进，而不是一次性重写整个仓库。

## 9. 推荐实施顺序

1. 先固化执行规则与领域对象边界。
2. 引入 LangGraphJS workflow wrapper，替换主流程推进骨架。
3. 拆出角色适配层与 meeting 模块。
4. 补齐 repo / runner / artifacts / storage 缺口。
5. 补测试并验证 CLI 全链路。

## 10. 本 spec 的结论

本次以“工程完成型”作为第一阶段收口标准。

批准后，下一步应进入 plan，拆成可执行批次，而不是直接开始大范围改代码。
