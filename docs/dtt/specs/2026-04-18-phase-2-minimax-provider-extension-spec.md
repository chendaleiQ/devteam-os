# 第二阶段 MiniMax Provider 扩展 Spec

## 1. 背景

当前 DevTeamOS 已完成第二阶段中后段的受控真实模型接入基础：

- 默认 `mock`
- 已支持显式 `openai`
- PM / Architect / QA 已可走受控模型输出
- Developer 已支持结构化 `patch proposal` + 校验 + 受控写入链路

用户当前要求不是替换现有 OpenAI，而是：

> **在保留现有 mock / OpenAI 的前提下，新增 MiniMax 作为另一个真实 provider。**

因此，本次工作本质上是对现有 `llm` provider 抽象的增量扩展，而不是重写当前 LLM 接入体系。

## 2. 本次目标

本次希望实现的是：

1. 在现有 provider 抽象上新增 `minimax` provider。
2. 保持默认语义不变：未显式配置时仍使用 `mock`。
3. 保持现有 `openai` 路径不退化。
4. 让 MiniMax 能复用现有受控角色输出链路：
   - PM / Architect / QA：结构化角色输出
   - Developer：结构化 `patch proposal`
5. 保持现有 timeout / retry / logging / 非静默失败语义一致。

## 3. 用户已确认的关键决定

### 3.1 Provider 策略

用户已选择：**A. 新增 MiniMax 作为另一个真实 provider**。

这意味着：

- 不删除 `openai`
- 不把现有 provider 语义改成“只支持 MiniMax”
- 不改变默认 `mock` 的稳定验证路径

## 4. 方案比较

### 方案 A：把 MiniMax 做成独立 provider 适配器【推荐】

做法：

- 在 `src/llm/` 下新增 `minimax.ts`
- 在类型系统中新增 `provider: 'minimax'`
- 配置、鉴权、错误语义由 MiniMax provider 自己负责

优点：

- provider 边界清晰
- 便于后续单独扩展 MiniMax 特有参数
- 不会把 OpenAI 与 MiniMax 的配置语义混在一起

缺点：

- 代码比 alias 方案多一点

### 方案 B：把 MiniMax 当作 OpenAI-compatible alias

做法：

- 不新增独立 provider 类型
- 只通过 `baseUrl` / `apiKey` 把 MiniMax 接到现有 `openai` provider

优点：

- 改动更少

缺点：

- provider 语义会变模糊
- 文档、日志、错误分类不清晰
- 后续如 MiniMax 与 OpenAI 参数不完全一致，容易积累隐性技术债

### 方案 C：做通用 HTTP chat provider

做法：

- 抽象一个更通用的 HTTP provider
- OpenAI / MiniMax 都只是配置差异

优点：

- 长期抽象更统一

缺点：

- 当前超出需求
- 容易把本次简单 provider 扩展做成一次性大重构

## 5. 推荐方案

采用 **方案 A：MiniMax 独立 provider 适配器**。

原因：

- 最符合当前“增量扩展 provider”的任务边界
- 能保持当前 OpenAI provider 的清晰边界
- 不会把 MiniMax 接入变成一次通用 provider 重构

## 6. 范围

### 6.1 包含范围

- 在 `llm` 类型中新增 `minimax` provider 名称与配置类型。
- 新增 `src/llm/minimax.ts`。
- 在 provider factory 中支持 `minimax`。
- 增加 MiniMax 所需配置读取与校验。
- 让 MiniMax 复用现有受控角色协议链路。
- 增加对应测试与文档说明。

### 6.2 不包含范围

- 删除 OpenAI 支持。
- 默认 provider 从 `mock` 改成 `minimax`。
- 新增多供应商自动路由。
- 引入新的 workflow 语义。
- 修改 Developer 的受控边界。
- 接入第三阶段工作台或第四阶段平台化能力。

## 7. 设计原则

### 7.1 不改变默认稳定路径

- 未显式配置时，默认仍使用 `mock`。
- 现有测试与本地稳定验证默认不依赖真实网络请求。

