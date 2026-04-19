# 第二阶段真实大模型接入 Spec

## 1. 背景

截至 2026-04-18，DevTeamOS 已完成两项基础工作：

1. 第一阶段“Leader 驱动的本地交付原型”已重新收口，并重新通过 fresh verification。
2. 第二阶段已启动，当前已完成 Batch 1：协作基础稳定化，`riskSignals` 等协作基础信号已经开始在角色协议中真实生效。

在这个基础上，当前要进入第二阶段中后段能力：**真实大模型接入**。

但接入目标不是让模型绕过系统规则直接行动，而是让模型在受控边界内增强角色能力，同时继续由 Leader、workflow、安全边界和验证机制掌控执行。

## 2. 本次目标

本次希望实现的是：

> 在不破坏现有 CLI、测试稳定性和安全边界的前提下，为 DevTeamOS 增加真实大模型能力，让 PM / Architect / QA 可直接使用真实模型生成结构化输出，并让 Developer 在受控边界内生成**结构化 patch**，再由系统校验后进入写入流程。

## 3. 用户已确认的关键决定

### 3.1 接入范围

用户已选择：**接入 Provider 抽象 + 真实模型试点 + Developer 参与**。

也就是说，本次不是只做 mock，也不是只做 PM / Architect / QA，而是允许 Developer 也接入真实模型能力。

### 3.2 Developer 边界

用户已选择：**Developer 生成结构化 patch，由系统校验后再写入**。

这意味着：

- Developer 不直接自由输出并落盘任意代码。
- 模型输出必须先转成受控结构。
- 写入动作仍由系统规则、安全边界和验证流程控制。

## 4. 方案比较

### 方案 A：只做 Provider 抽象，不接真实供应商

优点：

- 风险最低。
- 最容易保持测试稳定。

缺点：

- 不能验证真实模型的实际价值。
- 不能满足当前“接入大模型”的直接目标。

### 方案 B：Provider 抽象 + 真实模型试点（PM / Architect / QA）

优点：

- 能先验证模型在分析、规划、测试总结上的价值。
- 风险相对可控。

缺点：

- Developer 仍停留在非模型路径，不能覆盖用户当前希望的开发侧受控接入。

### 方案 C：Provider 抽象 + 真实模型试点（含 Developer 结构化 patch）【推荐】

优点：

- 满足当前用户目标。
- 能在受控边界内验证模型从需求分析到开发建议的完整价值链。
- 仍可把真正高风险的“自由写代码”挡在系统规则之外。

缺点：

- 比方案 B 更复杂，需要额外处理结构化 patch 校验与安全边界。
- 需要更严格的 mock 与真实 provider 双路径测试。

## 5. 推荐方案

采用 **方案 C**，但 Developer 的模型能力限定为：

- 输出结构化 patch proposal
- 输出文件级改动建议
- 输出 patch 说明、风险与适用条件

而不是：

- 直接绕过系统自由写文件
- 直接决定 workflow 状态
- 直接执行命令

## 6. 范围

### 6.1 包含范围

- 新增 `llm` provider 抽象层。
- 提供默认 deterministic `mock` provider。
- 提供一个真实 provider（首选 OpenAI）。
- 用统一接口让 PM / Architect / QA 可选择使用模型生成结构化角色输出。
- 让 Developer 可生成结构化 patch proposal，并进入系统校验流程。
- 用显式配置决定是否启用真实模型。
- 保持现有 CLI 入口不变。
- 保持测试默认不依赖真实网络请求。

### 6.3 协议兼容策略

本次接入默认**复用现有角色协议**，不把 LLM 接入扩展成一次协议大重写。

- PM / Architect / QA：复用现有 `AgentRunOutput` 顶层字段，不新增对外必填字段。
- Developer：复用现有 `AgentRunOutput` 顶层字段；结构化 patch proposal 通过新的结构化 artifact 承载，而不是让所有消费者都理解一套新的顶层开发协议。
- 现有消费者（如 `leader-graph`、既有测试、CLI）继续依赖当前顶层协议读取 `summary`、`riskLevel`、`needsOwnerDecision`、`nextAction`、`artifact`。
- 只有需要消费 patch proposal 的受控写入链路，才需要解析新的 artifact 结构。

这意味着本次 scope 主要是：

- 新增 provider 能力
- 新增结构化输出校验
- 为 Developer 新增 patch proposal artifact

而不是：

- 全量改写所有角色协议消费者
- 在当前批次引入大规模兼容迁移

### 6.2 不包含范围

- Web 工作台。
- 多供应商矩阵同时完整支持。
- 让模型直接执行命令。
- 让模型直接绕过安全边界写文件。
- 让模型直接决定审批、阻塞或状态流转。
- 自动发布、生产操作、外部平台深度集成。

## 7. 设计原则

### 7.1 Provider 抽象优先

角色模块不得直接依赖某个供应商 SDK。

统一通过 `llm` provider 接口访问模型能力。

