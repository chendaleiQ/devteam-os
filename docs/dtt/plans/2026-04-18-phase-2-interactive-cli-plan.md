# 第二阶段收尾：持续交互 CLI Plan

## 1. 目标

基于已批准 spec：`docs/dtt/specs/2026-04-18-phase-2-interactive-cli-spec.md`，为 DevTeamOS 增加一个持续交互式 CLI 模式，让用户可以在同一会话内处理任务发起、澄清、审批与阻塞恢复。

本次 plan 完成后，应达到：

1. 新增一个持续交互 CLI 入口。
2. 用户可以在一个会话内处理：
   - start
   - clarifying
   - awaiting_owner_decision
   - blocked
   - done
3. 现有离散命令 `start / resume / approve / resolve-block` 保持兼容。

## 2. 架构与执行摘要

本次实现不改核心 workflow，只在 CLI 层新增一个“持续会话式驱动器”。

执行原则：

- 复用现有 leader API：
  - `runLeaderTask`
  - `resumeLeaderTask`
  - `approveLeaderTask`
  - `resolveBlockedTask`
- 交互 CLI 只根据任务当前状态提示下一步操作。
- 不引入第二套状态机。

## 3. 批次与步骤

### Batch 1：定义交互入口与最小会话循环

目标：先把交互模式骨架立起来。

优先文件：

- `src/cli.ts`
- 必要时新增 `src/interactive-cli.ts`
- `tests/cli.test.ts`

执行内容：

- 新增命令入口（建议命令名：`interactive`）
- 定义最小会话循环：
  - 读取用户输入
  - 启动任务
  - 根据当前状态决定后续提示
- 保持现有离散命令兼容

通过标准：

- 交互入口可启动
- 不破坏现有 CLI 测试

### Batch 2：clarifying / owner decision / blocked 的会话式处理

目标：把核心暂停点都纳入持续交互体验。

优先文件：

- `src/interactive-cli.ts`
- `tests/cli.test.ts`

执行内容：

- 当任务进入 `clarifying`：提示用户补充说明，并调用 `resumeLeaderTask`
- 当任务进入 `awaiting_owner_decision`：提示用户批准，并调用 `approveLeaderTask`
- 当任务进入 `blocked`：提示用户输入解除说明，并调用 `resolveBlockedTask`

通过标准：

- 三类暂停点都能在一个会话中继续推进
- 不需要用户手动复制 taskId 再另开命令

### Batch 3：状态展示与错误处理

目标：让交互体验真正可用，而不是仅能跑通。

优先文件：

- `src/interactive-cli.ts`
- `tests/cli.test.ts`

执行内容：

- 输出当前状态
- 输出暂停原因
- 输出下一步建议
- 处理无效输入 / 空输入 / 明确退出

通过标准：

- 用户能理解系统为什么暂停
- 无效输入不会导致 CLI 崩溃

### Batch 4：README 与路线图同步

目标：把持续交互 CLI 正式写成第二阶段收尾能力。

优先文件：

- `README.md`
- `docs/development-roadmap.md`
- 如有必要新增简短阶段报告

执行内容：

- 说明新增交互式 CLI 入口
- 说明它属于第二阶段收尾，而不是第三阶段工作台
- 保持现有路线图顺序不变

通过标准：

- README 与路线图口径一致
- 不误导为第三阶段已开始

## 4. 验证检查点

### 检查点 A：入口兼容

- 现有 `start / resume / approve / resolve-block` 测试继续通过
- 新增 `interactive` 命令测试

### 检查点 B：交互闭环

- clarifying 场景
- awaiting_owner_decision 场景
- blocked 场景

### 检查点 C：健壮性

- 无效输入
- 用户主动退出
- 会话内 taskId 管理

### 最终 fresh verification

- `npm run typecheck`
- `npm test`
- `npm run build`

## 5. 风险与控制

### 风险 1：交互 CLI 偷偷改写 workflow

控制：

- 只调用现有 leader API
- 不新增状态迁移规则

### 风险 2：现有离散命令被破坏

控制：

- 交互模式新增命令入口
- 原有命令测试必须继续通过

### 风险 3：交互逻辑过早膨胀成半个工作台

控制：

- 只做文本交互闭环
- 不做复杂 UI / TUI

## 6. 预计输出

- 持续交互 CLI 入口
- 核心暂停点的会话式处理
- 对应 CLI 测试
- README / 路线图同步

## 7. 执行顺序

1. Batch 1：交互入口与最小循环
2. Batch 2：三类暂停点的会话式处理
3. Batch 3：状态展示与错误处理
4. Batch 4：README / 路线图同步
5. reviewer + fresh verification
