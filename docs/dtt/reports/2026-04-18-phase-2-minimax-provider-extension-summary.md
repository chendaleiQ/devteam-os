# 第二阶段 MiniMax provider 扩展阶段报告

## 结论

截至 2026-04-18，DevTeamOS 仍处于第二阶段中后段的 **provider 扩展**，当前真实 provider 支持范围已从 **OpenAI** 扩展到 **OpenAI + MiniMax**。这仍属于第二阶段内部的受控真实模型接入演进，**不代表进入第三阶段**；上层 PM / Architect / QA / Developer 的受控边界也没有变化。

## 新增了什么

- 在既有 provider 抽象下新增 MiniMax，并把启用口径统一到 MiniMax 官方 Quickstart。
- PM / Architect / QA 继续复用现有结构化角色输出链路；MiniMax 接入后不改变协议口径。
- Developer 继续复用现有结构化 `patch proposal` 链路；显式启用 MiniMax 时仍先产出 proposal，再经过系统校验与受控写入。
- 默认行为不变：未显式配置时仍走 `mock`。

## 如何启用 MiniMax（环境变量）

- 设置 `DEVTEAM_LLM_PROVIDER=minimax`
- 设置 `DEVTEAM_LLM_MODEL=MiniMax-M2.7`
- 设置 `ANTHROPIC_BASE_URL=https://api.minimaxi.com/anthropic`
- 设置 `ANTHROPIC_API_KEY=<key>`

说明：只有在显式配置 MiniMax 且必要参数齐备时，系统才会走 MiniMax；配置错误或上游失败会可见报错，**不会静默回退到 mock**。旧 `MINIMAX_API_KEY` / `MINIMAX_BASE_URL` 不再作为对外文档的主启用路径。

## 与 OpenAI / mock 的关系

- `mock` 仍是默认路径，也是当前最稳的兼容基线。
- OpenAI 与 MiniMax 现在都属于显式启用的真实 provider 选项。
- PM / Architect / QA 在 `mock` / `openai` / `minimax` 下都走同一套结构化角色输出协议。
- Developer 默认无 `llm` 配置时仍保留本地 `code_summary` 兼容路径；只有显式 `mock` / `openai` / `minimax` 时，才走结构化 `patch proposal` 链路。
- 上述变化是 provider 接入方式对齐，不是产品阶段前移，也不是角色权限放宽。

## 当前边界未变化

- 当前扩展的是 provider 覆盖范围，不是能力边界。
- PM / Architect / QA / Developer 的上层受控边界不变。
- 仍未开放 `delete` / `rename` / 直接自由写文件 / 直接执行命令 / workspace 外写入等高风险能力。
- 模型仍不能直接决定审批、阻塞或状态流转。

## Fresh verification 结果

- `npm run typecheck`：通过
- `npm test`：通过（10 个测试文件、94 个测试全部通过）
- `npm run build`：通过

## 当前阶段判断

现在的正确表述是：**第二阶段仍在进行中，且已从 OpenAI 扩展到 OpenAI + MiniMax 的受控 provider 接入；MiniMax 启用方式已统一到官方 Quickstart 口径；第三阶段尚未开始。**
