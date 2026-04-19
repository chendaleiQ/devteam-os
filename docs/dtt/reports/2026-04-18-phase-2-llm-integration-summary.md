# 第二阶段受控真实模型接入阶段报告

## 结论

截至 2026-04-18，DevTeamOS 仍处于第二阶段，但已从 Batch 1“协作基础稳定化”推进到中后段的**受控真实模型接入**。这表示系统开始验证真实模型价值，但执行权仍由既有协议、校验、workflow 与验证链路掌控，并未进入第三阶段。

## 本次做了什么

- 建立 `llm` provider 抽象，默认走 deterministic `mock`。
- 增加显式真实 provider 路径；当前支持 OpenAI。
- PM / Architect / QA 已可在受控协议下生成结构化角色输出；默认 mock 与显式 OpenAI 共用同一协议链路。
- Developer 在默认无 `llm` 配置时仍保留本地 `code_summary` 兼容路径；但在显式 `mock` / 显式 `openai` 下都会生成结构化 `patch proposal`，并在系统校验通过后进入受控写入。

## 默认 mock / 显式 real 语义

- 默认不配时，provider 语义仍保持兼容：PM / Architect / QA 走受控 mock 角色输出链路，Developer 保留本地 `code_summary` 路径，不会发真实网络请求。
- 只有显式指定真实 provider（运行时参数或环境变量）且同时提供所需模型与密钥时，才启用真实模型。
- 当前代码支持的环境变量语义为：`DEVTEAM_LLM_PROVIDER=openai`、`DEVTEAM_LLM_MODEL=<model>`、`OPENAI_API_KEY=<key>`。
- 一旦显式启用真实 provider，若配置错误、上游失败或输出不合法，会返回可见错误；**不会静默回退到 mock**。

## 当前真实 provider 支持范围

- 当前真实 provider 支持范围为：**OpenAI**。
- 当前可走受控真实模型输出的角色为：**PM / Architect / QA / Developer**。
- 其中 PM / Architect / QA 复用既有 `AgentRunOutput` 顶层协议，且默认 mock 也走这条受控链路；Developer 在显式 `mock` / `openai` 时走 `patch_proposal` artifact 路径，默认无配置时保留兼容摘要路径。

## Developer patch proposal 与受控写入边界

- Developer 不是直接自由写代码，而是先输出 `devteam.patch-proposal.v1` 结构化 proposal。
- proposal 目前只允许文件级 `add` / `update`，且路径必须位于 workspace 内。
- 系统会校验格式、字段、路径、操作类型，以及 `add`/`update` 的存在性语义。
- 只有校验通过的 proposal 才会进入受控写入；写入后仍要继续经过系统验证与回流流程。

## 当前仍未开放的高风险能力

- `delete`
- `rename`
- 直接自由写文件
- 直接执行命令
- workspace 外路径写入
- 由模型直接决定审批、阻塞或状态流转

## Fresh verification 结果

- `npm run typecheck`：通过
- `npm test`：通过，10 个测试文件、77 个测试全部通过
- `npm run build`：通过

## 当前阶段判断

现在的正确表述是：**第二阶段仍在进行中，且已进入中后段的受控真实模型接入；第三阶段尚未开始。**
