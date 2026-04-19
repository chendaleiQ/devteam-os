# MiniMax 真实 Provider 最小流程跑通 Plan

## 1. 目标

基于已批准 spec：`docs/dtt/specs/2026-04-18-minimax-simple-real-flow-spec.md`，把当前 MiniMax 真实 provider 的最小简单流程跑通。

本次 plan 完成后，应达到：

1. `npm run dev -- start "请实现一个本地 JSON 落盘与恢复的 TypeScript 原型"` 在真实 MiniMax provider 下不再因默认超时或 `artifactContent` 类型不匹配而失败。
2. `interactive` 的首轮真实 MiniMax 流程至少可以成功进入结果输出。
3. 现有 provider / agent / CLI 测试继续通过。

## 2. 已批准 Spec 摘要

已确认的根因与边界：

- 问题不是没走到真实 provider，而是 **MiniMax 已生效后失败**。
- 已定位两类主要问题：
  1. MiniMax 默认 `timeoutMs=10_000` 偏紧，真实请求会 `aborted`
  2. MiniMax 输出中的 `artifactContent` 可能是对象，而当前 adapter 只接受字符串
- 推荐方案：
  - 仅在 MiniMax provider 内部调整更合理的默认超时
  - 在 `llm-adapter` 中对 `artifactContent` 做受控兼容

## 3. 架构与执行摘要

这次工作只修“最短失败路径”，不重构 provider 架构。

执行原则：

- **provider 层**：只修 MiniMax 默认超时与现有失败稳定性
- **adapter 层**：只修 `artifactContent` 的最小受控兼容
- **CLI 层**：只做最小真实流程验证，不新增交互能力

## 4. 批次与步骤

### Batch 1：MiniMax 超时策略修正

目标：先让真实 MiniMax 请求不那么容易在默认配置下直接 abort。

优先文件：

- `src/llm/minimax.ts`
- `tests/llm-provider.test.ts`

执行内容：

- 调整 MiniMax 的默认 `timeoutMs` 到更合理的值（例如 30s）
- 保持 timeout 仍然可配置
- 不改 OpenAI provider 超时
- 补 MiniMax 默认超时/超时失败相关测试（必要时更新现有测试预期）

通过标准：

- MiniMax 默认超时不再过紧
- timeout 仍然能以可见错误返回

### Batch 2：`artifactContent` 的受控兼容修正

目标：解决当前最直接的 `Agent LLM output missing valid artifactContent` 错误。

优先文件：

- `src/agents/llm-adapter.ts`
- `tests/agents-protocol.test.ts`

执行内容：

- 对 `artifactContent` 做最小兼容：
  - 非空字符串：直接接受
  - 对象/数组：转换为稳定 JSON 字符串
  - 其他类型：继续视为无效
- 保持其他字段校验严格
- 补对应正/负路径测试

通过标准：

- MiniMax 返回对象型 `artifactContent` 时可通过 role adapter
- 空字符串/布尔值等非法类型仍然报 schema 错误

### Batch 3：最小真实流程验证

目标：证明修复不是只停留在单元层，而是真的能跑通最小真实流程。

优先文件：

- `tests/cli.test.ts`
- 如确有必要再小改：`src/cli.ts`

执行内容：

- 增加一个最小真实 provider CLI 测试策略，或至少通过可控脚本验证：
  - `start` 路径在 MiniMax 真实 provider 下可以完成首轮结果输出
- 如测试中不适合直连真实网络，则保留代码不变，只把该验证作为 fresh manual check 证据

通过标准：

- 至少一条最小真实 MiniMax 流程能跑通
- `interactive` 首轮不再直接因这两个问题失败

### Batch 4：必要文档微调

目标：只在必要时补充说明，不扩大文档范围。

优先文件：

- `README.md`（仅在需要说明 MiniMax 简单流程已跑通时）

执行内容：

- 如果实现边界未变化，尽量不改文档
- 如果必须说明 MiniMax 简单流程已稳定，则做最小更新

通过标准：

- 文档与代码一致，但不夸大为所有复杂流程都已稳定

## 5. 验证检查点

### 检查点 A：Provider 稳定性

- `tests/llm-provider.test.ts`
- MiniMax timeout / abort / retry / error visibility

### 检查点 B：Adapter 兼容性

- `tests/agents-protocol.test.ts`
- `artifactContent` 字符串 / 对象 / 非法类型

### 检查点 C：最小真实流程

- `npm run dev -- start "请实现一个本地 JSON 落盘与恢复的 TypeScript 原型"`
- 必要时再验证 `interactive` 首轮

### 最终 fresh verification

- `npm run typecheck`
- `npm test`
- `npm run build`

## 6. 风险与控制

### 风险 1：把 schema 放宽过头

控制：

- 只兼容 `artifactContent`
- 只接受字符串或可稳定序列化的对象/数组
- 其他非法类型继续报错

### 风险 2：把 MiniMax 默认超时调得过大，掩盖真实网络问题

控制：

- 只做“足以跑通最小真实流程”的适度放宽
- timeout 仍然必须可见失败

### 风险 3：用户误以为所有复杂流程都已完全稳定

控制：

- 本次只承诺“最小简单流程跑通”
- 不夸大为所有长链路都已完全稳定

## 7. 预计输出

- 调整后的 `src/llm/minimax.ts`
- 调整后的 `src/agents/llm-adapter.ts`
- 对应 MiniMax provider / adapter 测试
- 最小真实流程验证证据

## 8. 执行顺序

1. Batch 1：MiniMax 默认超时修正
2. Batch 2：`artifactContent` 受控兼容
3. Batch 3：最小真实流程验证
4. Batch 4：必要文档微调
5. reviewer + fresh verification
