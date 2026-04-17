import { Annotation, END, START, StateGraph } from '@langchain/langgraph';

import type {
  AgentRun,
  ApprovalRequest,
  Artifact,
  LeaderRunResult,
  StateTransition,
  Task,
  TaskState,
  TestCommandResolution,
  ValidationResult,
} from './domain.js';
import { runAgent, type AgentRunOutput } from './agents/index.js';
import {
  addArtifact,
  buildDeliveryReport,
  clearWaitingState,
  createArtifact,
  createCheckpoint,
  createId,
  setWaitingSummary
} from './artifacts.js';
import { createMeetingArtifact, createMeetingResult, type MeetingRoleSummaries } from './meeting.js';
import { createSafeScriptRunner, resolveTestCommand } from './runner.js';
import type { LeaderRunOptions } from './leader.js';
import { advanceState, assertValidTransition, isPauseState } from './workflow.js';

const LeaderGraphAnnotation = Annotation.Root({
  task: Annotation<Task>(),
  options: Annotation<LeaderRunOptions>()
});

type LeaderGraphState = typeof LeaderGraphAnnotation.State;

const leaderGraph = new StateGraph(LeaderGraphAnnotation)
  .addNode('intake', async (state) => ({ task: runIntakeNode(state.task, state.options) }))
  .addNode('clarifying', async (state) => ({ task: runClarifyingNode(state.task, state.options) }))
  .addNode('planning', async (state) => ({ task: runPlanningNode(state.task, state.options) }))
  .addNode('meeting', async (state) => ({ task: runMeetingNode(state.task, state.options) }))
  .addNode('developing', async (state) => ({ task: runDevelopingNode(state.task, state.options) }))
  .addNode('testing', async (state) => ({ task: runTestingNode(state.task, state.options) }))
  .addNode('reporting', async (state) => ({ task: runReportingNode(state.task, state.options) }))
  .addNode('awaiting_owner_decision', async (state) => ({ task: runAwaitingOwnerDecisionNode(state.task, state.options) }))
  .addNode('blocked', async (state) => ({ task: runBlockedNode(state.task, state.options) }))
  .addConditionalEdges(START, routeCurrentState)
  .addConditionalEdges('intake', routeAfterNode)
  .addConditionalEdges('clarifying', routeAfterNode)
  .addConditionalEdges('planning', routeAfterNode)
  .addConditionalEdges('meeting', routeAfterNode)
  .addConditionalEdges('developing', routeAfterNode)
  .addConditionalEdges('testing', routeAfterNode)
  .addConditionalEdges('reporting', routeAfterNode)
  .addConditionalEdges('awaiting_owner_decision', routeAfterNode)
  .addConditionalEdges('blocked', routeAfterNode)
  .compile({ name: 'leader-workflow-graph' });

export async function runLeaderGraph(task: Task, options: LeaderRunOptions = {}): Promise<LeaderRunResult> {
  const result = await leaderGraph.invoke({ task, options });

  return {
    task: result.task,
    paused: isPauseState(result.task.state) || hasFailedValidationPause(result.task)
  };
}

function routeCurrentState(state: LeaderGraphState): TaskState | typeof END {
  return state.task.state === 'done' ? END : state.task.state;
}

function routeAfterNode(state: LeaderGraphState): TaskState | typeof END {
  if (state.task.state === 'done' || isPauseState(state.task.state) || shouldStopAfterTestingFallback(state.task)) {
    return END;
  }

  return state.task.state;
}

function shouldStopAfterTestingFallback(task: Task): boolean {
  const lastTransition = task.transitions.at(-1);
  return lastTransition?.from === 'testing' && lastTransition.to === 'developing' && task.validation?.passed === false;
}

function runIntakeNode(task: Task, options: LeaderRunOptions): Task {
  if (task.needsClarification) {
    moveTask(task, advanceState(task.state, { needsClarification: true }), '需求过于模糊，需要老板澄清', 'intake');
    task.approvalRequests.push(createClarificationRequest());
    pauseTask(task, {
      reason: '等待澄清，尚未进入交付阶段',
      requestedInput: '请补充更清晰的目标、范围或约束',
      resumeTargetState: 'planning',
      checkpointSummary: 'clarifying 暂停，等待补充需求信息',
      validation: {
        passed: false,
        summary: '等待澄清，尚未进入交付阶段',
        issues: ['需求描述过短或缺少可执行目标']
      }
    });
    persistTask(task, options);
    return task;
  }

  moveTask(task, advanceState(task.state, { needsClarification: false }), '需求清晰，进入规划', 'intake');
  persistTask(task, options);
  return task;
}

