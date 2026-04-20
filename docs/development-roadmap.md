# DevTeamOS 全项目路线图

DevTeamOS 的主线已经确定：

> **保留 `Leader` 治理层，把真实开发执行交给外部执行器。**

## 当前状态

截至 2026-04-19，当前仓库已经具备：

- `Leader -> workflow -> artifact -> approval` 治理闭环
- `clarifying / awaiting_owner_decision / blocked / reporting` 暂停恢复语义
- `ExternalExecutor` 协议与 adapter registry
- 默认 `OpenHands` 执行器

## 下一阶段

### Phase 1：执行器稳定化

目标：

- 让 `OpenHands` 成为稳定默认执行器
- 提高失败可诊断性
- 明确执行器输入/输出契约
- 持续清理 mock / fake execution path，保证产品可用性只建立在真实执行链路上

范围：

- 开发/测试阶段的结果回收
- 阻塞、失败、回流语义细化
- 执行器结果 artifact 标准化

完成标准：

- 常见任务可稳定走完 `planning -> developing -> testing -> reporting -> done`
- 执行器失败时，老板能看懂为什么停住

### Phase 2：操作台收敛

目标：

- 把 CLI 做成真正的 operator console

范围：

- 展示任务状态
- 展示等待原因
- 展示执行器 session、artifact、测试结论
- 简化审批与恢复操作

完成标准：

- 不翻 JSON 也能完成任务推进

### Phase 3：多执行器接入

目标：

- 在统一治理层下接更多执行器

范围：

- 增加 `Open SWE` / `OpenHands` 之外的 adapter
- 统一不同执行器的摘要、链接、PR、验证结果

完成标准：

- 更换执行器不需要改治理层主逻辑

### Phase 4：生产协作接入

目标：

- 接入真实团队工作流

范围：

- GitHub / Slack / Linear 等集成
- 审批、回流、汇报的审计能力
- 执行器配置管理

完成标准：

- DevTeamOS 可作为外部 agent 平台之上的治理层使用

## 不再投入的方向

以下方向不再作为主线：

- 自研模型 provider
- 自研 PM / Architect / Developer / QA 执行器
- 自研 patch proposal 协议
- 自研 repo runtime / command runner
- 以“完整自建 agent 平台”为目标继续推进
