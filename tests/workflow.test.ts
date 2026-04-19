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
  it('对清晰需求由 graph 推进到 done 并生成交付报告', async () => {
    const result = await runLeaderTask('请做一个本地可运行的最小 TypeScript 原型骨架', {
      runner: {
        runScript(script) {
          return { script, ok: true, blocked: false, summary: `ok ${script}` };
        }
      }
    });

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
    expect(result.task.transitions.map((item) => item.executionRule)).toEqual([
      'langgraph:intake',
      'langgraph:planning',
      'langgraph:developing',
      'langgraph:testing',
      'langgraph:reporting'
    ]);
  });

  it('对模糊需求停在 clarifying', async () => {
    const result = await runLeaderTask('做一下');

    expect(result.paused).toBe(true);
    expect(result.task.state).toBe('clarifying');
    expect(result.task.approvalRequests).toHaveLength(1);
  });

  it('meeting 启发式时由 graph 从 planning 进入 meeting 分支', async () => {
    const result = await runLeaderTask('请先组织一次会议评审这个本地原型增强再实现', {
      runner: {
        runScript(script) {
          return { script, ok: true, blocked: false, summary: `ok ${script}` };
        }
      }
    });

    expect(result.task.transitions.map((item) => item.to)).toContain('meeting');
    expect(result.task.state).toBe('done');
    expect(result.task.transitions.find((item) => item.to === 'developing')?.executionRule).toBe('langgraph:meeting');
  });

  it('testing 失败会由 graph 回流 developing', async () => {
    const result = await runLeaderTask('请实现一个本地原型并执行会失败的验证脚本', {
      verificationScripts: ['missing-command-for-langgraph-test']
    });

    expect(result.task.transitions.some((item) => item.from === 'testing' && item.to === 'developing')).toBe(true);
    expect(result.task.transitions.find((item) => item.from === 'testing' && item.to === 'developing')?.executionRule).toBe('langgraph:testing');
  });
});
