# 项目 `.env` 加载支持 Spec

## 1. 背景

当前项目已经支持通过环境变量启用 LLM provider（例如 OpenAI、MiniMax），但前提是这些变量必须已经存在于运行进程的 `process.env` 中。

用户明确提出：

> 这些配置应该能够直接写进项目的 `.env` 文件中使用。

目前仓库还没有：

- `.env` 自动加载能力
- `.env.example` 示例文件
- `.env` 的明确忽略规则

这会导致两个问题：

1. 用户把配置写进 `.env` 后，不一定会自动生效。
2. 项目缺少一份清晰的示例文件，使用门槛偏高。

用户已确认采用方案：**A. 引入 `dotenv`**。

## 2. 本次目标

本次希望实现的是：

1. 为项目增加 `.env` 自动加载支持。
2. 提供 `.env.example`，让用户知道应如何填写配置。
3. 把 `.env` 加入忽略规则，避免真实 key 被误提交。
4. 保持现有 provider 配置语义不变，只补齐“从项目 `.env` 读取”的能力。

## 3. 方案比较

### 方案 A：只在 CLI 入口加载 `.env`

做法：

- 在 `src/cli.ts` 中引入 `dotenv`
- 启动 CLI 时加载当前项目目录下的 `.env`

优点：

- 改动小
- 对现有测试影响最小

缺点：

- 直接调用 `runLeaderTask()` / `runAgent()` 的代码路径不会自动读取 `.env`
- 行为会变成“CLI 有效、API 不一定有效”

### 方案 B：共享 `loadProjectEnv()` 帮助函数，在 CLI 和显式 workspace 入口复用【推荐】

做法：

- 新增统一的 `.env` 加载帮助函数
- CLI 默认调用它
- 当 `workspaceRoot` / `cwd` 明确提供时，leader 入口也可复用它
- 若没有明确工作目录，则继续要求调用方自行提供环境变量

优点：

- 比 CLI-only 更一致
- 不会把 `.env` 自动加载扩散成无边界的全局副作用
- 能兼顾 CLI 与显式 workspace 的程序化入口

缺点：

- 比单纯在 CLI 里引入 `dotenv` 稍复杂一点

### 方案 C：只新增 `.env.example`，不做自动加载

优点：

- 风险最小

缺点：

- 不能满足“配置到项目 `.env` 文件中即可使用”的用户目标

## 4. 推荐方案

采用 **方案 B**。

也就是：

- 引入 `dotenv`
- 新增共享 `loadProjectEnv()` 帮助函数
- CLI 默认加载 `.env`
- Leader 入口在 `workspaceRoot` 明确时也可加载 `.env`
- 无明确工作目录时，继续要求调用方自行准备环境变量

## 5. 范围

### 5.1 包含范围

- 新增 `dotenv` 依赖
- 新增共享 `.env` 加载帮助函数
- 在 CLI 入口接入 `.env` 加载
- 在 leader 显式 workspace 入口接入 `.env` 加载
- 新增 `.env.example`
- 更新 `.gitignore`
- 更新 README 中的配置说明

### 5.2 不包含范围

- 不改现有 OpenAI / MiniMax / mock provider 语义
- 不改 workflow 规则
- 不改审批、阻塞、测试流转逻辑
- 不引入 `.env.local` / `.env.production` / 多环境矩阵
- 不做 secrets 管理系统集成

## 6. 设计原则

### 6.1 `.env` 只是配置来源补充，不改变业务语义

`.env` 加载只是把内容放进 `process.env`。

现有配置解析规则（例如 provider、model、API key 的含义）保持不变。

### 6.2 明确工作目录时才自动加载项目 `.env`

为避免无边界副作用：

- CLI 使用 `cwd`
- Leader 使用显式 `workspaceRoot`

来决定读取哪个项目目录下的 `.env`。

### 6.3 不覆盖显式传入的环境变量

默认采用 `dotenv` 的非覆盖模式：

- shell 已设置的环境变量优先
- `.env` 只补齐缺失项

### 6.4 `.env.example` 只放占位值，不放真实 secret

示例文件应包含：

- OpenAI 路径示例
- MiniMax 路径示例
- 说明哪些变量是二选一/按 provider 使用

## 7. 建议实现方式

### 7.1 新增共享帮助函数

建议新增类似：

- `src/env.ts`

职责：

- 基于指定目录查找 `.env`
- 调用 `dotenv.config({ path, override: false })`
- 做幂等保护，避免同一路径重复加载

### 7.2 CLI 接入

在 `runCli()` 入口尽早调用 `.env` 加载。

目录来源：

- `deps.cwd ?? process.cwd()`

### 7.3 Leader 接入

在 `runLeaderTask()` / `resumeLeaderTask()` / `approveLeaderTask()` / `resolveBlockedTask()` 的显式 workspace 场景下，可调用同一帮助函数。

规则：

- 若 `workspaceRoot` 存在，则以它为目标目录加载 `.env`
- 若 `workspaceRoot` 不存在，则不隐式猜测更多目录，继续依赖调用方现有环境变量

## 8. `.env.example` 内容要求

至少应包含：

```env
# OpenAI
DEVTEAM_LLM_PROVIDER=openai
DEVTEAM_LLM_MODEL=gpt-4o-mini
OPENAI_API_KEY=your_openai_key

# MiniMax（官方 Quickstart 口径）
# DEVTEAM_LLM_PROVIDER=minimax
# DEVTEAM_LLM_MODEL=MiniMax-M2.7
# ANTHROPIC_BASE_URL=https://api.minimaxi.com/anthropic
# ANTHROPIC_API_KEY=your_minimax_token_plan_key
```

并说明：

- 同一时间通常只启用一个 provider
- 不要把真实 key 提交到仓库

## 9. 验收标准

完成后至少应满足：

1. 项目安装依赖后，可通过 `.env` 文件启用 provider 配置。
2. CLI 在无显式 shell export 的情况下，能读取项目 `.env`。
3. 当 `workspaceRoot` 明确时，leader 入口也能读取对应目录下 `.env`。
4. `.env.example` 提供可直接参考的配置模板。
5. `.env` 被加入忽略规则。
6. `npm run typecheck`、`npm test`、`npm run build` 通过。

## 10. 负路径验收

除正向能力外，还必须覆盖：

1. `.env` 不存在时，程序仍可按当前行为运行。
2. shell 中已存在的环境变量不应被 `.env` 覆盖。
3. 不同 workspaceRoot 不应错误复用别的项目 `.env`。

## 11. 风险与控制

### 风险 1：测试环境意外读到本地真实 `.env`

控制：

- 使用显式目录加载
- 为测试使用临时目录或 stub env
- 不做无边界全局自动加载

### 风险 2：`.env` 加载影响现有程序化调用行为

控制：

- 无 `workspaceRoot` 时不额外猜测目录
- 保持“调用方已设置 env 时优先”的原则

### 风险 3：示例文件误导用户配置多个 provider

控制：

- `.env.example` 通过注释明确“按 provider 选择一组配置”

## 12. 对当前路线图的影响

本次工作仍属于**第二阶段中后段的配置与可用性完善**。

它不会改变当前 provider 能力边界，也不意味着进入第三阶段；只是让现有能力更容易以项目级 `.env` 的方式被使用。
