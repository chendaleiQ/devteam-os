import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { approveLeaderTask, resolveBlockedTask, resumeLeaderTask, runLeaderTask } from '../src/leader.js';
import { InMemoryTaskStore } from '../src/storage.js';

describe('leader second batch branches', () => {
  it('标准路径按 pm/architect/developer/qa 顺序产出 agentRuns 与角色 artifact', async () => {
    const result = await runLeaderTask('请实现一个本地 JSON 落盘与恢复的 TypeScript 原型');

    expect(result.paused).toBe(false);
    expect(result.task.state).toBe('done');
    expect(result.task.agentRuns.map((run) => run.role)).toEqual(['pm', 'architect', 'developer', 'qa']);

    for (const run of result.task.agentRuns) {
      expect(run.producedArtifactIds).toHaveLength(1);
      expect(result.task.artifacts.some((artifact) => artifact.id === run.producedArtifactIds[0])).toBe(true);
    }

    expect(result.task.artifacts.some((artifact) => artifact.kind === 'implementation_plan')).toBe(true);
    expect(result.task.artifacts.some((artifact) => artifact.kind === 'architecture_note')).toBe(true);
    expect(result.task.artifacts.some((artifact) => artifact.kind === 'code_summary')).toBe(true);
    expect(result.task.artifacts.some((artifact) => artifact.kind === 'test_report')).toBe(true);
  });

  it('planning 在 forceMeeting 时进入 meeting 分支', async () => {
    const result = await runLeaderTask('请设计一个需要同步评审的本地原型增强', { forceMeeting: true });

    expect(result.task.transitions.map((item) => item.to)).toContain('meeting');
    expect(result.task.artifacts.some((artifact) => artifact.kind === 'meeting_notes')).toBe(true);
  });

  it('会议要求老板决策时停在 awaiting_owner_decision 并有 pending approval', async () => {
    const result = await runLeaderTask('请设计一个需要老板拍板范围的本地原型增强', {
      forceMeeting: true,
      forceOwnerDecision: true
    });

    expect(result.paused).toBe(true);
    expect(result.task.state).toBe('awaiting_owner_decision');
    expect(result.task.approvalRequests.some((request) => request.status === 'pending')).toBe(true);
    expect(result.task.transitions.at(-1)?.executionRule).toBe('langgraph:meeting');
    expect(result.task.waitingSummary).toMatchObject({
      reason: '会议已完成，等待老板决策',
      requestedInput: '老板最终拍板',
      resumeTargetState: 'developing'
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
  });

  it('final delivery report 保留 artifactIds 并包含验证信息', async () => {
    const result = await runLeaderTask('请实现一个本地 JSON 落盘与恢复的 TypeScript 原型');

    expect(result.task.deliveryReport?.artifactIds).toEqual(result.task.artifacts.map((artifact) => artifact.id));
    expect(result.task.deliveryReport?.summary).toContain('基础验证通过，进入汇报');
    expect(result.task.deliveryReport?.pendingItems).toEqual([]);
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
  });

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
    expect([...approved.task.transitions].reverse().find((item) => item.to === 'developing')?.executionRule).toBe('langgraph:awaiting_owner_decision');
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
  });
});

function createPackageJson(scripts: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'devteam-os-leader-'));
  const packageJsonPath = join(root, 'package.json');
  writeFileSync(packageJsonPath, JSON.stringify({ scripts }), 'utf8');
  return packageJsonPath;
}