### 7.2 Mock 默认，真实可选

- 默认路径必须是 mock。
- 未配置真实 key 时，不得发网络请求。
- 测试和本地稳定验证优先依赖 mock。

### 7.3 模型输出必须回到角色协议

模型输出不能直接驱动 workflow。

它必须先映射为已有或扩展后的角色协议字段，并通过结构校验后，才能成为合法角色输出。

#### PM / Architect / QA 合法输出契约

对 PM / Architect / QA，本次复用现有 `AgentRunOutput` 顶层协议。合法结构至少必须包含：

- `role`：必填；类型为 `"pm" | "architect" | "qa"`
- `summary`：必填；非空字符串
- `confidence`：必填；`0` 到 `1` 之间的数字
- `riskLevel`：必填；`"low" | "medium" | "high"`
- `risks`：必填；字符串数组，可为空数组
- `needsOwnerDecision`：必填；布尔值
- `nextAction`：必填；必须属于现有 `NextAction` 联合类型
- `artifact`：必填；必须能映射为合法 `Artifact`
- `failureReason`：可选；字符串，仅在 provider 调用失败或结构校验失败时出现

#### Developer 合法输出契约

对 Developer，本次仍复用现有 `AgentRunOutput` 顶层协议：

- `role`：必填；固定为 `"developer"`
- `summary`：必填；非空字符串
- `confidence`：必填；`0` 到 `1` 之间的数字
- `riskLevel`：必填；`"low" | "medium" | "high"`
- `risks`：必填；字符串数组
- `needsOwnerDecision`：必填；布尔值
- `nextAction`：必填；必须属于现有 `NextAction`
- `artifact`：必填；当走 LLM patch 路径时，artifact 必须承载结构化 patch proposal
- `failureReason`：可选；字符串

#### 不合法输出判定

以下任一情况都视为不合法输出：

- 缺少任一必填字段
- 字段类型错误
- `nextAction` 不在允许枚举内
- `artifact` 不能解析为合法结构
- Developer 的 artifact 缺少合法 patch proposal 结构
- 输出虽然可解析，但包含超出当前边界的操作（例如直接要求执行命令、直接绕过系统写文件）

#### 不合法输出处理

- 不把该输出当作成功角色输出。
- 记录结构化失败原因到 `failureReason` 或等效错误产物。
- 不得直接进入写入、审批或状态流转。
- 失败必须对调用方可见，不能被静默吞掉。

### 7.4 系统规则仍然是最终控制层

无论是否启用真实模型：

- 状态流转由 workflow 决定。
- 审批触发由系统规则决定。
- 命令边界由 runner / repo /安全规则决定。
- 文件写入必须经过系统校验。

## 8. Developer 结构化 Patch 边界

Developer 接入真实模型后，允许模型生成 **结构化 patch proposal**，但该 proposal 至少应满足以下特征：

- 明确涉及哪些文件
- 明确每个文件的修改意图
- 明确风险、限制和适用条件
- 能被系统做结构校验
- 校验失败时不得进入写入流程

### 8.1 Patch proposal 结构

第一版不采用任意自由 diff 文本，而采用**文件级结构化 proposal**。

建议结构如下：

```ts
interface DeveloperPatchProposal {
  format: 'devteam.patch-proposal.v1'
  summary: string
  rationale: string
  verificationPlan: string[]
  changes: Array<{
    path: string
    operation: 'add' | 'update'
    purpose: string
    content: string
  }>
}
```

### 8.2 第一版允许的边界

- 允许多文件 proposal。
- 允许操作：`add`、`update`。
- **暂不允许**：`delete`、`rename`、执行命令、修改 workspace 外路径。
- `add` 的语义是：目标文件当前**不存在**；若已存在，则视为非法 proposal。
- `update` 的语义是：目标文件当前**必须已存在**；若不存在，则视为非法 proposal。
- `path` 必须是 workspace 内相对路径。
- `content` 必须是目标文件的完整内容，而不是任意 shell 指令或非结构化混合文本。

### 8.3 校验规则

至少校验以下内容：

- `format` 必须等于 `devteam.patch-proposal.v1`
- `summary`、`rationale` 为非空字符串
- `verificationPlan` 为字符串数组
- `changes` 非空
- 每个 change 的 `path` 合法且位于 workspace 内
- `operation` 只能是 `add` 或 `update`
- `add` 不能指向已存在文件
- `update` 不能指向不存在文件
- `content` 必须是字符串
- 同一 proposal 内不得对同一路径给出互相冲突的多次操作

### 8.4 校验失败处理

- 任一校验失败即判定该 proposal 不合法
- 不进入写入流程
- Developer 本次运行记为失败或受阻，需给出明确失败原因
- 可在报告中提示“模型输出未通过结构化 patch 校验”

### 8.5 为什么用文件级 proposal

第一版选择文件级 proposal，而不是更复杂的 hunk 级 patch，原因是：

