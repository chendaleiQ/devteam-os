import type { AgentRun, ApprovalRequest, ApprovalTrigger, RiskLevel, RiskSignal, Task } from './domain.js';

export interface OwnerDecisionAssessment {
  needsOwnerDecision: boolean;
  reason?: string;
  trigger?: ApprovalTrigger;
  riskLevel: RiskLevel;
}

const riskPriority: Record<RiskLevel, number> = {
  low: 0,
  medium: 1,
  high: 2
};

const approvalTriggerPriority: Record<ApprovalTrigger, number> = {
  destructive_operation: 0,
  high_risk_command: 1,
  acceptance_criteria_change: 2,
  scope_change: 3,
  multi_option_direction_change: 4,
  role_requested_owner_decision: 5,
  report_confirmation: 6,
  clarification_required: 7
};

const scopeChangePattern = /范围变化|变更范围|调整范围|scope\s+change|scope\s+update/u;
const acceptanceCriteriaPattern = /验收标准变化|修改验收标准|验收变更|acceptance\s+criteria/u;
const highRiskCommandPattern = /生产环境|deploy|发布|上线|数据库迁移|data\s+migration|kubectl|terraform|sudo|chmod|git\s+push\s+--force/u;
const destructiveOperationPattern = /rm\s+-rf|git\s+reset\s+--hard|drop\s+table|truncate|删除旧表|删除数据库|删库|rename|重命名/u;
const multiOptionPattern = /预算冲突|优先级冲突|多方案|多个方案|二选一|取舍|老板拍板|老板决策|老板确认|方案A|方案B/u;

export function classifyRisk(signals: readonly Pick<RiskSignal, 'level'>[]): RiskLevel {
  let currentLevel: RiskLevel = 'low';

  for (const signal of signals) {
    if (riskPriority[signal.level] > riskPriority[currentLevel]) {
      currentLevel = signal.level;
    }
  }

  return currentLevel;
}

export function collectInputRiskSignals(
  input: string,
  pmDecision?: Pick<AgentRun, 'needsOwnerDecision' | 'nextAction' | 'risks'>
): RiskSignal[] {
  const riskSignals: RiskSignal[] = [];
  const pushRisk = createRiskCollector(riskSignals);

  if (scopeChangePattern.test(input)) {
    pushRisk({
      code: 'scope_change_requested',
      description: '任务输入涉及范围变化，需确认交付边界',
      level: 'high',
      trigger: 'scope_change'
    });
  }

  if (acceptanceCriteriaPattern.test(input)) {
    pushRisk({
      code: 'acceptance_criteria_changed',
      description: '任务输入涉及验收标准变化，需老板确认新的完成口径',
      level: 'high',
      trigger: 'acceptance_criteria_change'
    });
  }

  if (highRiskCommandPattern.test(input)) {
    pushRisk({
      code: 'high_risk_command_requested',
      description: '任务输入涉及高风险命令或生产动作，需老板确认',
      level: 'high',
      trigger: 'high_risk_command'
    });
  }

  if (destructiveOperationPattern.test(input)) {
    pushRisk({
      code: 'destructive_operation_requested',
      description: '任务输入涉及破坏性操作，需老板确认',
      level: 'high',
      trigger: 'destructive_operation'
    });
  }

  if (multiOptionPattern.test(input)) {
    pushRisk({
      code: 'directional_tradeoff_detected',
      description: '任务输入包含多方案或优先级取舍，可能影响交付方向',
      level: 'high',
      trigger: 'multi_option_direction_change'
    });
  }

  if (pmDecision?.needsOwnerDecision || pmDecision?.nextAction === 'request_owner_decision') {
    pushRisk({
      code: 'role_requested_owner_decision',
      description: pmDecision.risks?.[0] ?? '角色输出建议进入老板决策路径',
      level: 'high',
      trigger: 'role_requested_owner_decision'
    });
  }

  return riskSignals;
}

export function collectTaskRiskSignals(
  task: Pick<Task, 'latestMeetingResult' | 'approvalRequests' | 'validation' | 'transitions' | 'state'>
): RiskSignal[] {
  const riskSignals: RiskSignal[] = [];
  const pushRisk = createRiskCollector(riskSignals);

  if (task.latestMeetingResult) {
    const meetingLevel = task.latestMeetingResult.riskLevel === 'low' ? 'medium' : task.latestMeetingResult.riskLevel;
    for (const [index, risk] of task.latestMeetingResult.risks.entries()) {
      pushRisk({
        code: `meeting_risk_${index + 1}`,
        description: `会议风险：${risk}`,
        level: meetingLevel
      });
    }
  }

  for (const [index, request] of task.approvalRequests.entries()) {
    pushRisk(approvalRequestToRiskSignal(request, index));
  }

  if (task.validation?.passed === false) {
    for (const [index, issue] of task.validation.issues.entries()) {
      pushRisk({
        code: `validation_issue_${index + 1}`,
        description: `验证问题：${issue}`,
        level: 'high'
      });
    }
  }

  const blockedTransition = [...task.transitions].reverse().find((transition) => transition.to === 'blocked');
  if (blockedTransition) {
    pushRisk({
      code: 'workflow_blocked',
      description: `流程曾进入 blocked：${blockedTransition.reason}`,
      level: 'high'
    });
  }

  if (task.state === 'awaiting_owner_decision') {
    pushRisk({
      code: 'awaiting_owner_decision',
      description: '当前仍在等待老板决策，后续执行需关注审批边界',
      level: 'high'
    });
  }

  return riskSignals;
}

export function shouldRequestOwnerDecision(signals: readonly RiskSignal[]): OwnerDecisionAssessment {
  const approvalSignal = getHighestPriorityApprovalSignal(signals);

  return {
    needsOwnerDecision: Boolean(approvalSignal),
    ...(approvalSignal?.description ? { reason: approvalSignal.description } : {}),
    ...(approvalSignal?.trigger ? { trigger: approvalSignal.trigger } : {}),
    riskLevel: approvalSignal?.level ?? classifyRisk(signals)
  };
}

function approvalRequestToRiskSignal(request: ApprovalRequest, index: number): RiskSignal {
  return {
    code: `approval_${request.status}_${index + 1}`,
    description: request.status === 'pending' ? `审批待处理：${request.reason}` : `审批已处理（${request.status}）：${request.reason}`,
    level: request.status === 'pending' ? request.riskLevel : request.riskLevel === 'high' ? 'medium' : request.riskLevel,
    trigger: request.trigger
  };
}

function getHighestPriorityApprovalSignal(signals: readonly RiskSignal[]): RiskSignal | undefined {
  return [...signals]
    .filter((signal): signal is RiskSignal & { trigger: ApprovalTrigger } => Boolean(signal.trigger))
    .sort((left, right) => {
      const priorityDelta = approvalTriggerPriority[left.trigger] - approvalTriggerPriority[right.trigger];
      if (priorityDelta !== 0) {
        return priorityDelta;
      }

      return riskPriority[right.level] - riskPriority[left.level];
    })[0];
}

function createRiskCollector(target: RiskSignal[]) {
  const seen = new Set<string>();

  return (signal: RiskSignal) => {
    const key = `${signal.code}:${signal.description}`;
    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    target.push(signal);
  };
}
