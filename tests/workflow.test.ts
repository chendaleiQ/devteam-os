import { describe, expect, it } from 'vitest';

import { runLeaderTask } from '../src/leader.js';
import { advanceState, canTransition, getTestingNextState, isPauseState } from '../src/workflow.js';

describe('workflow', () => {
  it('允许测试失败回流 developing', () => {
    expect(canTransition('testing', 'developing')).toBe(true);
    expect(getTestingNextState({ passed: false, summary: 'failed', issues: ['x'] })).toBe('developing');
  });

  it('能识别 clarifying pause state', () => {
    expect(advanceState('intake', { needsClarification: true })).toBe('clarifying');
    expect(isPauseState('clarifying')).toBe(true);
    expect(isPauseState('awaiting_owner_decision')).toBe(true);
    expect(isPauseState('blocked')).toBe(true);
  });
});

describe('leader minimal loop', () => {
  it('对清晰需求推进到 done 并生成交付报告', () => {
    const result = runLeaderTask('请做一个本地可运行的最小 TypeScript 原型骨架');

    expect(result.paused).toBe(false);
    expect(result.task.state).toBe('done');
    expect(result.task.deliveryReport?.summary).toContain('闭环');
    expect(result.task.agentRuns.map((run) => run.role)).toEqual(['pm', 'architect', 'developer', 'qa']);
    expect(result.task.transitions.map((item) => item.to)).toEqual([
      'planning',
      'developing',
      'testing',
      'reporting',
      'done'
    ]);
  });

  it('对模糊需求停在 clarifying', () => {
    const result = runLeaderTask('做一下');

    expect(result.paused).toBe(true);
    expect(result.task.state).toBe('clarifying');
    expect(result.task.approvalRequests).toHaveLength(1);
  });

  it('meeting 启发式时从 planning 进入 meeting 分支', () => {
    const result = runLeaderTask('请先组织一次会议评审这个本地原型增强再实现');

    expect(result.task.transitions.map((item) => item.to)).toContain('meeting');
    expect(result.task.state).toBe('done');
  });
});
