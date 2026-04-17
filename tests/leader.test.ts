import { describe, expect, it } from 'vitest';

import { approveLeaderTask, resolveBlockedTask, resumeLeaderTask, runLeaderTask } from '../src/leader.js';
import { InMemoryTaskStore } from '../src/storage.js';

describe('leader second batch branches', () => {
  it('planning 在 forceMeeting 时进入 meeting 分支', () => {
    const result = runLeaderTask('请设计一个需要同步评审的本地原型增强', { forceMeeting: true });

    expect(result.task.transitions.map((item) => item.to)).toContain('meeting');
    expect(result.task.artifacts.some((artifact) => artifact.kind === 'meeting_notes')).toBe(true);
  });

  it('会议要求老板决策时停在 awaiting_owner_decision 并有 pending approval', () => {
    const result = runLeaderTask('请设计一个需要老板拍板范围的本地原型增强', {
      forceMeeting: true,
      forceOwnerDecision: true
    });

    expect(result.paused).toBe(true);
    expect(result.task.state).toBe('awaiting_owner_decision');
    expect(result.task.approvalRequests.some((request) => request.status === 'pending')).toBe(true);
  });

  it('blocked 场景停在 blocked 且 paused=true', () => {
    const result = runLeaderTask('请实现一个当前依赖缺失的本地原型增强', { forceBlocked: true });

    expect(result.paused).toBe(true);
    expect(result.task.state).toBe('blocked');
    expect(result.task.artifacts.some((artifact) => artifact.kind === 'blocker_report')).toBe(true);
  });

  it('storage 能保存并取回暂停任务', () => {
    const store = new InMemoryTaskStore();
    const result = runLeaderTask('请设计一个需要老板拍板范围的本地原型增强', {
      forceOwnerDecision: true,
      store
    });

    const saved = store.get(result.task.id);

    expect(saved?.state).toBe('awaiting_owner_decision');
    expect(saved?.deliveryReport?.finalState).toBe('awaiting_owner_decision');
  });

  it('clarifying 任务 resume 后能继续到 done', () => {
    const store = new InMemoryTaskStore();
    const result = runLeaderTask('做一下', { store });

    const resumed = resumeLeaderTask(result.task.id, {
      note: '请实现一个本地 JSON 落盘与恢复的 TypeScript 原型',
      store
    });

    expect(resumed.paused).toBe(false);
    expect(resumed.task.id).toBe(result.task.id);
    expect(resumed.task.state).toBe('done');
  });

  it('awaiting_owner_decision 任务 approve 后能继续', () => {
    const store = new InMemoryTaskStore();
    const result = runLeaderTask('请设计一个需要老板拍板范围的本地原型增强', {
      forceOwnerDecision: true,
      store
    });

    const approved = approveLeaderTask(result.task.id, { store });

    expect(approved.paused).toBe(false);
    expect(approved.task.id).toBe(result.task.id);
    expect(approved.task.state).toBe('done');
  });

  it('blocked 任务 resolve 后能继续', () => {
    const store = new InMemoryTaskStore();
    const result = runLeaderTask('请实现一个当前依赖缺失的本地原型增强', {
      forceBlocked: true,
      store
    });

    const resolved = resolveBlockedTask(result.task.id, {
      note: '依赖已补齐，可以继续推进',
      store
    });

    expect(resolved.paused).toBe(false);
    expect(resolved.task.id).toBe(result.task.id);
    expect(resolved.task.state).toBe('done');
  });
});
