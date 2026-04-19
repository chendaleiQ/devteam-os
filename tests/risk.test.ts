import { describe, expect, it } from 'vitest';

import { classifyRisk, collectInputRiskSignals, collectTaskRiskSignals, shouldRequestOwnerDecision } from '../src/risk.js';

describe('risk rules', () => {
  it('classifyRisk returns the highest level from a signal set', () => {
    expect(classifyRisk([
      { level: 'low' as const },
      { level: 'medium' as const },
      { level: 'high' as const }
    ])).toBe('high');
  });

  it('collectInputRiskSignals detects scope and acceptance criteria changes', () => {
    const signals = collectInputRiskSignals('请先评估范围变化，再修改验收标准后继续推进本地原型');

    expect(signals).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'scope_change_requested',
        level: 'high',
        trigger: 'scope_change'
      }),
      expect.objectContaining({
        code: 'acceptance_criteria_changed',
        level: 'high',
        trigger: 'acceptance_criteria_change'
      })
    ]));
  });

  it('shouldRequestOwnerDecision prefers stronger destructive triggers over generic role requests', () => {
    const assessment = shouldRequestOwnerDecision([
      {
        code: 'role_requested_owner_decision',
        description: '角色输出建议进入老板决策路径',
        level: 'high',
        trigger: 'role_requested_owner_decision'
      },
      {
        code: 'destructive_operation_requested',
        description: '任务输入涉及破坏性操作，需老板确认',
        level: 'high',
        trigger: 'destructive_operation'
      }
    ]);

    expect(assessment).toMatchObject({
      needsOwnerDecision: true,
      trigger: 'destructive_operation',
      riskLevel: 'high',
      reason: '任务输入涉及破坏性操作，需老板确认'
    });
  });

  it('collectTaskRiskSignals preserves approval trigger metadata for downstream roles', () => {
    const signals = collectTaskRiskSignals({
      approvalRequests: [
        {
          id: 'approval_1',
          reason: '任务输入涉及高风险命令或生产动作，需老板确认',
          requestedBy: 'leader',
          trigger: 'high_risk_command',
          riskLevel: 'high',
          status: 'pending'
        }
      ],
      transitions: [],
      state: 'awaiting_owner_decision'
    });

    expect(signals).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'approval_pending_1',
        trigger: 'high_risk_command',
        level: 'high'
      }),
      expect.objectContaining({
        code: 'awaiting_owner_decision',
        level: 'high'
      })
    ]));
  });
});
