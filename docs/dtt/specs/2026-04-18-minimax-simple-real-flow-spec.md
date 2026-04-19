# MiniMax 真实 Provider 最小流程跑通 Spec

## 1. 背景

用户当前目标不是继续扩展能力边界，而是：

> **先把真实 provider 的简单流程跑通。**

用户随后明确要求优先处理：

> **A. MiniMax**

也就是说，本次工作的目标是：

- 让 MiniMax 作为真实 provider 时，至少能稳定跑通最小 CLI 流程
- 优先保证 `start` / `interactive` 的简单任务可以成功进入真实角色链路并返回结果
- 暂不追求完整的复杂长链路体验优化

## 2. 当前已定位的根因

经过实际复现与边界检查，当前问题已经有较明确的根因证据：

### 2.1 真实 MiniMax 路径确实已生效

当前 `.env` 中的安全信息表明：

- `DEVTEAM_LLM_PROVIDER=minimax`
- `DEVTEAM_LLM_MODEL=MiniMax-M2.7`
- `ANTHROPIC_BASE_URL=https://api.minimaxi.com/anthropic`
- `ANTHROPIC_API_KEY` 已存在

说明问题不是“没走到真实 provider”，而是**走到了真实 provider 之后失败**。

### 2.2 当前最小 CLI 流程会因 schema 不匹配失败

实际复现：

- 执行 `npm run dev -- start "请实现一个本地 JSON 落盘与恢复的 TypeScript 原型"`
- 当前报错为：
  - `Agent LLM output missing valid artifactContent`

进一步抓取 MiniMax 返回可以看到：

- 当前 MiniMax 的角色输出 JSON 中，`artifactContent` 可能返回为**对象结构**
- 而 `src/agents/llm-adapter.ts` 当前要求 `artifactContent` 必须是**非空字符串**

这意味着：

> MiniMax 返回的结构虽然语义上有内容，但被当前严格 schema 判定为不合法。

### 2.3 当前默认超时对 MiniMax 真实请求偏紧

当前 `src/llm/minimax.ts` 的默认超时为：

- `10_000ms`

实际调用中，默认超时下会出现：

- `This operation was aborted`

在把超时放宽到 30s 的直接 provider 调试调用中，可以拿到有效响应。

这说明：

> 对 MiniMax 来说，当前默认 10s 超时偏紧，足以导致真实简单流程偶发或稳定失败。

## 3. 本次目标

本次希望实现的是：

1. 让 MiniMax 真实 provider 能稳定跑通最小简单流程。
2. 至少保证以下路径能成功：
   - `npm run dev -- start "..."`
   - `npm run dev -- interactive "..."` 的首轮与简单继续流程
3. 不改变现有 provider 边界与第二阶段定位。

## 4. 方案比较

### 方案 A：只调大超时

优点：

- 改动小

缺点：

- 不能解决 `artifactContent` 类型不匹配问题
- 即使不超时，仍会因 schema 校验失败而报错

### 方案 B：只放宽 `artifactContent` 校验

优点：

- 能直接解决当前 `missing valid artifactContent` 问题

缺点：

- 不能解决默认 10s 超时导致的 `aborted`

### 方案 C：同时修正 MiniMax 超时与 `artifactContent` 兼容【推荐】

做法：

- 为 MiniMax 真实 provider 提高更合理的默认超时，或为其提供更适配的默认值
- 在 role adapter 层对 `artifactContent` 做受控兼容：允许字符串，必要时也接受对象并转换为字符串内容

优点：

- 同时覆盖已发现的两类主要失败原因
- 能最快达成“先跑通真实 provider 最小流程”的目标

缺点：

- 需要同时修改 provider 层和 adapter 层测试

## 5. 推荐方案

采用 **方案 C**。

也就是：

1. 调整 MiniMax 的默认超时策略，使真实 provider 简单流程不容易在 10s 内被提前 abort。
2. 在 `src/agents/llm-adapter.ts` 中对 `artifactContent` 做最小兼容：
   - 字符串继续按现有方式处理
   - 若为对象，则转换为稳定字符串内容后再落入 artifact

## 6. 范围

### 6.1 包含范围

- `src/llm/minimax.ts` 的默认超时/最小稳定性调整
- `src/agents/llm-adapter.ts` 对 `artifactContent` 的兼容修正
- 对应 MiniMax provider 测试
- 对应 agent protocol / CLI 最小真实流程测试或夹具修正

### 6.2 不包含范围

- 不重做整个 provider 抽象
- 不修改 OpenAI provider 语义
- 不扩展新的交互能力
- 不把这次问题扩大成第三阶段产品化工作
- 不引入新的 workflow 状态

## 7. 设计原则

### 7.1 只修“跑不通”的最短路径

本次优先解决：

- 真实 MiniMax 能返回
- 返回后能通过最小 schema 校验
- CLI 最小流程能完成

而不是一次性追求所有 provider 体验一致性优化。

### 7.2 兼容放宽必须受控

`artifactContent` 的兼容不能演变成“任意结构都接受”。

建议限定为：

- 字符串：直接接受
- 纯对象/数组：转换为稳定 JSON 字符串
- 其他类型：仍然视为不合法

### 7.3 超时调整只限 MiniMax

当前证据表明 MiniMax 的默认 10s 偏紧；如果调整默认超时，应优先限定在 MiniMax provider 内部，而不是全局扩大所有 provider 超时。

## 8. 验收标准

完成后至少应满足：

1. `npm run dev -- start "请实现一个本地 JSON 落盘与恢复的 TypeScript 原型"` 在真实 MiniMax provider 下可成功返回，而不是报 `artifactContent` schema 错误或超时中断。
2. `interactive` 的首轮真实 MiniMax 流程可成功进入结果输出，而不是直接 `aborted`。
3. provider / adapter / CLI 测试全部通过。
4. `npm run typecheck`、`npm test`、`npm run build` 通过。

## 9. 负路径验收

除正向能力外，还应覆盖：

1. `artifactContent` 为空字符串时仍报错。
2. `artifactContent` 为不支持类型（如布尔值）时仍报错。
3. MiniMax 显式超时仍以可见错误返回，而不是静默 fallback。

## 10. 风险与控制

### 风险 1：把 schema 放宽成任意 JSON 都吞掉

控制：

- 只对 `artifactContent` 做受控兼容
- 其他字段校验继续保持严格

### 风险 2：为跑通 MiniMax 而无边界调大全局超时

控制：

- 只在 MiniMax provider 内部调整默认超时
- 保持其他 provider 现有行为不变

### 风险 3：用户以为所有复杂流程都已经稳定

控制：

- 本次只承诺“真实 provider 最小简单流程可跑通”
- 不夸大为所有复杂链路体验都已稳定

## 11. 对当前阶段的影响

本次工作仍然属于第二阶段收尾中的**稳定性修复**。

它不会改变路线图阶段顺序，也不意味着第三阶段开始；只是把当前已经接入的真实 provider 从“理论可用”推进到“最小流程实际可跑通”。
