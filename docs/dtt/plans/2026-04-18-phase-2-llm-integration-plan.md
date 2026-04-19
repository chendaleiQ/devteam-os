# 第二阶段真实大模型接入 Plan

## 1. 目标

基于已批准 spec：`docs/dtt/specs/2026-04-18-phase-2-llm-integration-spec.md`，在不破坏现有 CLI、第一阶段绿线和默认测试稳定性的前提下，为 DevTeamOS 增加受控的真实大模型接入能力。

本次 plan 的落地目标是：

1. 建立 `llm` provider 抽象层，默认走 deterministic mock。
2. 支持一个真实 provider（首选 OpenAI），仅在显式配置时启用。
3. 让 PM / Architect / QA 可通过 provider 生成结构化角色输出。
4. 让 Developer 可生成**结构化 patch proposal**，并在系统校验通过后进入受控写入流程。
5. 显式真实 provider 失败时不静默 fallback；默认 mock 路径保持稳定。

## 2. 已批准 Spec 摘要

已确认的关键边界：

- 本次属于第二阶段中后段能力，不是第三/第四阶段内容。
- 默认仍是 mock；真实 provider 只在显式配置下启用。
- 角色输出继续复用现有 `AgentRunOutput` 顶层协议。
- Developer 不直接自由写代码，只允许生成**文件级结构化 patch proposal**。
- patch proposal 仅允许 `add` / `update`，不允许 `delete` / `rename` / workspace 外路径 / 执行命令。
- 显式启用真实 provider 后失败，必须返回可见错误，不静默回退到 mock。

## 3. 架构摘要

本次实现分为四层：

### 3.1 Provider 层

新增 `src/llm/`，统一封装：

- provider 类型
- provider 选择逻辑
- mock provider
- OpenAI provider
- provider 配置、超时、错误语义

### 3.2 角色适配层

PM / Architect / QA / Developer 不直接访问某家 SDK，而是通过统一 provider 接口获取结构化建议，再映射回角色协议。

### 3.3 Patch Proposal 层

Developer 的 LLM 输出不直接写文件，而是生成 `DeveloperPatchProposal`，再由系统校验：

- 格式是否合法
- 路径是否合法
- 操作是否合法
- 内容是否可落盘

### 3.4 受控写入层

只有校验通过的 proposal 才可进入受控写入流程。第一版采用文件级完整内容写入，复用 workspace 边界检查，不开放自由 diff / shell / 外部路径。

## 4. 批次与步骤

### Batch 1：Provider 抽象与配置语义

目标：先把 LLM 接入边界立住，保证 mock/real 语义清楚、测试稳定。

优先文件：

- 新增 `src/llm/types.ts`
- 新增 `src/llm/mock.ts`
- 新增 `src/llm/index.ts`
- 新增 `src/llm/openai.ts`
- 必要时：`src/leader.ts`、`src/cli.ts`
- 新增测试：`tests/llm-provider.test.ts`

执行内容：

- 定义 provider 接口、请求/响应结构、provider 错误类型。
- 实现 deterministic mock provider。
- 实现 OpenAI provider（优先使用平台原生 `fetch`，避免新增不必要依赖）。
- 实现配置解析：
  - 默认 `mock`
  - 显式 `openai`
  - 缺 key / model 报配置错误
  - 显式真实 provider 失败不静默 fallback
- 增加 timeout / retry / logging 的最小约束实现，且在本批次就明确：
  - 仅对可判定为瞬时网络错误的场景重试
  - 配置错误、结构错误、schema 错误不得重试
  - 日志不得泄露 API key、Authorization header 或完整 secret

通过标准：

- 未配置真实 provider 时不发网络请求。
- 非法配置有明确错误。
- mock 行为 deterministic。
- timeout / retry 规则有测试覆盖。
- secret redaction / logging 约束有测试覆盖。

### Batch 2：PM / Architect / QA 接入模型输出

目标：先让分析类角色接入真实模型，保持 Developer 写入风险暂时受控。

优先文件：

- `src/agents/types.ts`
- `src/agents/index.ts`
- `src/agents/pm.ts`
- `src/agents/architect.ts`
- `src/agents/qa.ts`
- 必要时：`src/leader-graph.ts`
- 更新测试：`tests/agents-protocol.test.ts`

执行内容：

- 为角色增加“规则输出 / mock provider / 真实 provider”三种受控路径。
- 让 PM / Architect / QA 的模型输出在进入系统前完成协议映射与结构校验。
- 保持现有 `AgentRunOutput` 顶层协议不变。
- 若 provider 调用失败或结构不合法，返回可见失败，而不是偷偷切回 mock。

通过标准：

- mock 路径下三类角色协议测试稳定通过。
- 真实 provider 路径可选启用，但默认测试不依赖真实网络。
- malformed 输出不会被当作成功角色输出。

### Batch 3：Developer 结构化 patch proposal 与校验

目标：让 Developer 在受控边界内使用真实模型生成可校验 proposal。

优先文件：

- `src/domain.ts`
- 新增 `src/patch-proposal.ts`
- `src/agents/developer.ts`
- `src/agents/index.ts`
- 更新测试：
  - `tests/agents-protocol.test.ts`
  - 新增 `tests/patch-proposal.test.ts`

执行内容：