function runClarifyingNode(task: Task, options: LeaderRunOptions): Task {
  clearWaitingState(task);
  moveTask(task, advanceState(task.state), '已补充澄清信息，恢复推进', 'clarifying');
  persistTask(task, options);
  return task;
}

function runPlanningNode(task: Task, options: LeaderRunOptions): Task {
  if (!task.agentRuns.some((run) => run.role === 'pm')) {
    recordAgentOutput(task, runAgent('pm', task.input));
  }

  const routing = decidePlanningRoute(task.input, options);
  const planningNextState = advanceState(task.state, {
    needsMeeting: routing.needsMeeting,
    needsOwnerDecision: routing.needsOwnerDecision,
    isBlocked: routing.isBlocked
  });
  moveTask(task, planningNextState, routing.reason, 'planning');
  persistTask(task, options);

  if (planningNextState === 'blocked') {
    addArtifact(task, createBlockerArtifact(task.input, routing.reason));
    pauseTask(task, {
      reason: '任务受阻，等待解除阻塞',
      requestedInput: '补充缺失依赖、信息或资源后再恢复',
      resumeTargetState: 'planning',
      checkpointSummary: routing.reason,
      validation: {
        passed: false,
        summary: '任务受阻，等待解除阻塞',
        issues: [routing.reason]
      }
    });
    persistTask(task, options);
    return task;
  }

  if (planningNextState === 'awaiting_owner_decision') {
    task.approvalRequests.push(createOwnerDecisionRequest('规划阶段需要老板拍板后再继续'));
    pauseTask(task, {
      reason: '等待老板决策，任务暂停',
      requestedInput: '老板确认范围、优先级或方向',
      resumeTargetState: 'developing',
      checkpointSummary: '规划阶段已完成，等待老板拍板后继续',
      validation: {
        passed: false,
        summary: '等待老板决策，任务暂停',
        issues: ['范围、优先级或方向需要老板确认']
      }
    });
    persistTask(task, options);
  }

  return task;
}

function runMeetingNode(task: Task, options: LeaderRunOptions): Task {
  const meetingNeedsOwnerDecision = options.forceOwnerDecision ?? /老板拍板|老板决策|老板确认/u.test(task.input);
  const roleSummaries = collectMeetingRoleSummaries(task.agentRuns);
  task.latestMeetingResult = createMeetingResult(task.input, roleSummaries, meetingNeedsOwnerDecision);
  addArtifact(task, createMeetingArtifact(task.input, roleSummaries, meetingNeedsOwnerDecision));

  const postMeetingState = advanceState(task.state, { needsOwnerDecision: meetingNeedsOwnerDecision, isBlocked: false });
  moveTask(task, postMeetingState, meetingNeedsOwnerDecision ? '会议结论要求老板拍板' : '会议结论明确，可进入开发', 'meeting');
  persistTask(task, options);

  if (postMeetingState === 'awaiting_owner_decision') {
    task.approvalRequests.push(createOwnerDecisionRequest('会议已形成方案，但需老板最终拍板'));
    pauseTask(task, {
      reason: '会议已完成，等待老板决策',
      requestedInput: '老板最终拍板',
      resumeTargetState: 'developing',
      checkpointSummary: '会议已形成方案，等待老板最终决策',
      validation: {
        passed: false,
        summary: '会议已完成，等待老板决策',
        issues: ['会议结论涉及老板拍板项']
      }
    });
    persistTask(task, options);
  }

  return task;
}

function runDevelopingNode(task: Task, options: LeaderRunOptions): Task {
  const retryAfterFailedValidation = hasFailedValidation(task);

  if (!task.agentRuns.some((run) => run.role === 'architect')) {
    recordAgentOutput(task, runAgent('architect', task.input));
  }
  if (!task.agentRuns.some((run) => run.role === 'developer') || retryAfterFailedValidation) {
    recordAgentOutput(task, runAgent('developer', task.input));
  }

  moveTask(task, advanceState(task.state), '开发占位产物已生成，进入测试', 'developing');
  persistTask(task, options);
  return task;
}

function runTestingNode(task: Task, options: LeaderRunOptions): Task {
  const retryAfterFailedValidation = hasFailedValidation(task);

  if (!task.agentRuns.some((run) => run.role === 'qa') || retryAfterFailedValidation) {
    recordAgentOutput(task, runAgent('qa', task.input));
  }

  task.testCommandResolution = resolveVerificationCommand(options);
  const validation = validatePrototype(task, options);
  task.validation = validation;
  const testingNextState = advanceState(task.state, { validationResult: validation });
  moveTask(task, testingNextState, validation.summary, 'testing');
  persistTask(task, options);

  if (testingNextState === 'developing') {
    task.deliveryReport = buildDeliveryReport(task, validation);
    persistTask(task, options);
  }

  return task;
}

