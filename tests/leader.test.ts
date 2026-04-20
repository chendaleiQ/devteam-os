import { afterEach, describe, expect, it } from 'vitest';

import { runLeaderTask } from '../src/leader.js';

const ENV_KEYS = ['DEVTEAM_EXECUTOR'] as const;

afterEach(() => {
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }
});

describe('leader governance flow', () => {
  it('模糊需求会停在 clarifying，且不依赖 mock executor', async () => {
    const result = await runLeaderTask('做一下');

    expect(result.paused).toBe(true);
    expect(result.task.state).toBe('clarifying');
    expect(result.task.approvalRequests).toHaveLength(1);
  });

  it('forceOwnerDecision 会在规划阶段进入 awaiting_owner_decision', async () => {
    const result = await runLeaderTask('请设计一个需要老板拍板范围的本地原型增强', {
      forceOwnerDecision: true
    });

    expect(result.paused).toBe(true);
    expect(result.task.state).toBe('awaiting_owner_decision');
    expect(result.task.approvalRequests.at(-1)?.status).toBe('pending');
  });

  it('forceBlocked 会在无需 mock 的前提下停在 blocked', async () => {
    const result = await runLeaderTask('请先组织会议评审依赖缺失的本地原型增强并确认阻塞', {
      forceMeeting: true,
      forceBlocked: true
    });

    expect(result.paused).toBe(true);
    expect(result.task.state).toBe('blocked');
    expect(result.task.waitingSummary?.resumeTargetState).toBe('planning');
  });
});
