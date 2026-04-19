# 第二阶段 MiniMax 官方 Quickstart 对齐 Spec

## 1. 背景

当前仓库已经新增了 `minimax` provider，但实现方式与 MiniMax 官方 Token Plan Quickstart 不一致。

用户提供的官方文档说明当前推荐接入方式为：

- 使用 **Anthropic API 兼容入口**
- `ANTHROPIC_BASE_URL=https://api.minimaxi.com/anthropic`
- `ANTHROPIC_API_KEY=<YOUR_API_KEY>`
- 模型示例：`MiniMax-M2.7`

而当前仓库中的 MiniMax provider 仍采用自定义 HTTP 方式：

- `MINIMAX_API_KEY`
- `MINIMAX_BASE_URL`
- `https://api.minimax.chat/v1/text/chatcompletion_v2`
- 自定义 `reply` 字段解析

这会带来两个问题：

1. 当前实现与官方文档不一致，后续维护成本高。
2. 文档、配置与真实接入方式存在偏差，不利于用户直接启用。

用户已明确确认：

> 本次应采用 **A：严格按官方 Quickstart 对齐**。

这意味着：

- MiniMax 接入应改为官方推荐方式。
- 旧的 `MINIMAX_API_KEY` / `MINIMAX_BASE_URL` 不保留为正式兼容方案。

## 2. 本次目标

本次希望实现的是：

1. 将当前 `minimax` provider 重构为**基于 Anthropic-compatible API** 的官方对齐实现。
2. 使用官方环境变量语义：
   - `ANTHROPIC_BASE_URL`
   - `ANTHROPIC_API_KEY`
3. 让现有 `provider=minimax` 继续存在，但其底层接入方式改为官方兼容协议。
4. 保持现有受控角色协议、Developer `patch proposal`、受控写入链路不变。
5. 移除当前自定义 MiniMax HTTP 接口在文档和正式配置中的主路径地位。

## 3. 用户已确认的关键决定

### 3.1 对齐策略

用户已选择：**严格按官方 Quickstart 对齐**。

因此本次不采用“官方优先 + 保留旧别名兼容”方案。

### 3.2 不保留旧配置为正式入口

这意味着：

- `MINIMAX_API_KEY` 不再作为正式支持的主配置变量
- `MINIMAX_BASE_URL` 不再作为正式支持的主配置变量
- README、路线图与阶段报告都应以官方 Anthropic-compatible 口径为准

## 4. 方案比较

### 方案 A：MiniMax provider 内部改为 Anthropic-compatible fetch 实现【推荐】

做法：

- 保留 `provider='minimax'` 这一抽象名字
- 但 provider 内部按照 Anthropic-compatible 协议请求
- 使用官方环境变量：
  - `ANTHROPIC_BASE_URL`
  - `ANTHROPIC_API_KEY`

优点：

- 与当前项目的 provider 抽象保持一致
- 对上层角色链路影响最小
- 既能保留 `minimax` provider 语义，又能与官方文档对齐

缺点：

- 需要重新定义当前 MiniMax HTTP 请求/响应解析方式

### 方案 B：删除 `minimax` provider，直接引入 `anthropic` provider

做法：

- 不再保留 `provider='minimax'`
- 改成 `provider='anthropic'`

优点：

- 更贴近兼容协议名

缺点：

- 会扩大本次范围
- 会冲击当前已完成的 MiniMax provider 抽象、测试与文档
- 会把“接入方式调整”扩大成“provider 语义迁移”

### 方案 C：保留当前自定义 HTTP 接口，只改文档

优点：

- 改动最小

缺点：

- 与用户目标冲突
- 仍不符合官方 Quickstart
- 文档和实现依旧脱节

## 5. 推荐方案

采用 **方案 A**。

也就是：

- 保留 `provider='minimax'` 作为产品语义
- 但其底层实现严格改为官方 Anthropic-compatible 接入
- 上层角色协议与 workflow 行为保持不变

## 6. 范围

### 6.1 包含范围

- 重写 `src/llm/minimax.ts` 的请求/响应协议，使其对齐官方 Quickstart
- 调整 MiniMax 配置解析逻辑，改用：
  - `ANTHROPIC_BASE_URL`
  - `ANTHROPIC_API_KEY`
- 更新 MiniMax provider 测试
- 更新 MiniMax 在 PM / Architect / QA / Developer 路径上的测试夹具
- 更新 README、路线图、阶段报告中的启用说明

### 6.2 不包含范围

- 不重写整个 provider 抽象
- 不把 `provider='minimax'` 改成 `provider='anthropic'`
- 不改 OpenAI provider
- 不改默认 `mock` 路径
- 不改变 Developer 的受控 proposal / 受控写入边界
- 不引入第三阶段工作台或第四阶段平台化能力