function runReportingNode(task: Task, options: LeaderRunOptions): Task {
  addArtifact(
    task,
    createArtifact('delivery_summary', '交付摘要', 'leader', `已完成最小闭环：规划、开发、测试、汇报。输入需求：${task.input}`)
  );

  const reportingNeedsOwnerDecision = shouldWaitForOwnerDecisionAtReporting(task.input, options);
  const postReportingState = advanceState(task.state, { needsOwnerDecision: reportingNeedsOwnerDecision });
  moveTask(task, postReportingState, reportingNeedsOwnerDecision ? '汇报涉及老板最终拍板' : '汇报完成，任务结束', 'reporting');

  if (postReportingState === 'awaiting_owner_decision') {
    task.approvalRequests.push(createOwnerDecisionRequest('汇报阶段需要老板确认是否按当前方案交付'));
    pauseTask(task, {
      reason: '已完成汇报，等待老板最终决策',
      requestedInput: '老板确认是否按当前方案交付',
      resumeTargetState: 'done',
      checkpointSummary: '汇报产物已生成，等待最终交付确认',
      validation: {
        passed: false,
        summary: '已完成汇报，等待老板最终决策',
        issues: ['交付前仍需老板确认']
      }
    });
    persistTask(task, options);
    return task;
  }

  clearWaitingState(task);
  task.deliveryReport = buildDeliveryReport(task, task.validation ?? {
    passed: true,
    summary: '已完成默认验证',
    issues: []
  });
  persistTask(task, options);
  return task;
}

function runAwaitingOwnerDecisionNode(task: Task, options: LeaderRunOptions): Task {
  const pauseOrigin = getLastTransition(task)?.from;
  clearWaitingState(task);

  if (pauseOrigin === 'reporting') {
    moveTask(task, 'done', '老板已批准汇报结果，任务完成', 'awaiting_owner_decision');
    task.deliveryReport = buildDeliveryReport(task, task.validation ?? {
      passed: true,
      summary: '老板批准后完成交付',
      issues: []
    });
    persistTask(task, options);
    return task;
  }

  moveTask(task, 'developing', '老板已批准，进入安全下一步开发', 'awaiting_owner_decision');
  persistTask(task, options);
  return task;
}

function runBlockedNode(task: Task, options: LeaderRunOptions): Task {
  clearWaitingState(task);
  moveTask(task, 'planning', '阻塞已解除，回到 planning 重新推进', 'blocked');
  persistTask(task, options);
  return task;
}

function validatePrototype(task: Task, options: LeaderRunOptions): ValidationResult {
  const hasPlan = task.artifacts.some((artifact) => artifact.kind === 'implementation_plan');
  const hasCodeSummary = task.artifacts.some((artifact) => artifact.kind === 'code_summary');
  const hasTestReport = task.artifacts.some((artifact) => artifact.kind === 'test_report');
  const hasRequiredArtifacts = hasPlan && hasCodeSummary && hasTestReport;
  const resolution = task.testCommandResolution ?? resolveVerificationCommand(options);
  const verificationResults = runVerificationScripts(options);
  const passed = hasRequiredArtifacts && !resolution.blocked && Boolean(resolution.command) && verificationResults.every((result) => result.ok && !result.blocked);
  const missingArtifactIssues = hasRequiredArtifacts ? [] : ['缺少必要的计划、实现或测试产物'];
  const commandIssues = resolution.blocked || !resolution.command ? [`测试命令 blocked: ${resolution.reason}`] : [];
  const verificationIssues = verificationResults.filter((result) => !result.ok || result.blocked).map((result) => result.summary);

  return {
    passed,
    summary: passed ? '基础验证通过，进入汇报' : '基础验证失败，回流开发补齐产物',
    issues: passed ? [] : [...missingArtifactIssues, ...commandIssues, ...verificationIssues]
  };
}

function runVerificationScripts(options: LeaderRunOptions) {
  const resolution = resolveVerificationCommand(options);

  if (resolution.blocked || !resolution.command) {
    return [
      {
        script: resolution.command,
        ok: false,
        blocked: true,
        summary: resolution.reason
      }
    ];
  }

  const runner = options.runner ?? createSafeScriptRunner({ ...(options.packageJsonPath ? { packageJsonPath: options.packageJsonPath } : {}) });
  return [runner.runScript(resolution.command)];
}

