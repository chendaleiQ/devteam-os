# 项目 `.env` 加载支持 Plan

## 1. 目标

基于已批准 spec：`docs/dtt/specs/2026-04-18-dotenv-support-spec.md`，为项目增加基于 `dotenv` 的 `.env` 加载支持，并提供 `.env.example` 模板与忽略规则。

本次完成后，应达到：

1. CLI 可默认读取项目 `.env`
2. 当 `workspaceRoot` 明确时，leader 入口也可读取对应项目 `.env`
3. 新增 `.env.example`
4. `.env` 被加入 `.gitignore`
5. 现有 OpenAI / MiniMax / mock provider 语义不变

## 2. 架构与执行摘要

本次不是 provider 逻辑改造，而是**配置来源补充**。

执行原则：

- `.env` 只是把值注入 `process.env`
- 现有 provider 配置解析规则不变
- 通过显式目录加载控制副作用边界

## 3. 批次与步骤

### Batch 1：引入 dotenv 与共享 env 加载帮助函数

目标：先把 `.env` 加载能力抽成一个明确、可复用的帮助函数。

优先文件：

- `package.json`
- 新增 `src/env.ts`
- 新增/更新测试：`tests/env.test.ts`（如需要）

执行内容：

- 添加 `dotenv` 依赖
- 新增共享函数（如 `loadProjectEnv(root: string)`）
- 使用非覆盖模式 `override: false`
- 增加幂等保护，避免同一路径重复加载

通过标准：

- `.env` 存在时可被加载
- `.env` 不存在时不报错
- 已有 shell 环境变量不被覆盖

### Batch 2：CLI 与 leader 入口接入

目标：让项目主要入口真正使用共享 `.env` 加载能力。

优先文件：

- `src/cli.ts`
- `src/leader.ts`
- 必要时相关测试：
  - `tests/cli.test.ts`
  - `tests/leader.test.ts`

执行内容：

- CLI 使用 `deps.cwd ?? process.cwd()` 作为项目目录加载 `.env`
- Leader 在 `workspaceRoot` 明确时加载对应 `.env`
- 无 `workspaceRoot` 时，不额外猜测目录，保持当前行为

通过标准：

- CLI 可在无 shell export 时读取 `.env`
- Leader 在显式 workspaceRoot 场景下可读取 `.env`
- 不破坏现有 CLI/leader 测试

### Batch 3：补充 `.env.example` 与忽略规则

目标：让用户能直接参考 `.env.example` 填写配置，并确保真实 `.env` 不被提交。

优先文件：

- 新增 `.env.example`
- `.gitignore`

执行内容：

- `.env.example` 中提供：
  - OpenAI 示例
  - MiniMax 官方 Quickstart 示例
- `.gitignore` 增加 `.env`

通过标准：

- 用户可直接参考 `.env.example`
- `.env` 被忽略

### Batch 4：README 配置说明同步

目标：在 README 中补充 `.env` 使用说明。

优先文件：

- `README.md`

执行内容：

- 说明项目支持从 `.env` 读取配置
- 给出 OpenAI / MiniMax 的最小示例
- 说明 shell env 优先于 `.env`

通过标准：

- README 与实现口径一致
- 不夸大为多环境系统

## 4. 验证检查点

### 检查点 A：共享 env 加载

- `.env` 存在/不存在
- shell env 不被覆盖
- 幂等加载

### 检查点 B：CLI / leader 入口

- CLI 在临时 workspace 下读取 `.env`
- Leader 在显式 workspaceRoot 下读取 `.env`

### 最终 fresh verification

- `npm run typecheck`
- `npm test`
- `npm run build`

## 5. 风险与控制

### 风险 1：测试意外读取开发者本机 `.env`

控制：

- 使用临时目录
- 显式指定 cwd / workspaceRoot
- 不做无边界全局自动加载

### 风险 2：`.env` 覆盖显式 shell env

控制：

- 使用 `override: false`
- 为此加专门测试

### 风险 3：把 `.env` 能力扩成复杂配置系统

控制：

- 本次只支持 `.env`
- 不引入 `.env.local` / `.env.production`

## 6. 预计输出

- `dotenv` 依赖
- `src/env.ts`
- `.env.example`
- 更新后的 `.gitignore`
- README 配置说明
- 对应测试

## 7. 执行顺序

1. Batch 1：共享 env 加载函数
2. Batch 2：CLI / leader 接入
3. Batch 3：`.env.example` 与忽略规则
4. Batch 4：README 同步
5. reviewer + fresh verification
