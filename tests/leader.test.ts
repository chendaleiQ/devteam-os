import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { approveLeaderTask, rejectLeaderTask, requestChangesLeaderTask, resolveBlockedTask, resumeLeaderTask, runLeaderTask } from '../src/leader.js';
import { InMemoryTaskStore } from '../src/storage.js';

const ENV_KEYS = ['DEVTEAM_LLM_PROVIDER', 'DEVTEAM_LLM_MODEL', 'OPENAI_API_KEY'] as const;
const tempDirs: string[] = [];

afterEach(() => {
  vi.unstubAllGlobals();

  for (const key of ENV_KEYS) {
    delete process.env[key];
  }

  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('leader second batch branches', () => {
  it('runLeaderTask 在显式 workspaceRoot 下自动加载 .env', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'devteam-os-leader-env-'));
    tempDirs.push(workspaceRoot);
    writeFileSync(
      join(workspaceRoot, '.env'),
      ['DEVTEAM_LLM_PROVIDER=openai', 'DEVTEAM_LLM_MODEL=gpt-4o-mini', 'OPENAI_API_KEY=test-key'].join('\n'),
      'utf8'
    );

    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(createOpenAiResponse('PM workspace env summary', 'PM env artifact'))
      .mockResolvedValueOnce(createOpenAiResponse('Architect workspace env summary', 'Architect env artifact'));
    vi.stubGlobal('fetch', fetchImpl);

    const result = await runLeaderTask('请设计一个需要老板拍板范围的本地原型增强', { workspaceRoot });

    expect(result.task.state).toBe('awaiting_owner_decision');
    expect(fetchImpl).toHaveBeenCalled();
    expect(result.task.agentRuns.map((run) => run.summary)).toContain('PM workspace env summary');
  });

  it('无 workspaceRoot 时不额外猜测目录并保持现有行为', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchImpl);

    const result = await runLeaderTask('请设计一个需要老板拍板范围的本地原型增强');

    expect(result.task.state).toBe('awaiting_owner_decision');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('前一次 workspaceRoot 已加载时，后续未显式传入 workspaceRoot 不会复用旧 .env', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'devteam-os-leader-env-'));
    tempDirs.push(workspaceRoot);
    writeFileSync(
      join(workspaceRoot, '.env'),
      ['DEVTEAM_LLM_PROVIDER=openai', 'DEVTEAM_LLM_MODEL=gpt-4o-mini', 'OPENAI_API_KEY=test-key'].join('\n'),
      'utf8'
    );

    const firstFetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(createOpenAiResponse('PM workspace env summary', 'PM env artifact'))
      .mockResolvedValueOnce(createOpenAiResponse('Architect workspace env summary', 'Architect env artifact'));
    vi.stubGlobal('fetch', firstFetchImpl);

    await runLeaderTask('请设计一个需要老板拍板范围的本地原型增强', { workspaceRoot });
    expect(firstFetchImpl).toHaveBeenCalled();

    const secondFetchImpl = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', secondFetchImpl);

    const result = await runLeaderTask('请设计一个需要老板拍板范围的本地原型增强');

    expect(result.task.state).toBe('awaiting_owner_decision');
    expect(secondFetchImpl).not.toHaveBeenCalled();
  });

  it('多 workspace 场景不会错误复用别的目录 .env', async () => {
    const workspaceWithEnv = mkdtempSync(join(tmpdir(), 'devteam-os-leader-env-a-'));
    const workspaceWithoutEnv = mkdtempSync(join(tmpdir(), 'devteam-os-leader-env-b-'));
    tempDirs.push(workspaceWithEnv, workspaceWithoutEnv);
    writeFileSync(
      join(workspaceWithEnv, '.env'),
      ['DEVTEAM_LLM_PROVIDER=openai', 'DEVTEAM_LLM_MODEL=gpt-4o-mini', 'OPENAI_API_KEY=test-key'].join('\n'),
      'utf8'
    );

    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(createOpenAiResponse('PM workspace env summary', 'PM env artifact'))
      .mockResolvedValueOnce(createOpenAiResponse('Architect workspace env summary', 'Architect env artifact'));
    vi.stubGlobal('fetch', fetchImpl);

    const withEnv = await runLeaderTask('请设计一个需要老板拍板范围的本地原型增强', {
      workspaceRoot: workspaceWithEnv
    });

    expect(withEnv.task.state).toBe('awaiting_owner_decision');
    expect(fetchImpl).toHaveBeenCalled();

    fetchImpl.mockClear();

    const withoutEnv = await runLeaderTask('请设计一个需要老板拍板范围的本地原型增强', {
      workspaceRoot: workspaceWithoutEnv
    });

    expect(withoutEnv.task.state).toBe('awaiting_owner_decision');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('标准路径按 pm/architect/developer/qa 顺序产出 agentRuns 与角色 artifact', async () => {
    const result = await runLeaderTask('请实现一个本地 JSON 落盘与恢复的 TypeScript 原型');

    expect(result.paused).toBe(false);
    expect(result.task.state).toBe('done');
    expect(result.task.agentRuns.map((run) => run.role)).toEqual(['pm', 'architect', 'developer', 'qa']);

    for (const run of result.task.agentRuns) {
      expect(run.producedArtifactIds).toHaveLength(1);
      expect(result.task.artifacts.some((artifact) => artifact.id === run.producedArtifactIds[0])).toBe(true);
      expect(run.summary).toBeTruthy();
      expect(run.confidence).toBeGreaterThan(0);
      expect(run.riskLevel).toMatch(/low|medium|high/u);
      expect(run.needsOwnerDecision).toEqual(expect.any(Boolean));
      expect(run.nextAction).toBeTruthy();
    }

    expect(result.task.artifacts.some((artifact) => artifact.kind === 'implementation_plan')).toBe(true);
    expect(result.task.artifacts.some((artifact) => artifact.kind === 'architecture_note')).toBe(true);
    expect(result.task.artifacts.some((artifact) => artifact.kind === 'code_summary')).toBe(true);
    expect(result.task.artifacts.some((artifact) => artifact.kind === 'test_report')).toBe(true);
  }, 15000);

  it('planning 在 forceMeeting 时进入 meeting 分支', async () => {
    const result = await runLeaderTask('请设计一个需要同步评审的本地原型增强', { forceMeeting: true });

    expect(result.task.transitions.map((item) => item.to)).toContain('meeting');
    expect(result.task.artifacts.some((artifact) => artifact.kind === 'meeting_notes')).toBe(true);
  });

  it('meeting 识别阻塞时进入 blocked 并写入暂停信息', async () => {
    const result = await runLeaderTask('请先组织会议评审依赖缺失的本地原型增强并确认阻塞', {
      forceMeeting: true,
      forceBlocked: true
    });

    expect(result.paused).toBe(true);
    expect(result.task.state).toBe('blocked');
    expect(result.task.transitions.map((item) => item.to)).toContain('meeting');
    expect(result.task.transitions.at(-1)?.executionRule).toBe('langgraph:meeting');
    expect(result.task.artifacts.some((artifact) => artifact.kind === 'meeting_notes')).toBe(true);
    expect(result.task.waitingSummary).toMatchObject({
      reason: '会议确认存在阻塞条件，等待解除后再继续',
      requestedInput: '请补齐缺失依赖或确认替代方案后恢复',
      resumeTargetState: 'planning'
    });
    expect(result.task.checkpoint).toMatchObject({
      state: 'blocked',
      transitionCount: result.task.transitions.length,
      artifactCount: result.task.artifacts.length,
      summary: 'meeting 结论为 blocked，等待阻塞解除'
    });
    expect(result.task.validation?.passed).toBe(false);
    expect(result.task.validation?.issues).toEqual(expect.arrayContaining(['关键依赖缺失']));
  });

  it('会议要求老板决策时停在 awaiting_owner_decision 并有 pending approval', async () => {
    const result = await runLeaderTask('请设计一个需要老板拍板范围的本地原型增强', {
      forceMeeting: true,
      forceOwnerDecision: true
    });

    expect(result.paused).toBe(true);
    expect(result.task.state).toBe('awaiting_owner_decision');
    expect(result.task.approvalRequests.some((request) => request.status === 'pending')).toBe(true);
    expect(result.task.approvalRequests.at(-1)).toMatchObject({
      trigger: 'multi_option_direction_change',
      riskLevel: 'high'
    });
    expect(result.task.transitions.at(-1)?.executionRule).toBe('langgraph:meeting');
    expect(result.task.waitingSummary).toMatchObject({
      reason: '会议已完成，等待老板决策',
      requestedInput: '请老板确认范围、优先级与交付方向',
      resumeTargetState: 'planning'
    });
    expect(result.task.checkpoint).toMatchObject({
      state: 'awaiting_owner_decision',
      transitionCount: result.task.transitions.length,
      artifactCount: result.task.artifacts.length
    });
  });

  it('blocked 场景停在 blocked 且 paused=true', async () => {
    const result = await runLeaderTask('请实现一个当前依赖缺失的本地原型增强', { forceBlocked: true });

    expect(result.paused).toBe(true);
    expect(result.task.state).toBe('blocked');
    expect(result.task.artifacts.some((artifact) => artifact.kind === 'blocker_report')).toBe(true);
    expect(result.task.waitingSummary).toMatchObject({
      reason: '任务受阻，等待解除阻塞',
      requestedInput: '补充缺失依赖、信息或资源后再恢复',
      resumeTargetState: 'planning'
    });
    expect(result.task.checkpoint).toMatchObject({
      state: 'blocked',
      transitionCount: result.task.transitions.length,
      artifactCount: result.task.artifacts.length
    });
  });

  it('storage 能保存并取回暂停任务', async () => {
    const store = new InMemoryTaskStore();
    const result = await runLeaderTask('请设计一个需要老板拍板范围的本地原型增强', {
      forceOwnerDecision: true,
      store
    });

    const saved = store.get(result.task.id);

    expect(saved?.state).toBe('awaiting_owner_decision');
    expect(saved?.deliveryReport?.finalState).toBe('awaiting_owner_decision');
    expect(saved?.waitingSummary).toEqual(result.task.waitingSummary);
    expect(saved?.checkpoint).toEqual(result.task.checkpoint);
    expect(saved?.checkpoint?.artifactIds?.length).toBeGreaterThan(0);
  });

  it('clarifying 暂停时写入 waitingSummary', async () => {
    const result = await runLeaderTask('做一下');

    expect(result.task.waitingSummary).toMatchObject({
      reason: '等待澄清，尚未进入交付阶段',
      requestedInput: '请补充更清晰的目标、范围或约束',
      resumeTargetState: 'planning'
    });
    expect(result.task.deliveryReport?.pendingItems).toEqual(
      expect.arrayContaining(['需求描述过短或缺少可执行目标', '等待输入: 请补充更清晰的目标、范围或约束'])
    );
    expect(result.task.artifacts.some((artifact) => artifact.kind === 'context_summary')).toBe(true);
    expect(result.task.artifacts.some((artifact) => artifact.kind === 'risk_assessment')).toBe(true);
  });

  it('final delivery report 保留 artifactIds 并包含验证信息', async () => {
    const result = await runLeaderTask('请实现一个本地 JSON 落盘与恢复的 TypeScript 原型');

    expect(result.task.deliveryReport?.artifactIds).toEqual(result.task.artifacts.map((artifact) => artifact.id));
    expect(result.task.deliveryReport?.summary).toContain('基础验证通过，进入汇报');
    expect(result.task.deliveryReport?.pendingItems).toEqual([]);
    expect(result.task.deliveryReport?.keyArtifactIds?.length).toBeGreaterThan(0);
  }, 15000);

  it('planning 风险规则会为验收标准变化触发老板决策', async () => {
    const result = await runLeaderTask('请先评估范围变化，再修改验收标准后继续推进本地原型');

    expect(result.paused).toBe(true);
    expect(result.task.state).toBe('awaiting_owner_decision');
    expect(result.task.approvalRequests.at(-1)).toMatchObject({
      trigger: 'acceptance_criteria_change',
      riskLevel: 'high',
      status: 'pending'
    });
    expect(result.task.approvalRequests.at(-1)?.reason).toMatch(/验收标准变化/u);
  });

  it('planning 风险规则会为破坏性操作触发老板决策', async () => {
    const result = await runLeaderTask('请删除旧表并在生产环境执行数据库迁移，然后继续推进本地原型');

    expect(result.paused).toBe(true);
    expect(result.task.state).toBe('awaiting_owner_decision');
    expect(result.task.approvalRequests.at(-1)).toMatchObject({
      trigger: 'destructive_operation',
      riskLevel: 'high',
      status: 'pending'
    });
    expect(result.task.approvalRequests.at(-1)?.reason).toMatch(/破坏性操作/u);
  });

  it('验证阶段记录 testCommandResolution', async () => {
    const result = await runLeaderTask('请实现一个本地 JSON 落盘与恢复的 TypeScript 原型', {
      verificationScripts: ['typecheck']
    });

    expect(result.task.testCommandResolution).toMatchObject({
      command: 'typecheck',
      source: 'user',
      blocked: false
    });
  }, 15000);

  it('默认无 verificationScripts 时解析 package scripts 并执行验证命令', async () => {
    const scripts: string[] = [];
    const result = await runLeaderTask('请实现一个本地 JSON 落盘与恢复的 TypeScript 原型', {
      runner: {
        runScript(script) {
          scripts.push(script);
          return { script, ok: true, blocked: false, summary: `ok ${script}` };
        }
      }
    });

    expect(result.task.state).toBe('done');
    expect(result.task.testCommandResolution).toMatchObject({
      command: 'typecheck',
      source: 'package_scripts',
      blocked: false
    });
    expect(scripts).toEqual(['typecheck']);
  });

  it('packageJsonPath 无可用 scripts 时验证被阻塞并回流 developing', async () => {
    const packageJsonPath = createPackageJson({ lint: 'eslint .' });
    const result = await runLeaderTask('请实现一个本地 JSON 落盘与恢复的 TypeScript 原型', {
      packageJsonPath
    });

    expect(result.paused).toBe(true);
    expect(result.task.state).toBe('developing');
    expect(result.task.testCommandResolution).toMatchObject({
      source: 'unknown',
      blocked: true
    });
    expect(result.task.validation?.passed).toBe(false);
    expect(result.task.validation?.issues).toEqual(expect.arrayContaining([expect.stringMatching(/测试命令|未找到/u)]));
  });

  it('验证失败后 resume 可重新进入 graph 并追加 developer/qa agentRuns', async () => {
    const store = new InMemoryTaskStore();
    let attempts = 0;
    const runner = {
      runScript(script: string) {
        attempts += 1;
        return {
          script,
          ok: attempts > 1,
          blocked: false,
          summary: attempts > 1 ? `ok ${script}` : `fail ${script}`
        };
      }
    };
    const result = await runLeaderTask('请实现一个本地 JSON 落盘与恢复的 TypeScript 原型', {
      verificationScripts: ['typecheck'],
      runner,
      store
    });

    expect(result.paused).toBe(true);
    expect(result.task.state).toBe('developing');
    const developerRunsBefore = result.task.agentRuns.filter((run) => run.role === 'developer').length;
    const qaRunsBefore = result.task.agentRuns.filter((run) => run.role === 'qa').length;

    const resumed = await resumeLeaderTask(result.task.id, {
      note: '已按失败验证结果补充修复，请重新验证',
      verificationScripts: ['typecheck'],
      runner,
      store
    });

    expect(resumed.paused).toBe(false);
    expect(resumed.task.state).toBe('done');
    expect(resumed.task.agentRuns.filter((run) => run.role === 'developer')).toHaveLength(developerRunsBefore + 1);
    expect(resumed.task.agentRuns.filter((run) => run.role === 'qa')).toHaveLength(qaRunsBefore + 1);
  });

  it('clarifying 任务 resume 后能重新进入 graph 并继续到 done', async () => {
    const store = new InMemoryTaskStore();
    const result = await runLeaderTask('做一下', { store });

    const resumed = await resumeLeaderTask(result.task.id, {
      note: '请实现一个本地 JSON 落盘与恢复的 TypeScript 原型',
      store
    });

    expect(resumed.paused).toBe(false);
    expect(resumed.task.id).toBe(result.task.id);
    expect(resumed.task.state).toBe('done');
    expect([...resumed.task.transitions].reverse().find((item) => item.to === 'planning')?.executionRule).toBe('langgraph:clarifying');
  });

  it('awaiting_owner_decision 任务 approve 后能重新进入 graph 并继续', async () => {
    const store = new InMemoryTaskStore();
    const result = await runLeaderTask('请设计一个需要老板拍板范围的本地原型增强', {
      forceOwnerDecision: true,
      store
    });

    const approved = await approveLeaderTask(result.task.id, { store });

    expect(approved.paused).toBe(false);
    expect(approved.task.id).toBe(result.task.id);
    expect(approved.task.state).toBe('done');
    expect([...approved.task.transitions].reverse().find((item) => item.to === 'planning')?.executionRule).toBe('langgraph:awaiting_owner_decision');
  });

  it('awaiting_owner_decision 任务 reject 后会进入 blocked 等待新方向', async () => {
    const store = new InMemoryTaskStore();
    const result = await runLeaderTask('请设计一个需要老板拍板范围的本地原型增强', {
      forceOwnerDecision: true,
      store
    });

    const rejected = await rejectLeaderTask(result.task.id, {
      note: '请缩小范围，重新规划后再继续',
      store
    });

    expect(rejected.paused).toBe(true);
    expect(rejected.task.state).toBe('blocked');
    expect(rejected.task.approvalRequests.at(-1)?.status).toBe('rejected');
    expect(rejected.task.waitingSummary).toMatchObject({
      reason: '老板已驳回当前方案，等待新的方向或约束',
      requestedInput: '请补充新的方向、范围或约束后再恢复推进',
      resumeTargetState: 'planning'
    });
  });

  it('awaiting_owner_decision 任务 revise 后会回到 planning 并重新经过 PM', async () => {
    const store = new InMemoryTaskStore();
    const result = await runLeaderTask('请设计一个需要老板拍板范围的本地原型增强', {
      forceOwnerDecision: true,
      store
    });

    const revised = await requestChangesLeaderTask(result.task.id, {
      note: '请缩小范围，并补充新的验收标准',
      store
    });

    expect(revised.paused).toBe(false);
    expect(revised.task.state).toBe('done');
    expect(revised.task.agentRuns.filter((run) => run.role === 'pm')).toHaveLength(2);
    expect(revised.task.artifacts.some((artifact) => artifact.title.includes('老板修改意见'))).toBe(true);
    expect(revised.task.transitions.some((item) => item.from === 'awaiting_owner_decision' && item.to === 'planning')).toBe(true);
  });

  it('blocked 任务 resolve 后能重新进入 graph 并继续', async () => {
    const store = new InMemoryTaskStore();
    const result = await runLeaderTask('请实现一个当前依赖缺失的本地原型增强', {
      forceBlocked: true,
      store
    });

    const resolved = await resolveBlockedTask(result.task.id, {
      note: '依赖已补齐，可以继续推进',
      store
    });

    expect(resolved.paused).toBe(false);
    expect(resolved.task.id).toBe(result.task.id);
    expect(resolved.task.state).toBe('done');
    expect([...resolved.task.transitions].reverse().find((item) => item.to === 'planning')?.executionRule).toBe('langgraph:blocked');
  }, 15000);

  it('blocked 恢复后若老板补充了新要求，会重新经过 PM planning', async () => {
    const store = new InMemoryTaskStore();
    const blocked = await runLeaderTask('请实现一个当前依赖缺失的本地原型增强', {
      forceBlocked: true,
      store
    });

    const resolved = await resolveBlockedTask(blocked.task.id, {
      note: '需求变化：请改成支持本地 CLI 与验收标准更新',
      store
    });

    expect(resolved.task.state).toBe('done');
    expect(resolved.task.agentRuns.filter((run) => run.role === 'pm')).toHaveLength(2);
    expect(resolved.task.artifacts.some((artifact) => artifact.kind === 'loopback_note')).toBe(true);
  });

  it('开发阶段识别方案冲突时会回到 meeting 再继续推进', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'devteam-os-conflict-'));
    tempDirs.push(workspaceRoot);
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(createOpenAiRoleResponse({
        summary: 'PM summary',
        confidence: 0.93,
        riskLevel: 'low',
        risks: [],
        needsOwnerDecision: false,
        nextAction: 'continue',
        artifactContent: 'PM artifact'
      }))
      .mockResolvedValueOnce(createOpenAiRoleResponse({
        summary: 'Architect summary',
        confidence: 0.9,
        riskLevel: 'medium',
        risks: ['实施路径存在冲突'],
        needsOwnerDecision: false,
        nextAction: 'trigger_meeting',
        artifactContent: 'Architect conflict artifact'
      }))
      .mockResolvedValueOnce(createOpenAiRoleResponse({
        summary: 'Developer summary',
        confidence: 0.88,
        riskLevel: 'low',
        risks: [],
        needsOwnerDecision: false,
        nextAction: 'continue',
        patchProposal: {
          format: 'devteam.patch-proposal.v1',
          summary: 'Add a safe mock file',
          rationale: 'allow workflow continue after meeting',
          verificationPlan: ['run typecheck'],
          changes: [
            {
              path: '.devteam-os/conflict-resolution.ts',
              operation: 'add',
              purpose: '写入安全占位文件',
              content: 'export const conflictResolved = true;\n'
            }
          ]
        }
      }))
      .mockResolvedValueOnce(createOpenAiRoleResponse({
        summary: 'Developer summary rerun',
        confidence: 0.87,
        riskLevel: 'low',
        risks: [],
        needsOwnerDecision: false,
        nextAction: 'continue',
        patchProposal: {
          format: 'devteam.patch-proposal.v1',
          summary: 'Add a safe mock file after meeting',
          rationale: 'allow workflow continue after meeting',
          verificationPlan: ['run typecheck'],
          changes: [
            {
              path: '.devteam-os/conflict-resolution.ts',
              operation: 'add',
              purpose: '写入安全占位文件',
              content: 'export const conflictResolved = true;\n'
            }
          ]
        }
      }))
      .mockResolvedValueOnce(createOpenAiRoleResponse({
        summary: 'QA summary',
        confidence: 0.9,
        riskLevel: 'low',
        risks: [],
        needsOwnerDecision: false,
        nextAction: 'continue',
        artifactContent: 'QA artifact'
      }));

    const result = await runLeaderTask('请实现一个本地 JSON 落盘与恢复的 TypeScript 原型', {
      workspaceRoot,
      verificationScripts: ['typecheck'],
      runner: {
        runScript(script) {
          return { script, ok: true, blocked: false, summary: `ok ${script}` };
        }
      },
      llm: {
        provider: 'openai',
        model: 'gpt-4o-mini',
        apiKey: 'test-key',
        fetch: fetchImpl,
        maxRetries: 0
      }
    });

    expect(result.task.state).toBe('done');
    expect(result.task.transitions.some((item) => item.from === 'developing' && item.to === 'meeting')).toBe(true);
    expect(result.task.artifacts.some((artifact) => artifact.kind === 'loopback_note')).toBe(true);
  });

  it('开发阶段风险升高时会进入 awaiting_owner_decision', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'devteam-os-risk-escalation-'));
    tempDirs.push(workspaceRoot);
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(createOpenAiRoleResponse({
        summary: 'PM summary',
        confidence: 0.93,
        riskLevel: 'low',
        risks: [],
        needsOwnerDecision: false,
        nextAction: 'continue',
        artifactContent: 'PM artifact'
      }))
      .mockResolvedValueOnce(createOpenAiRoleResponse({
        summary: 'Architect summary',
        confidence: 0.9,
        riskLevel: 'high',
        risks: ['当前实现方向涉及高风险数据操作，需要老板确认'],
        needsOwnerDecision: true,
        nextAction: 'request_owner_decision',
        artifactContent: 'Architect escalation artifact'
      }))
      .mockResolvedValueOnce(createOpenAiRoleResponse({
        summary: 'Developer summary',
        confidence: 0.88,
        riskLevel: 'low',
        risks: [],
        needsOwnerDecision: false,
        nextAction: 'continue',
        patchProposal: {
          format: 'devteam.patch-proposal.v1',
          summary: 'Add a safe mock file',
          rationale: 'proposal should be blocked by owner decision before testing',
          verificationPlan: ['run typecheck'],
          changes: [
            {
              path: '.devteam-os/risk-escalation.ts',
              operation: 'add',
              purpose: '写入安全占位文件',
              content: 'export const escalationPending = true;\n'
            }
          ]
        }
      }));

    const result = await runLeaderTask('请实现一个本地 JSON 落盘与恢复的 TypeScript 原型', {
      workspaceRoot,
      llm: {
        provider: 'openai',
        model: 'gpt-4o-mini',
        apiKey: 'test-key',
        fetch: fetchImpl,
        maxRetries: 0
      }
    });

    expect(result.paused).toBe(true);
    expect(result.task.state).toBe('awaiting_owner_decision');
    expect(result.task.approvalRequests.at(-1)).toMatchObject({
      trigger: 'role_requested_owner_decision',
      riskLevel: 'high'
    });
    expect(result.task.artifacts.some((artifact) => artifact.kind === 'loopback_note')).toBe(true);
  });

  it('developer 产出 patch_proposal 后会先写入文件再进入 testing', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'devteam-os-workflow-'));
    const targetFile = join(workspaceRoot, 'feature.ts');
    writeFileSync(targetFile, 'export const version = 1;\n', 'utf8');

    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: JSON.stringify({
              summary: 'PM openai summary',
              confidence: 0.93,
              riskLevel: 'low',
              risks: [],
              needsOwnerDecision: false,
              nextAction: 'continue',
              artifactContent: 'PM artifact from llm'
            }) } }]
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: JSON.stringify({
              summary: 'Architect openai summary',
              confidence: 0.92,
              riskLevel: 'low',
              risks: [],
              needsOwnerDecision: false,
              nextAction: 'continue',
              artifactContent: 'Architect artifact from llm'
            }) } }]
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: JSON.stringify({
              summary: 'Developer openai summary',
              confidence: 0.91,
              riskLevel: 'medium',
              risks: ['需要确认 proposal'],
              needsOwnerDecision: false,
              nextAction: 'continue',
              patchProposal: {
                format: 'devteam.patch-proposal.v1',
                summary: 'Update workspace file before testing',
                rationale: 'Ensure controlled writes happen before QA',
                verificationPlan: ['Run leader workflow test'],
                changes: [
                  {
                    path: 'feature.ts',
                    operation: 'update',
                    purpose: '更新实现文件',
                    content: 'export const version = 2;\n'
                  }
                ]
              }
            }) } }]
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: JSON.stringify({
              summary: 'QA openai summary',
              confidence: 0.9,
              riskLevel: 'low',
              risks: [],
              needsOwnerDecision: false,
              nextAction: 'continue',
              artifactContent: 'QA artifact from llm'
            }) } }]
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      );

    const result = await runLeaderTask('请实现一个本地 JSON 落盘与恢复的 TypeScript 原型', {
      workspaceRoot,
      verificationScripts: ['typecheck'],
      runner: {
        runScript(script) {
          return { script, ok: true, blocked: false, summary: `ok ${script}` };
        }
      },
      llm: {
        provider: 'openai',
        model: 'gpt-4o-mini',
        apiKey: 'test-key',
        fetch: fetchImpl,
        maxRetries: 0
      }
    });

    expect(readFileSync(targetFile, 'utf8')).toBe('export const version = 2;\n');
    expect(result.task.transitions.some((item) => item.from === 'developing' && item.to === 'testing')).toBe(true);
    expect(result.task.state).toBe('done');
  });
});

function createPackageJson(scripts: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'devteam-os-leader-'));
  tempDirs.push(root);
  const packageJsonPath = join(root, 'package.json');
  writeFileSync(packageJsonPath, JSON.stringify({ scripts }), 'utf8');
  return packageJsonPath;
}

function createOpenAiResponse(summary: string, artifactContent: string): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        summary,
        confidence: 0.9,
        riskLevel: 'low',
        risks: [],
        needsOwnerDecision: false,
        nextAction: 'continue',
        artifactContent
      }) } }]
    }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  );
}

function createOpenAiRoleResponse(payload: Record<string, unknown>): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: JSON.stringify(payload) } }]
    }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  );
}