function recordAgentOutput(task: Task, output: AgentRunOutput): void {
  addArtifact(task, output.artifact);
  const agentRun: AgentRun = {
    id: createId('run'),
    role: output.role,
    summary: output.summary,
    producedArtifactIds: [output.artifact.id]
  };
  task.agentRuns.push(agentRun);
}

function collectMeetingRoleSummaries(agentRuns: AgentRun[]): MeetingRoleSummaries {
  const roleSummaries: MeetingRoleSummaries = {};

  for (const run of agentRuns) {
    if (run.role !== 'leader') {
      roleSummaries[run.role] = run.summary;
    }
  }

  return roleSummaries;
}

function moveTask(task: Task, nextState: TaskState, reason: string, node: TaskState): void {
  assertValidTransition(task.state, nextState);
  const transition: StateTransition = {
    from: task.state,
    to: nextState,
    reason,
    executionRule: `langgraph:${node}`
  };
  task.transitions.push(transition);
  task.state = nextState;
}

function getLastTransition(task: Task): StateTransition | undefined {
  return task.transitions.at(-1);
}

function createClarificationRequest(): ApprovalRequest {
  return {
    id: createId('approval'),
    reason: '请老板补充更清晰的交付目标、范围或约束',
    requestedBy: 'leader',
    status: 'pending'
  };
}

function decidePlanningRoute(input: string, options: LeaderRunOptions): {
  needsMeeting: boolean;
  needsOwnerDecision: boolean;
  isBlocked: boolean;
  reason: string;
} {
  const needsMeeting = options.forceMeeting ?? /会议|评审|同步/u.test(input);
  const needsOwnerDecision = options.forceOwnerDecision ?? /老板拍板|老板决策|老板确认/u.test(input);
  const isBlocked = options.forceBlocked ?? /阻塞|blocked|依赖缺失|缺少依赖/u.test(input);

  if (isBlocked) {
    return {
      needsMeeting,
      needsOwnerDecision,
      isBlocked,
      reason: '存在外部依赖缺失或阻塞条件，暂时无法继续'
    };
  }

  if (needsMeeting) {
    return {
      needsMeeting,
      needsOwnerDecision,
      isBlocked,
      reason: '规划阶段识别到需要先开会对齐'
    };
  }

  if (needsOwnerDecision) {
    return {
      needsMeeting,
      needsOwnerDecision,
      isBlocked,
      reason: '规划阶段存在需要老板拍板的关键选项'
    };
  }

  return {
    needsMeeting,
    needsOwnerDecision,
    isBlocked,
    reason: '规划完成，进入开发'
  };
}

function createBlockerArtifact(input: string, reason: string): Artifact {
  return createArtifact(
    'blocker_report',
    '阻塞说明',
    'leader',
    JSON.stringify(
      {
        taskInput: input,
        blocker: reason,
        actionNeeded: '等待外部依赖、信息或资源解除阻塞'
      },
      null,
      2
    )
  );
}

function createOwnerDecisionRequest(reason: string): ApprovalRequest {
  return {
    id: createId('approval'),
    reason,
    requestedBy: 'leader',
    status: 'pending'
  };
}

function shouldWaitForOwnerDecisionAtReporting(input: string, options: LeaderRunOptions): boolean {
  return Boolean(options.forceOwnerDecision && !options.forceMeeting && /最终确认|最终拍板/u.test(input));
}

function persistTask(task: Task, options: LeaderRunOptions): void {
  options.store?.save(task);
}

function pauseTask(
  task: Task,
  options: {
    reason: string;
    requestedInput: string;
    resumeTargetState: TaskState;
    checkpointSummary: string;
    validation: ValidationResult;
  }
): void {
  setWaitingSummary(task, {
    reason: options.reason,
    requestedInput: options.requestedInput,
    resumeTargetState: options.resumeTargetState
  });
  task.checkpoint = createCheckpoint(task, options.checkpointSummary);
  task.deliveryReport = buildDeliveryReport(task, options.validation);
}

function resolveVerificationCommand(options: LeaderRunOptions): TestCommandResolution {
  return resolveTestCommand({
    ...(options.verificationScripts?.[0] ? { userCommand: options.verificationScripts[0] } : {}),
    ...(options.repoConfigVerificationScript ? { repoConfigCommand: options.repoConfigVerificationScript } : {}),
    ...(options.packageJsonPath ? { packageJsonPath: options.packageJsonPath } : {})
  });
}

function hasFailedValidation(task: Task): boolean {
  return task.validation?.passed === false;
}

function hasFailedValidationPause(task: Task): boolean {
  return task.state === 'developing' && task.validation?.passed === false;
}
