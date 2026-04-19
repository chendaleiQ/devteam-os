# 第二阶段 MiniMax Provider 扩展 Plan

## 1. 目标

基于已批准 spec：`docs/dtt/specs/2026-04-18-phase-2-minimax-provider-extension-spec.md`，在不破坏现有 `mock` / `openai` / 受控角色协议链路的前提下，为 DevTeamOS 新增 `minimax` 真实 provider 支持。

本次计划的落地目标是：

1. 在 `llm` 抽象层中新增 `minimax` provider。
2. 保持默认语义不变：未显式配置时仍走 `mock`。
3. 保持现有 `openai` provider 与其测试不退化。
4. 让 `minimax` 能复用现有受控角色输出与 Developer patch proposal 链路。
5. 保持当前失败语义、日志语义、timeout / retry 语义一致。

## 2. 已批准 Spec 摘要

已确认边界：

- 用户选择的是**新增 MiniMax provider**，不是替换 OpenAI。
- 推荐方案为：**独立 `minimax` provider 适配器**。
- 默认 `mock` 保持不变。
- `minimax` 也必须遵守现有协议校验、失败可见、Developer 受控写入边界。
- 本次仍然属于第二阶段中后段的 provider 扩展，不进入第三阶段。

## 3. 架构摘要

本次扩展遵循“最小 provider 增量”原则：

### 3.1 类型层

- 扩展 `LlmProviderName`
- 新增 `MiniMaxLlmConfig`
- 更新 `LlmProviderConfig` 联合类型

### 3.2 Provider 工厂层

- 在 `createLlmProvider()` 中支持 `minimax`
- 增加环境变量读取与配置解析
- 保持 `runtime > env > default(mock)` 优先级

### 3.3 Provider 实现层

- 新增 `src/llm/minimax.ts`
- 语义尽量与现有 `openai.ts` 保持平齐：
  - timeout
  - retry
  - secret redaction
  - 可见错误

### 3.4 角色复用层

- PM / Architect / QA：直接复用现有结构化角色输出链路
- Developer：直接复用现有 patch proposal + 校验 + 受控写入链路

## 4. 批次与步骤

### Batch 1：MiniMax provider 类型与工厂接入

目标：先把 `minimax` provider 纳入类型系统与 provider factory。

优先文件：

- `src/llm/types.ts`
- `src/llm/index.ts`
- 新增 `src/llm/minimax.ts`
- `tests/llm-provider.test.ts`

执行内容：

- 新增 `LlmProviderName = 'mock' | 'openai' | 'minimax'`
- 新增 `MiniMaxLlmConfig`
- 更新 `LlmProviderConfig` 联合
- 更新 provider 工厂支持 `minimax`
- 增加环境变量读取：
  - `MINIMAX_API_KEY`
  - 可选 `MINIMAX_BASE_URL`
- 保持 `DEVTEAM_LLM_PROVIDER` / `DEVTEAM_LLM_MODEL` 的现有语义

通过标准：

- `provider=minimax` 可被正确解析
- 未配置时默认仍为 `mock`
- 未知 provider 继续报配置错误

### Batch 2：MiniMax provider HTTP 实现与失败语义

目标：让 `minimax` provider 拥有与 `openai` 等级相当的受控请求语义。

优先文件：

- 新增 `src/llm/minimax.ts`
- `tests/llm-provider.test.ts`

执行内容：

- 实现 MiniMax provider 请求逻辑
- 支持：
  - apiKey 校验
  - model 校验
  - timeout
  - 仅瞬时网络错误有限重试
  - secret redaction
  - 结构错误与配置错误不重试
- 保持显式 `minimax` 失败时不静默 fallback

通过标准：

- 缺 key / model 报配置错误
- malformed 响应报 schema 错误
- 瞬时网络错误可有限重试
- 失败日志不泄露 secret

### Batch 3：角色链路复用验证

目标：证明 `minimax` 可以接入现有角色协议链路，而不需要另起一套实现。

优先文件：

- `tests/agents-protocol.test.ts`
- 必要时：`src/agents/llm-adapter.ts`

执行内容：

- 为 PM / Architect / QA 增加 `provider=minimax` 正向路径测试
- 为 Developer 增加 `provider=minimax` 的 patch proposal 正向路径测试
- 仅在必要时做最小 adapter 调整，避免改动角色语义

通过标准：

- MiniMax 路径下 PM / Architect / QA 结构化输出可通过协议校验
- MiniMax 路径下 Developer proposal 可通过现有 proposal 校验

### Batch 4：文档与启用说明

目标：把支持范围与启用方式同步到文档。

优先文件：

- `README.md`
- `docs/development-roadmap.md`
- 新增 `docs/dtt/reports/2026-04-18-phase-2-minimax-provider-extension-summary.md`

执行内容：

- 更新 README：说明当前真实 provider 支持范围扩展为 OpenAI + MiniMax
- 更新路线图：说明这是第二阶段中后段 provider 扩展，不代表进入第三阶段
- 新增阶段报告：
  - 新增了什么
  - 如何启用 MiniMax
  - 与 OpenAI / mock 的关系
  - 当前边界仍未变化

通过标准：

- 文档与代码口径一致
- 不夸大能力，不误导阶段进度

## 5. 验证检查点

### 检查点 A：Provider 工厂

- `tests/llm-provider.test.ts`
- provider 解析
- env 读取
- 配置错误验证

### 检查点 B：MiniMax 失败语义

- timeout
- retry
- malformed 输出
- secret redaction

### 检查点 C：角色链路复用

- `tests/agents-protocol.test.ts`
- PM / Architect / QA / Developer 的 `provider=minimax` 测试

### 最终 fresh verification

- `npm run typecheck`
- `npm test`
- `npm run build`

## 6. 风险与控制

### 风险 1：为了 MiniMax 扩展而重构整套 provider

控制：

- 不做通用 provider 大重构
- 只做独立 `minimax` 适配器

### 风险 2：MiniMax 与 OpenAI 语义不一致导致协议层分叉

控制：

- 尽量只在 provider 层处理差异
- 角色协议、proposal 校验与 workflow 链路全部复用既有实现

### 风险 3：文档表述超前于代码实现

控制：

- 只有在测试与 fresh verification 全绿后才更新最终状态说明

## 7. 预计输出

- `src/llm/minimax.ts`
- 扩展后的 `src/llm/types.ts` / `src/llm/index.ts`
- MiniMax provider 测试
- MiniMax 角色链路测试
- README / 路线图 / 阶段报告更新

## 8. 执行顺序

1. Batch 1：类型与 provider 工厂接入
2. Batch 2：MiniMax provider 实现与失败语义
3. Batch 3：角色链路复用验证
4. Batch 4：文档同步
5. reviewer + fresh verification