## 7. 设计原则

### 7.1 上层语义不变，下层协议对齐官方

- `provider='minimax'` 继续保留
- 上层 role adapter / workflow / patch proposal 链路继续复用当前逻辑
- 只替换 MiniMax provider 的底层 HTTP 协议与配置语义

### 7.2 严格使用官方环境变量

MiniMax 的正式启用方式改为：

- `DEVTEAM_LLM_PROVIDER=minimax`
- `DEVTEAM_LLM_MODEL=MiniMax-M2.7`（或其他官方可用模型）
- `ANTHROPIC_BASE_URL=https://api.minimaxi.com/anthropic`
- `ANTHROPIC_API_KEY=<YOUR_API_KEY>`

### 7.3 不静默 fallback

一旦显式启用 `provider=minimax`：

- 配置错误要可见失败
- 上游失败要可见失败
- 结构错误要可见失败
- 不允许静默回退到 `mock`

### 7.4 继续服从现有安全边界

- MiniMax 仍不能直接决定 workflow 状态
- 仍不能直接执行命令
- Developer 仍只能输出结构化 `patch proposal`
- 文件写入仍须经过现有校验与受控写入流程

## 8. 配置语义

### 8.1 正式支持的 MiniMax 启用方式

- `DEVTEAM_LLM_PROVIDER=minimax`
- `DEVTEAM_LLM_MODEL=<MiniMax 模型名>`
- `ANTHROPIC_BASE_URL=https://api.minimaxi.com/anthropic`
- `ANTHROPIC_API_KEY=<Token Plan API Key>`

### 8.2 配置优先级

保持当前全局规则：

1. 显式运行时配置
2. 环境变量
3. 默认值（`mock`）

### 8.3 非法配置处理

- `provider=minimax` 但缺 `ANTHROPIC_API_KEY`：报配置错误
- `provider=minimax` 但缺 model：报配置错误
- `provider=minimax` 但 base URL 未配置时：若使用官方默认值，则可回落到官方默认 Anthropic endpoint；否则应明确失败

## 9. 运行语义

### 9.1 请求语义

MiniMax provider 应改为 Anthropic-compatible 请求语义，包括但不限于：

- 兼容的 endpoint 路径
- 兼容的 headers 结构
- 与官方 quickstart 一致的消息体组织方式

### 9.2 响应语义

MiniMax provider 不再依赖自定义 `reply` 字段。

它应解析 Anthropic-compatible 响应结构，并提取最终文本内容。

### 9.3 角色链路

PM / Architect / QA / Developer 不应感知底层协议变化。

也就是说：

- 角色仍拿到统一的 `AgentRunOutput`
- Developer 仍走统一的 `patch proposal` 校验器

## 10. 验收标准

完成后至少应满足：

1. `provider=minimax` 时，MiniMax provider 按官方 Anthropic-compatible 语义发请求。
2. MiniMax 配置使用官方环境变量语义。
3. 旧 `MINIMAX_API_KEY` / `MINIMAX_BASE_URL` 不再作为正式启用方式出现在文档与主流程测试中。
4. PM / Architect / QA 的 MiniMax 路径继续通过现有结构化角色输出校验。
5. Developer 的 MiniMax 路径继续通过 `patch proposal` 校验与受控写入链路。
6. 配置错误 / 上游失败 / 结构错误依旧可见，不静默 fallback。
7. `npm run typecheck`、`npm test`、`npm run build` 通过。

## 11. 负路径验收

除正向能力外，还必须覆盖：

1. `provider=minimax` 但缺 `ANTHROPIC_API_KEY`。
2. `provider=minimax` 但响应结构不符合 Anthropic-compatible 预期。
3. `provider=minimax` 上游 429/5xx 的重试边界。
4. `provider=minimax` 显式失败时不静默 fallback 到 `mock`。

## 12. 风险与控制

### 风险 1：把官方对齐做成通用 provider 大重构

控制：

- 只改 `minimax` provider 内部实现
- 不扩展成全局 `anthropic` provider 迁移

### 风险 2：官方响应结构理解偏差导致解析错误

控制：

- 先用测试钉住最小 Anthropic-compatible 响应结构
- 保持 schema error 可见

### 风险 3：文档继续保留旧变量，造成用户混淆

控制：

- README / 路线图 / 阶段报告统一改成官方配置口径

## 13. 对当前路线图的影响

本次仍然属于**第二阶段中后段：受控真实模型接入 / provider 扩展**。

它只是把 MiniMax provider 从“当前自定义实现”调整为“官方 Quickstart 对齐实现”，不改变阶段顺序，也不引入新的高风险能力。
