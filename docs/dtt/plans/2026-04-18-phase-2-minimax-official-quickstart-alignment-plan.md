# 第二阶段 MiniMax 官方 Quickstart 对齐 Plan

## 1. 目标

基于已批准 spec：`docs/dtt/specs/2026-04-18-phase-2-minimax-official-quickstart-alignment-spec.md`，将当前 `minimax` provider 从自定义 HTTP 接口实现，调整为**严格对齐官方 Token Plan Quickstart 的 Anthropic-compatible 接入方式**。

本次 plan 完成后，应达到：

1. `provider='minimax'` 的底层请求协议改为官方 Anthropic-compatible 语义。
2. MiniMax 的正式配置口径改为：
   - `DEVTEAM_LLM_PROVIDER=minimax`
   - `DEVTEAM_LLM_MODEL=<model>`
   - `ANTHROPIC_BASE_URL=https://api.minimaxi.com/anthropic`
   - `ANTHROPIC_API_KEY=<key>`
3. PM / Architect / QA / Developer 的上层受控链路保持不变。
4. 旧 `MINIMAX_API_KEY` / `MINIMAX_BASE_URL` 不再作为正式主路径出现在测试与文档里。

## 2. 架构与执行摘要

本次不是新增 provider，也不是重做 provider 抽象，而是对已经存在的 `minimax` provider 做**底层协议对齐**。

执行原则：

- **上层不动**：`provider='minimax'`、角色协议、Developer proposal、受控写入链路都保持。
- **底层对齐**：把 MiniMax 的请求/响应、配置、测试夹具改成官方 Quickstart 口径。
- **不做通用迁移**：不把这次工作扩成全局 `anthropic` provider 改造。

## 3. 批次与步骤

### Batch 1：配置语义对齐

目标：先把 MiniMax 的正式配置语义改到官方口径。

优先文件：

- `src/llm/index.ts`
- `src/llm/types.ts`
- `tests/llm-provider.test.ts`

执行内容：

- 将 MiniMax provider 的 env 解析切换到：
  - `ANTHROPIC_API_KEY`
  - `ANTHROPIC_BASE_URL`
- 保持 `DEVTEAM_LLM_PROVIDER` / `DEVTEAM_LLM_MODEL` 继续作为全局 provider/model 选择入口。
- 明确 `provider=minimax` 缺 `ANTHROPIC_API_KEY` / model 的配置错误。
- 去掉主路径测试中对 `MINIMAX_API_KEY` / `MINIMAX_BASE_URL` 的依赖。

通过标准：

- `provider=minimax` 能通过官方变量正确解析。
- 缺 `ANTHROPIC_API_KEY` 或 model 时可见失败。
- 默认 `mock` 与现有 `openai` 不退化。

### Batch 2：MiniMax provider HTTP/响应协议对齐

目标：把 MiniMax provider 的请求/响应实现从自定义接口切到 Anthropic-compatible 协议。

优先文件：

- `src/llm/minimax.ts`
- `tests/llm-provider.test.ts`

执行内容：

- 将 endpoint 切换到基于 `ANTHROPIC_BASE_URL` 的 Anthropic-compatible 路径。
- 调整请求头、请求体和消息组织方式，对齐官方 quickstart 的最小兼容形式。
- 将响应解析从自定义 `reply` 改为 Anthropic-compatible 结构解析。
- 保留并重新验证：
  - timeout
  - retry
  - schema error
  - secret redaction
  - 显式失败不静默 fallback

通过标准：

- provider 单元测试覆盖官方口径下的请求/响应。
- malformed 响应继续报 `LlmSchemaError`。
- 429/5xx 继续保持瞬时重试边界。

### Batch 3：角色链路夹具与集成测试对齐

目标：让现有 PM / Architect / QA / Developer 的 MiniMax 测试夹具改成 Anthropic-compatible 返回格式，同时证明上层链路无需重写。

优先文件：

- `tests/agents-protocol.test.ts`
- 必要时：`src/agents/llm-adapter.ts`

执行内容：

- 把 MiniMax 相关 mock response 从当前自定义 `reply` 风格，改成新的 Anthropic-compatible 测试夹具。
- 确保：
  - PM / Architect / QA 仍能产出合法 `AgentRunOutput`
  - Developer 仍能产出合法 `patch_proposal`
- 只在必要时做最小 adapter 调整；优先让 provider 层兼容上层已有解析预期。

通过标准：

- MiniMax 在角色协议层继续与 OpenAI / mock 并列工作。
- Developer proposal 与受控写入路径不退化。

### Batch 4：文档同步

目标：把 MiniMax 的启用说明改成官方 Quickstart 口径。

优先文件：

- `README.md`
- `docs/development-roadmap.md`
- `docs/dtt/reports/2026-04-18-phase-2-minimax-provider-extension-summary.md`

执行内容：

- 把 README 中 MiniMax 启用方式改为官方环境变量语义。
- 把路线图中的 MiniMax 说明改成 Anthropic-compatible 口径。
- 更新阶段报告，明确：
  - MiniMax 已改为官方对齐实现
  - 正式变量为 `ANTHROPIC_*`
  - 仍属于第二阶段中后段 provider 扩展

通过标准：

- 文档与当前代码一致。
- 不再把旧 `MINIMAX_*` 当作正式主路径写给用户。

## 4. 验证检查点

### 检查点 A：配置语义

- `tests/llm-provider.test.ts`
- env 解析
- 缺 key/model 配置错误

### 检查点 B：协议对齐

- `tests/llm-provider.test.ts`
- Anthropic-compatible 请求/响应夹具
- malformed 响应
- timeout / retry / redaction

### 检查点 C：角色链路

- `tests/agents-protocol.test.ts`
- PM / Architect / QA / Developer 的 MiniMax 路径

### 最终 fresh verification

- `npm run typecheck`
- `npm test`
- `npm run build`

## 5. 风险与控制

### 风险 1：Anthropic-compatible 响应结构理解不准

控制：

- 先用测试钉住最小响应结构。
- provider 层负责解析差异，不把不确定性泄漏到 agent 层。

### 风险 2：把本次工作扩成全局 anthropic provider 重构

控制：

- 不新增 `provider='anthropic'`
- 不改 OpenAI provider
- 只调整 `minimax` provider 内部实现与其测试夹具

### 风险 3：文档和实现再次脱节

控制：

- 仅在 fresh verification 通过后同步更新 README / 路线图 / 阶段报告

## 6. 预计输出

- 对齐后的 `src/llm/minimax.ts`
- 更新后的 MiniMax provider 测试
- 更新后的 MiniMax agent 协议测试
- 官方口径的 README / 路线图 / 阶段报告

## 7. 执行顺序

1. Batch 1：配置语义对齐
2. Batch 2：HTTP/响应协议对齐
3. Batch 3：角色链路夹具与集成测试对齐
4. Batch 4：文档同步
5. reviewer + fresh verification