- 更容易校验边界
- 更容易在现有系统里受控落盘
- 更容易证明“模型没有直接自由写文件，而是经过系统检查后写入”

未来如果需要更细粒度 patch，可在后续批次引入，但不属于本次范围。

推荐的系统处理方式：

1. Developer 调用 provider 获取结构化 patch proposal。
2. 系统检查 proposal 是否满足格式和边界要求。
3. 只有通过校验的 proposal 才能进入后续受控写入流程。
4. 写入后仍需执行既有验证与回流机制。

## 9. 配置与启用原则

建议环境变量：

- `DEVTEAM_LLM_PROVIDER`
- `DEVTEAM_LLM_MODEL`
- `OPENAI_API_KEY`

### 9.1 配置优先级

配置优先级建议为：

1. 显式运行时参数（如后续增加 provider 选项）
2. 环境变量
3. 默认值（`mock`）

### 9.2 默认与显式启用语义

- 未显式配置 provider 时，默认使用 `mock`。
- `DEVTEAM_LLM_PROVIDER=mock` 时，明确走 mock。
- `DEVTEAM_LLM_PROVIDER=openai` 时，必须同时具备可用的 `OPENAI_API_KEY` 与模型配置。

### 9.3 非法配置处理

- provider 未知：启动或首次调用时报配置错误。
- provider 指向真实模型但缺少 key / model：报配置错误。
- 配置错误时**不得静默回退到 mock**，以免掩盖真实问题。

### 9.4 运行时失败语义

为了避免行为不一致，本次定义如下：

- **默认路径**：未显式启用真实 provider 时，系统始终使用 mock。
- **显式真实路径**：一旦显式启用真实 provider，就不做静默 fallback 到 mock。
- 真实 provider 调用失败时，应返回结构化 provider error，并让当前角色运行进入可见失败，而不是偷偷改走 mock。

也就是说：

- “默认稳定路径” = 未启用真实 provider 时的 mock
- “显式真实路径失败” = 明确报错 / 失败，不隐藏

### 9.5 环境语义

- **测试 / CI**：默认强制 mock；真实 provider 只允许显式 smoke 或手动验证，不作为默认测试路径。
- **本地开发**：未配置时走 mock；显式配置真实 provider 时走真实路径。
- **生产环境**：当前阶段不定义，仍不在本次范围内。

### 9.6 timeout / retry / logging 约束

- 单次 provider 调用必须有超时上限。
- 只允许有限重试，且仅对可判定为瞬时网络错误的场景生效。
- 配置错误、结构错误、schema 错误不得重试。
- 日志中不得输出 API key、Authorization header、完整 secret。
- 默认日志只记录 provider 名称、模型名、耗时、成功/失败状态和错误摘要。

## 10. 验收标准

本次接入完成后，应满足：

1. 不配置真实模型时，现有 CLI 和默认测试行为不变。
2. `mock` provider 是 deterministic 的，可稳定支撑测试。
3. 配置真实模型后，PM / Architect / QA 可通过 provider 生成结构化角色输出。
4. Developer 可生成结构化 patch proposal，但不能绕过系统直接写文件。
5. provider 输出必须映射回角色协议，不能直接控制 workflow 状态。
6. 真实模型路径的失败不会破坏默认 mock 路径。
7. `npm run typecheck`、`npm test`、`npm run build` 通过。

### 10.1 必须覆盖的负路径验收

除正向能力外，还必须验证以下负路径：

1. 模型返回 malformed 输出时，结构校验失败且不会被当作成功角色输出。
2. Developer patch proposal 缺字段、字段类型错误或包含非法操作时，不进入写入流程。
3. Developer proposal 试图写 workspace 外路径时，会被系统拦截。
4. 显式启用真实 provider 但 key 缺失时，系统报配置错误而不是静默 fallback。
5. 真实 provider 运行失败时，错误对调用方可见，且不会破坏默认 mock 测试路径。

## 11. 风险与控制

### 风险 1：真实模型输出不稳定

控制：

- mock 默认
- 结构化解析
- 协议映射
- 未显式启用真实 provider 时，默认走稳定 mock 路径
- 显式真实 provider 失败时，不做静默 fallback，而是返回可见错误

### 风险 2：Developer 模型能力越权

控制：

- 只允许结构化 patch proposal
- 系统校验后才可写入
- 不允许模型直接执行命令或直接写文件

### 风险 3：真实 provider 破坏测试稳定性

控制：

- 测试默认只跑 mock
- 真实 provider 只做可选 smoke / 手动验证
- 未配置 key 时不得发起网络调用

## 12. 对路线图的影响

这次工作仍然属于**第二阶段**，但属于第二阶段的**中后段能力**。

也就是说：

- 它不是第一阶段内容
- 它不是第三阶段产品化工作台内容
- 它不是第四阶段平台化/标准化内容

本次工作完成后，第二阶段将从“协作基础稳定化”进一步推进到“受控真实模型接入”。
