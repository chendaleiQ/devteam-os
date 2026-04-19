import { createArtifact } from './artifacts.js';
import type { Artifact, MeetingInput, MeetingResult, NextAction, Role } from './domain.js';

export type MeetingRoleSummaries = Partial<Record<Exclude<Role, 'leader'>, string>>;

const DEFAULT_DECISIONS = ['先按本地原型边界推进', '不引入 Web、多用户、云部署与复杂并行'];

export function createMeetingResult(input: MeetingInput): MeetingResult {
  const roleSummaries = toRoleSummaries(input);
  const aggregatedActions = collectRoleActions(input);
  const needsOwnerDecision = hasOwnerDecisionSignal(input, aggregatedActions);
  const hasBlockSignal = !needsOwnerDecision && hasBlockedSignal(input, aggregatedActions);
  const disagreements = needsOwnerDecision ? ['范围与优先级存在潜在冲突'] : input.triggerReason.includes('分歧') ? ['实施路径存在待对齐分歧'] : [];
  const risks = dedupeRisks(input, needsOwnerDecision, hasBlockSignal);
  const riskLevel = needsOwnerDecision || hasBlockSignal ? 'high' : risks.length > 0 ? 'medium' : 'low';
  const nextStep = needsOwnerDecision ? 'awaiting_owner_decision' : hasBlockSignal ? 'blocked' : 'developing';
  const decision = needsOwnerDecision ? '进入老板审批路径' : hasBlockSignal ? '进入阻塞路径' : '进入开发路径';
  const decisionReason = needsOwnerDecision
    ? '会议识别到高风险/关键分歧，需老板拍板'
    : hasBlockSignal
      ? '会议确认关键依赖缺失，需先解除阻塞'
      : '会议未发现阻塞与高风险，可继续推进';
  const actionItems = needsOwnerDecision
    ? ['整理冲突点并提交老板决策']
    : hasBlockSignal
      ? ['补齐外部依赖后再恢复推进']
      : ['按会议决议进入开发实现'];
  const ownerQuestion = needsOwnerDecision ? input.ownerConstraints[0] ?? '是否按当前冲突优先级继续推进？' : undefined;

  return {
    topic: input.topic,
    roleSummaries,
    disagreements,
    decision,
    decisionReason,
    riskLevel,
    decisions: [...DEFAULT_DECISIONS],
    risks,
    actionItems,
    ...(ownerQuestion ? { ownerQuestion } : {}),
    nextStep,
    needsOwnerDecision
  };
}

function hasBlockedSignal(input: MeetingInput, actions: Set<NextAction>): boolean {
  if (actions.has('block')) {
    return true;
  }

  if (input.knownRisks.some((risk) => /阻塞|blocked|依赖缺失|缺少依赖|无法继续/u.test(risk))) {
    return true;
  }

  return /阻塞|blocked|依赖缺失|缺少依赖|无法继续/u.test(`${input.topic} ${input.triggerReason}`);
}

export function createMeetingArtifact(input: MeetingInput, result: MeetingResult): Artifact {
  return createArtifact(
    'meeting_notes',
    '会议结论',
    'leader',
    JSON.stringify({
      ...result,
      triggerReason: input.triggerReason,
      ownerConstraints: input.ownerConstraints
    }, null, 2)
  );
}

function toRoleSummaries(input: MeetingInput): MeetingRoleSummaries {
  const roleSummaries: MeetingRoleSummaries = {};

  for (const [role, output] of Object.entries(input.roleOutputs)) {
    if (output) {
      roleSummaries[role as Exclude<Role, 'leader'>] = output.summary;
    }
  }

  return roleSummaries;
}

function collectRoleActions(input: MeetingInput): Set<NextAction> {
  const actions = new Set<NextAction>();
  for (const output of Object.values(input.roleOutputs)) {
    if (output) {
      actions.add(output.nextAction);
    }
  }

  return actions;
}

function hasOwnerDecisionSignal(input: MeetingInput, actions: Set<NextAction>): boolean {
  if (actions.has('request_owner_decision')) {
    return true;
  }

  return Object.values(input.roleOutputs).some((output) => output?.needsOwnerDecision);
}

function dedupeRisks(input: MeetingInput, needsOwnerDecision: boolean, hasBlockSignal: boolean): string[] {
  const riskSet = new Set<string>(input.knownRisks);

  for (const output of Object.values(input.roleOutputs)) {
    for (const risk of output?.risks ?? []) {
      riskSet.add(risk);
    }
  }

  if (needsOwnerDecision && !riskSet.size) {
    riskSet.add('存在需要老板拍板的范围或优先级');
  }

  if (hasBlockSignal && !riskSet.size) {
    riskSet.add('关键依赖缺失');
  }

  return [...riskSet];
}