### 7.2 provider 语义显式可区分

- `mock`
- `openai`
- `minimax`

三者都应在代码、日志、错误与文档中可明确识别。

### 7.3 复用现有受控协议，不新增新一套角色契约

MiniMax 输出仍必须映射回现有受控角色协议：

- PM / Architect / QA：现有 `AgentRunOutput` 顶层字段
- Developer：现有 `AgentRunOutput` + `patch_proposal` artifact 路径

### 7.4 保持当前失败语义一致

- 默认未启用真实 provider 时，走 `mock`
- 一旦显式启用 `minimax`，若配置错误、上游失败或结构不合法，必须返回**可见失败**
- 不静默 fallback 到 `mock`

### 7.5 MiniMax 也必须遵守现有安全边界

- 不直接决定 workflow 状态
- 不直接执行命令
- 不绕过受控写入
- 不扩大 Developer 的高风险能力范围

## 8. 配置语义

建议配置：

- `DEVTEAM_LLM_PROVIDER=minimax`
- `DEVTEAM_LLM_MODEL=<minimax-model>`
- `MINIMAX_API_KEY=<key>`

如 MiniMax API 需要额外 base URL，可增加：

- `MINIMAX_BASE_URL`

配置优先级保持与现有 spec 一致：

1. 显式运行时配置
2. 环境变量
3. 默认值（`mock`）

非法配置处理：

- `provider=minimax` 但缺少 key / model：报配置错误
- provider 未知：报配置错误
- 配置错误不得静默回退到 `mock`

## 9. 运行语义

### 9.1 PM / Architect / QA

当显式 `provider=minimax` 时，三者应与 `openai` 路径一样：

- 请求模型输出结构化 JSON
- 校验字段合法性
- 由系统生成 artifact 元数据
- 不合法输出视为失败

### 9.2 Developer

当显式 `provider=minimax` 时，Developer 应与 `openai` / `mock` 的显式 provider 路径一致：

- 输出结构化 `patch proposal`
- proposal 必须通过现有校验器
- proposal 通过后才能进入受控写入

## 10. 验收标准

完成后至少应满足：

1. 不配置 MiniMax 时，现有默认行为不变。
2. `provider=minimax` 时，provider factory 可正确解析并创建 MiniMax provider。
3. `provider=minimax` 缺少 key / model 时，报配置错误。
4. PM / Architect / QA 可通过 MiniMax 生成结构化角色输出。
5. Developer 可通过 MiniMax 生成结构化 `patch proposal`，并通过现有校验。
6. MiniMax 上游失败或输出不合法时，可见失败，不静默 fallback。
7. `npm run typecheck`、`npm test`、`npm run build` 通过。

## 11. 负路径验收

除正向能力外，还必须覆盖：

1. `provider=minimax` 但缺 key / model 的配置错误。
2. MiniMax 返回 malformed JSON 时，结构校验失败。
3. Developer 的 MiniMax proposal 非法时，不进入受控写入。
4. 显式 `minimax` 失败时，不静默 fallback 到 `mock`。

## 12. 风险与控制

### 风险 1：把新增一个 provider 做成一次通用重构

控制：

- 只新增 `minimax` 独立适配器
- 不借机改写 `openai` / `mock` 总体架构

### 风险 2：MiniMax 路径与 OpenAI 路径行为不一致

控制：

- 复用同一套角色协议校验
- 复用同一套 Developer proposal 校验与受控写入链路

### 风险 3：文档夸大能力或误导阶段状态

控制：

- 文档只声明“新增 MiniMax provider 支持”
- 不宣称进入第三阶段
- 不宣称开放新的高风险能力

## 13. 对当前路线图的影响

本次工作仍然属于**第二阶段中后段：受控真实模型接入**。

它只是把“当前真实 provider 支持范围”从 **OpenAI** 扩展到 **OpenAI + MiniMax**，而不是改变阶段顺序或推进到第三阶段。