- 定义 `DeveloperPatchProposal` 类型与 artifact 承载方式。
- 实现 proposal 校验：
  - `format`
  - `summary`
  - `rationale`
  - `verificationPlan`
  - `changes[]`
  - workspace 内相对路径
  - 只允许 `add` / `update`
  - `add` 只能指向不存在文件
  - `update` 只能指向已存在文件
  - 同一 proposal 内不得对同一路径给出冲突的多次操作
- Developer 的 mock / real 输出都必须走 proposal 校验。
- proposal 校验失败时，Developer 本次运行给出明确失败原因。

通过标准：

- 合法 proposal 能通过校验。
- 非法 proposal 不会进入写入流程。
- workspace 外路径、非法操作、缺字段、同路径冲突、`add` 写已存在文件、`update` 写不存在文件等负路径全部可测。

### Batch 4：受控写入路径与 workflow 对接

目标：让校验通过的 proposal 可以进入受控写入路径，但仍由系统规则掌控。

优先文件：

- 新增 `src/patch-apply.ts`
- 必要时：`src/repo.ts`
- `src/leader-graph.ts`
- `src/runner.ts`（仅在验证链路需要补充时）
- 新增/更新测试：
  - `tests/repo.test.ts`
  - `tests/leader.test.ts`

执行内容：

- 实现 proposal -> 文件写入的受控转换。
- 仅允许 workspace 内 `add` / `update`。
- 写入语义明确为：
  - `add`：目标文件必须不存在，否则拒绝写入
  - `update`：目标文件必须已存在，否则拒绝写入
- 写入失败、校验失败、provider 失败都必须是可见失败。
- 写入后继续走现有验证与回流机制，不让模型直接决定任务完成。

通过标准：

- 合法 proposal 可受控写入。
- 越权 proposal 被系统拦截。
- `add` 写已存在文件、`update` 写不存在文件会被稳定拦截。
- workflow、审批和验证链路仍由系统主控。

### Batch 5：文档、启用说明与收口

目标：把 LLM 接入方式写清楚，并在不破坏当前阶段文档的前提下说明“第二阶段已进入受控真实模型接入”。

优先文件：

- `README.md`
- `docs/development-roadmap.md`
- 新增 `docs/dtt/reports/2026-04-18-phase-2-llm-integration-summary.md`

执行内容：

- 更新 README 当前重点与启用说明。
- 在路线图中把“第二阶段 Batch 1”推进到“第二阶段中后段：受控真实模型接入”。
- 新增老板可读阶段报告，说明：
  - 默认 mock / 显式 real 的差异
  - 当前真实 provider 支持范围
  - Developer patch proposal 边界
  - 当前仍未开放的高风险能力

通过标准：

- 文档与代码口径一致。
- 老板能理解如何启用、当前边界是什么、哪些能力仍未开放。

## 5. 验证检查点

### 检查点 A：Provider 抽象

- `tests/llm-provider.test.ts`
- 非法配置 / 无 key / mock 默认路径验证
- 瞬时网络错误重试验证
- 配置错误 / schema 错误不重试验证
- logging 不泄露 secret 验证

### 检查点 B：分析类角色接入

- `tests/agents-protocol.test.ts`
- malformed 输出负路径测试

### 检查点 C：Developer patch proposal

- `tests/patch-proposal.test.ts`
- workspace 外路径 / 非法操作 / 缺字段 / 同路径冲突负路径测试

### 检查点 D：受控写入与全链路

- `tests/leader.test.ts`
- `add` 写已存在文件 / `update` 写不存在文件测试
- 必要时 CLI smoke

### 最终 fresh verification

- `npm run typecheck`
- `npm test`
- `npm run build`

如环境已显式配置真实 provider，可追加**非默认** smoke：

- PM / Architect / QA 真实 provider 路径
- Developer proposal 生成与校验路径

注意：真实 provider smoke 不作为默认 CI 必需条件。

## 6. 风险与控制

### 风险 1：Provider 接入拉大改动范围

控制：

- 先做 Provider 层，再逐批接角色。
- 顶层协议尽量复用，不做一次性大迁移。

### 风险 2：Developer proposal 形同自由写文件

控制：

- 第一版只允许文件级 `add` / `update`。
- 必须经结构校验与 workspace 边界校验。
- 不开放 `delete` / `rename` / shell 命令。

### 风险 3：真实 provider 失败语义混乱

控制：

- 默认 mock
- 显式 real 不静默 fallback
- 错误可见、可测、可区分配置错误与运行时错误

### 风险 4：默认测试稳定性被真实网络破坏

控制：

- CI / 默认测试强制 mock
- 真实 provider 仅显式 smoke / 手动验证

## 7. 预计输出

- `src/llm/` provider 抽象与实现
- 分析类角色的 LLM 受控接入
- Developer patch proposal 类型、校验器和受控写入路径
- 负路径测试与 provider 测试
- LLM 接入阶段报告与启用说明

## 8. 执行顺序

1. Batch 1：Provider 抽象与配置语义
2. Batch 2：PM / Architect / QA 接入模型输出
3. Batch 3：Developer patch proposal 与校验
4. Batch 4：受控写入路径与 workflow 对接
5. Batch 5：文档与阶段收口
6. 最后统一做 reviewer、fresh verification 和可选 real-provider smoke
