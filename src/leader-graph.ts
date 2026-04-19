import { Annotation, END, START, StateGraph } from '@langchain/langgraph';

import type {
  AgentRun,
  ApprovalRequest,
  Artifact,
  LeaderRunResult,
  MeetingInput,
  RiskSignal,
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
  captureTaskContextArtifacts,
  clearWaitingState,
  createArtifact,
  createCheckpoint,
  createId,
  createLoopbackArtifact,
  setWaitingSummary
} from './artifacts.js';
import { resolveExternalExecutor, type ExecutorArtifacts, type ExecutorPhase, type ExecutorRoleOutput, type ExecutorRunStatus, type ExecutorTaskInput } from './executors/index.js';
import { createMeetingArtifact, createMeetingResult, type MeetingRoleSummaries } from './meeting.js';
import { parsePatchProposal } from './patch-proposal.js';
import { applyWorkspaceChanges } from './repo.js';
import { classifyRisk, collectInputRiskSignals, collectTaskRiskSignals, shouldRequestOwnerDecision } from './risk.js';
import { createSafeScriptRunner, resolveTestCommand } from './runner.js';
import type { LeaderRunOptions } from './leader.js';
import { hasConfiguredLlmProvider } from './llm/index.js';
import { advanceState, assertValidTransition, isPauseState } from './workflow.js';
import type { AgentExecutionOptions, AgentRunInput } from './agents/index.js';

const LeaderGraphAnnotation = Annotation.Root({
  task: Annotation<Task>(),
  options: Annotation<LeaderRunOptions>()
});

type LeaderGraphState = typeof LeaderGraphAnnotation.State;

const leaderGraph = new StateGraph(LeaderGraphAnnotation)
  .addNode('intake', async (state) => ({ task: runIntakeNode(state.task, state.options) }))
  .addNode('clarifying', async (state) => ({ task: runClarifyingNode(state.task, state.options) }))
  .addNode('planning', async (state) => ({ task: await runPlanningNode(state.task, state.options) }))
  .addNode('meeting', async (state) => ({ task: runMeetingNode(state.task, state.options) }))
  .addNode('developing', async (state) => ({ task: await runDevelopingNode(state.task, state.options) }))
  .addNode('testing', async (state) => ({ task: await runTestingNode(state.task, state.options) }))
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

async function runPlanningNode(task: Task, options: LeaderRunOptions): Promise<Task> {
  const useLegacyExecution = shouldUseLegacyExecution(options);
  const shouldRunPm = !task.agentRuns.some((run) => run.role === 'pm')
    || hasArtifactUpdateSince(task, ['requirements_brief'], ['implementation_plan']);

  if (useLegacyExecution && shouldRunPm) {
    if (task.agentRuns.some((run) => run.role === 'pm')) {
      addArtifact(
        task,
        createLoopbackArtifact('requirements_changed', '需求变化回流', 'leader', {
          fromState: task.state,
          toState: 'planning',
          reason: '老板补充说明已更新，需重新经过 PM / planning'
        })
      );
    }

    await runAndRecordAgent(task, 'pm', 'planning', '输出可执行实施计划并识别审批需求', options);
  }

  if (!useLegacyExecution && shouldRunPm) {
    if (task.artifacts.some((artifact) => artifact.kind === 'implementation_plan')) {
      addArtifact(
        task,
        createLoopbackArtifact('requirements_changed', '需求变化回流', 'leader', {
          fromState: task.state,
          toState: 'planning',
          reason: '老板补充说明已更新，需重新生成治理层执行计划'
        })
      );
    }

    addArtifact(task, createGovernancePlanArtifact(task));
  }

  const pmDecision = useLegacyExecution ? getLatestRoleRun(task, 'pm') : undefined;
  const routing = decidePlanningRoute(
    task.input,
    options,
    pmDecision,
    getLatestApprovalStatus(task) === 'changes_requested'
  );
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
    const resumeTargetState = getOwnerDecisionResumeTarget(routing.approvalTrigger ?? 'role_requested_owner_decision');
    task.approvalRequests.push(
      createOwnerDecisionRequest(
        routing.reason,
        routing.approvalTrigger ?? 'role_requested_owner_decision',
        routing.approvalRiskLevel
      )
    );
    pauseTask(task, {
      reason: '等待老板决策，任务暂停',
      requestedInput: '老板确认范围、优先级或方向',
      resumeTargetState,
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
  const meetingInput = createMeetingInput(task, options);
  const meetingResult = createMeetingResult(meetingInput);
  task.latestMeetingResult = meetingResult;
  addArtifact(task, createMeetingArtifact(meetingInput, meetingResult));

  const postMeetingState = advanceState(task.state, {
    needsOwnerDecision: meetingResult.needsOwnerDecision,
    isBlocked: meetingResult.nextStep === 'blocked'
  });
  moveTask(task, postMeetingState, meetingResult.decisionReason, 'meeting');
  persistTask(task, options);

  if (postMeetingState === 'blocked') {
    pauseTask(task, {
      reason: '会议确认存在阻塞条件，等待解除后再继续',
      requestedInput: '请补齐缺失依赖或确认替代方案后恢复',
      resumeTargetState: 'planning',
      checkpointSummary: 'meeting 结论为 blocked，等待阻塞解除',
      validation: {
        passed: false,
        summary: '会议识别到阻塞条件，任务暂停',
        issues: meetingResult.risks.length > 0 ? meetingResult.risks : ['会议结论为 blocked']
      }
    });
    persistTask(task, options);
    return task;
  }

  if (postMeetingState === 'awaiting_owner_decision') {
    const approvalTrigger = 'multi_option_direction_change' as const;
    task.approvalRequests.push(
      createOwnerDecisionRequest(
        '会议已形成方案，但需老板最终拍板',
        approvalTrigger,
        classifyRisk(collectTaskRiskSignals(task))
      )
    );
    pauseTask(task, {
      reason: '会议已完成，等待老板决策',
      requestedInput: meetingResult.ownerQuestion ?? '老板最终拍板',
      resumeTargetState: getOwnerDecisionResumeTarget(approvalTrigger),
      checkpointSummary: '会议已形成方案，等待老板最终决策',
      validation: {
        passed: false,
        summary: '会议已完成，等待老板决策',
        issues: meetingResult.risks.length > 0 ? meetingResult.risks : ['会议结论涉及老板拍板项']
      }
    });
    persistTask(task, options);
  }

  return task;
}

async function runDevelopingNode(task: Task, options: LeaderRunOptions): Promise<Task> {
  if (!shouldUseLegacyExecution(options)) {
    return runExternalDevelopingNode(task, options);
  }

  return runLegacyDevelopingNode(task, options);
}

async function runLegacyDevelopingNode(task: Task, options: LeaderRunOptions): Promise<Task> {
  const retryAfterFailedValidation = hasFailedValidation(task);
  const shouldRunArchitect = !task.agentRuns.some((run) => run.role === 'architect')
    || hasArtifactUpdateSince(task, ['implementation_plan'], ['architecture_note']);
  const shouldRunDeveloper = !task.agentRuns.some((run) => run.role === 'developer')
    || retryAfterFailedValidation
    || hasArtifactUpdateSince(task, ['implementation_plan', 'architecture_note', 'loopback_note'], ['code_summary', 'patch_proposal']);

  if (shouldRunArchitect) {
    await runAndRecordAgent(task, 'architect', 'developing', '给出架构实现边界与方案', options);
  }
  if (shouldRunDeveloper) {
    await runAndRecordAgent(
      task,
      'developer',
      'developing',
      retryAfterFailedValidation ? '根据失败验证结果补齐实现' : '完成当前实现任务',
      options
    );
  }

  const developmentEscalation = getRoleEscalationDecision(task, ['architect', 'developer']);
  if (developmentEscalation?.type === 'meeting') {
    addArtifact(
      task,
      createLoopbackArtifact('solution_conflict', '方案冲突回流', 'leader', {
        fromState: 'developing',
        toState: 'meeting',
        reason: developmentEscalation.reason
      })
    );
    moveTask(task, 'meeting', developmentEscalation.reason, 'developing');
    persistTask(task, options);
    return task;
  }

  if (developmentEscalation?.type === 'owner_decision') {
    task.approvalRequests.push(
      createOwnerDecisionRequest(developmentEscalation.reason, 'role_requested_owner_decision', 'high')
    );
    moveTask(task, 'awaiting_owner_decision', developmentEscalation.reason, 'developing');
    addArtifact(
      task,
      createLoopbackArtifact('risk_escalated', '风险升级回流', 'leader', {
        fromState: 'developing',
        toState: 'awaiting_owner_decision',
        reason: developmentEscalation.reason
      })
    );
    pauseTask(task, {
      reason: '开发阶段风险升级，等待老板决策',
      requestedInput: '请老板确认是否继续当前实现方向',
      resumeTargetState: 'developing',
      checkpointSummary: developmentEscalation.reason,
      validation: task.validation ?? {
        passed: false,
        summary: '开发阶段风险升级，等待老板决策',
        issues: [developmentEscalation.reason]
      }
    });
    persistTask(task, options);
    return task;
  }

  const latestArtifact = getLatestArtifact(task, (artifact) => artifact.kind === 'patch_proposal');
  if (latestArtifact?.kind === 'patch_proposal') {
    const workspaceRoot = options.workspaceRoot ?? process.cwd();
    const proposal = parsePatchProposal(latestArtifact.content, workspaceRoot);
    applyWorkspaceChanges(workspaceRoot, proposal.changes);
  }

  moveTask(task, advanceState(task.state), '开发占位产物已生成，进入测试', 'developing');
  persistTask(task, options);
  return task;
}

async function runTestingNode(task: Task, options: LeaderRunOptions): Promise<Task> {
  if (!shouldUseLegacyExecution(options)) {
    return runExternalTestingNode(task, options);
  }

  return runLegacyTestingNode(task, options);
}

async function runLegacyTestingNode(task: Task, options: LeaderRunOptions): Promise<Task> {
  const retryAfterFailedValidation = hasFailedValidation(task);
  const shouldRunQa = !task.agentRuns.some((run) => run.role === 'qa')
    || retryAfterFailedValidation
    || hasArtifactUpdateSince(task, ['code_summary', 'patch_proposal', 'loopback_note'], ['test_report']);

  if (shouldRunQa) {
    await runAndRecordAgent(task, 'qa', 'testing', '执行验证并给出测试结论', options);
  }

  task.testCommandResolution = resolveVerificationCommand(options);
  const validation = validatePrototype(task, options);
  task.validation = validation;
  const testingEscalation = getRoleEscalationDecision(task, ['qa']);
  const testingNextState = advanceState(task.state, {
    validationResult: validation,
    needsMeeting: testingEscalation?.type === 'meeting',
    needsOwnerDecision: testingEscalation?.type === 'owner_decision'
  });
  moveTask(
    task,
    testingNextState,
    testingEscalation?.reason ?? validation.summary,
    'testing'
  );
  persistTask(task, options);

  if (testingNextState === 'meeting') {
    addArtifact(
      task,
      createLoopbackArtifact('solution_conflict', '测试阶段方案冲突回流', 'leader', {
        fromState: 'testing',
        toState: 'meeting',
        reason: testingEscalation?.reason ?? '测试阶段识别到方案冲突，需回到会议对齐'
      })
    );
    persistTask(task, options);
    return task;
  }

  if (testingNextState === 'awaiting_owner_decision') {
    const escalationReason = testingEscalation?.reason ?? '测试阶段风险升级，需老板确认';
    task.approvalRequests.push(createOwnerDecisionRequest(escalationReason, 'role_requested_owner_decision', 'high'));
    addArtifact(
      task,
      createLoopbackArtifact('risk_escalated', '测试阶段风险升级', 'leader', {
        fromState: 'testing',
        toState: 'awaiting_owner_decision',
        reason: escalationReason
      })
    );
    pauseTask(task, {
      reason: '测试阶段风险升级，等待老板决策',
      requestedInput: '请老板确认是否接受当前风险并继续推进',
      resumeTargetState: 'developing',
      checkpointSummary: escalationReason,
      validation: {
        passed: false,
        summary: '测试阶段风险升级，等待老板决策',
        issues: [escalationReason]
      }
    });
    persistTask(task, options);
    return task;
  }

  if (testingNextState === 'developing') {
    addArtifact(
      task,
      createLoopbackArtifact('testing_failed', '测试失败回流', 'leader', {
        fromState: 'testing',
        toState: 'developing',
        reason: validation.summary,
        issues: validation.issues
      })
    );
    task.deliveryReport = buildDeliveryReport(task, validation);
    persistTask(task, options);
  }

  return task;
}

async function runExternalDevelopingNode(task: Task, options: LeaderRunOptions): Promise<Task> {
  const retryAfterFailedValidation = hasFailedValidation(task);
  const shouldDispatchExecution = !task.agentRuns.some((run) => run.role === 'developer')
    || retryAfterFailedValidation
    || hasArtifactUpdateSince(task, ['implementation_plan', 'loopback_note'], ['code_summary', 'architecture_note']);

  if (shouldDispatchExecution) {
    const execution = await runExternalExecutorPhase(
      task,
      'developing',
      retryAfterFailedValidation ? '根据失败验证结果补齐实现' : '完成当前实现任务',
      options
    );

    if (execution.status.state === 'blocked' || execution.status.state === 'failed') {
      return handleExternalExecutorFailure(task, execution.status, 'developing', options);
    }
  }

  const developmentEscalation = getRoleEscalationDecision(task, ['architect', 'developer']);
  if (developmentEscalation?.type === 'meeting') {
    addArtifact(
      task,
      createLoopbackArtifact('solution_conflict', '方案冲突回流', 'leader', {
        fromState: 'developing',
        toState: 'meeting',
        reason: developmentEscalation.reason
      })
    );
    moveTask(task, 'meeting', developmentEscalation.reason, 'developing');
    persistTask(task, options);
    return task;
  }

  if (developmentEscalation?.type === 'owner_decision') {
    task.approvalRequests.push(
      createOwnerDecisionRequest(developmentEscalation.reason, 'role_requested_owner_decision', 'high')
    );
    moveTask(task, 'awaiting_owner_decision', developmentEscalation.reason, 'developing');
    addArtifact(
      task,
      createLoopbackArtifact('risk_escalated', '风险升级回流', 'leader', {
        fromState: 'developing',
        toState: 'awaiting_owner_decision',
        reason: developmentEscalation.reason
      })
    );
    pauseTask(task, {
      reason: '开发阶段风险升级，等待老板决策',
      requestedInput: '请老板确认是否继续当前实现方向',
      resumeTargetState: 'developing',
      checkpointSummary: developmentEscalation.reason,
      validation: task.validation ?? {
        passed: false,
        summary: '开发阶段风险升级，等待老板决策',
        issues: [developmentEscalation.reason]
      }
    });
    persistTask(task, options);
    return task;
  }

  moveTask(task, advanceState(task.state), '外部执行器已返回开发产物，进入测试', 'developing');
  persistTask(task, options);
  return task;
}

async function runExternalTestingNode(task: Task, options: LeaderRunOptions): Promise<Task> {
  const retryAfterFailedValidation = hasFailedValidation(task);
  const shouldDispatchExecution = !task.agentRuns.some((run) => run.role === 'qa')
    || retryAfterFailedValidation
    || hasArtifactUpdateSince(task, ['code_summary', 'architecture_note', 'loopback_note'], ['test_report']);

  let validation = task.validation ?? validateExternalPrototype(task);

  if (shouldDispatchExecution) {
    const execution = await runExternalExecutorPhase(task, 'testing', '执行验证并给出测试结论', options);

    if (execution.status.state === 'blocked' || execution.status.state === 'failed') {
      return handleExternalExecutorFailure(task, execution.status, 'testing', options);
    }

    task.testCommandResolution = createExternalExecutorResolution(execution.status.executor);
    validation = validateExternalPrototype(task, execution.artifacts);
  } else {
    task.testCommandResolution = task.testCommandResolution ?? createExternalExecutorResolution(resolveExternalExecutor(options.executor).name);
  }

  task.validation = validation;
  const testingEscalation = getRoleEscalationDecision(task, ['qa']);
  const testingNextState = advanceState(task.state, {
    validationResult: validation,
    needsMeeting: testingEscalation?.type === 'meeting',
    needsOwnerDecision: testingEscalation?.type === 'owner_decision'
  });
  moveTask(task, testingNextState, testingEscalation?.reason ?? validation.summary, 'testing');
  persistTask(task, options);

  if (testingNextState === 'meeting') {
    addArtifact(
      task,
      createLoopbackArtifact('solution_conflict', '测试阶段方案冲突回流', 'leader', {
        fromState: 'testing',
        toState: 'meeting',
        reason: testingEscalation?.reason ?? '测试阶段识别到方案冲突，需回到会议对齐'
      })
    );
    persistTask(task, options);
    return task;
  }

  if (testingNextState === 'awaiting_owner_decision') {
    const escalationReason = testingEscalation?.reason ?? '测试阶段风险升级，需老板确认';
    task.approvalRequests.push(createOwnerDecisionRequest(escalationReason, 'role_requested_owner_decision', 'high'));
    addArtifact(
      task,
      createLoopbackArtifact('risk_escalated', '测试阶段风险升级', 'leader', {
        fromState: 'testing',
        toState: 'awaiting_owner_decision',
        reason: escalationReason
      })
    );
    pauseTask(task, {
      reason: '测试阶段风险升级，等待老板决策',
      requestedInput: '请老板确认是否接受当前风险并继续推进',
      resumeTargetState: 'developing',
      checkpointSummary: escalationReason,
      validation: {
        passed: false,
        summary: '测试阶段风险升级，等待老板决策',
        issues: [escalationReason]
      }
    });
    persistTask(task, options);
    return task;
  }

  if (testingNextState === 'developing') {
    addArtifact(
      task,
      createLoopbackArtifact('testing_failed', '测试失败回流', 'leader', {
        fromState: 'testing',
        toState: 'developing',
        reason: validation.summary,
        issues: validation.issues
      })
    );
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
    task.approvalRequests.push(
      createOwnerDecisionRequest('汇报阶段需要老板确认是否按当前方案交付', 'report_confirmation', 'medium')
    );
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
  captureTaskContextArtifacts(task, { title: '任务完成上下文摘要', reason: '任务进入 done' });
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
  const resumeTargetState = task.waitingSummary?.resumeTargetState;
  const latestApprovalStatus = getLatestApprovalStatus(task);
  clearWaitingState(task);

  if (latestApprovalStatus === 'rejected') {
    moveTask(task, 'blocked', '老板驳回当前方案，等待新的方向或约束', 'awaiting_owner_decision');
    addArtifact(
      task,
      createLoopbackArtifact('requirements_changed', '老板驳回后的回流', 'leader', {
        fromState: 'awaiting_owner_decision',
        toState: 'blocked',
        reason: '老板驳回当前方案，需补充新的方向、范围或约束'
      })
    );
    pauseTask(task, {
      reason: '老板已驳回当前方案，等待新的方向或约束',
      requestedInput: '请补充新的方向、范围或约束后再恢复推进',
      resumeTargetState: 'planning',
      checkpointSummary: '老板驳回当前方案，任务回到 blocked 等待新输入',
      validation: {
        passed: false,
        summary: '老板已驳回当前方案，等待新的方向或约束',
        issues: ['当前方案已被驳回，需重新规划']
      }
    });
    persistTask(task, options);
    return task;
  }

  if (latestApprovalStatus === 'changes_requested') {
    moveTask(task, 'planning', '老板要求补充修改后重新规划', 'awaiting_owner_decision');
    addArtifact(
      task,
      createLoopbackArtifact('requirements_changed', '老板要求补充修改', 'leader', {
        fromState: 'awaiting_owner_decision',
        toState: 'planning',
        reason: '老板提出补充修改意见，需回到 planning 重新收敛方案'
      })
    );
    persistTask(task, options);
    return task;
  }

  if (pauseOrigin === 'reporting' || resumeTargetState === 'done') {
    moveTask(task, 'done', '老板已批准汇报结果，任务完成', 'awaiting_owner_decision');
    captureTaskContextArtifacts(task, { title: '老板批准后的完成摘要', reason: '审批完成，任务结束' });
    task.deliveryReport = buildDeliveryReport(task, task.validation ?? {
      passed: true,
      summary: '老板批准后完成交付',
      issues: []
    });
    persistTask(task, options);
    return task;
  }

  if (latestApprovalStatus === 'approved' && resumeTargetState === 'planning') {
    task.input = normalizeTaskInputAfterOwnerApproval(task.input);
    addArtifact(
      task,
      createArtifact('requirements_brief', '老板批准后的方向确认', 'leader', '老板已对方向/范围做出确认，任务回到 planning 继续推进')
    );
  }

  moveTask(task, resumeTargetState ?? 'developing', '老板已批准，进入安全下一步开发', 'awaiting_owner_decision');
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
  const hasCodeSummary = task.artifacts.some((artifact) => artifact.kind === 'code_summary' || artifact.kind === 'patch_proposal');
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

async function runExternalExecutorPhase(
  task: Task,
  phase: ExecutorPhase,
  requestedOutcome: string,
  options: LeaderRunOptions
): Promise<{ status: ExecutorRunStatus; artifacts?: ExecutorArtifacts }> {
  const executor = resolveExternalExecutor(options.executor);
  const input = createExecutorTaskInput(task, phase, requestedOutcome);
  addArtifact(
    task,
    createArtifact(
      'executor_request',
      `外部执行请求 (${phase})`,
      'leader',
      JSON.stringify(
        {
          executor: executor.name,
          phase,
          requestedOutcome,
          contextSummary: input.contextSummary,
          riskSignals: input.riskSignals
        },
        null,
        2
      )
    )
  );

  const submission = await executor.submitTask(input);
  task.executorSession = {
    executor: submission.executor,
    runId: submission.runId,
    phase: submission.phase,
    status: 'submitted',
    summary: submission.summary
  };

  const status = await executor.pollRun(submission.runId);
  task.executorSession = {
    executor: status.executor,
    runId: status.runId,
    phase: status.phase,
    status: status.state,
    summary: status.summary
  };
  addArtifact(
    task,
    createArtifact(
      'executor_result',
      `外部执行状态 (${phase})`,
      'leader',
      JSON.stringify(status, null, 2)
    )
  );

  if (status.state !== 'completed') {
    return { status };
  }

  const artifacts = await executor.collectArtifacts(submission.runId);
  addArtifact(
    task,
    createArtifact(
      'executor_result',
      `外部执行结果 (${phase})`,
      'leader',
      JSON.stringify(
        {
          summary: artifacts.summary,
          links: artifacts.links ?? []
        },
        null,
        2
      )
    )
  );

  for (const roleOutput of artifacts.roleOutputs) {
    recordExecutorRoleOutput(task, roleOutput);
  }

  return { status, artifacts };
}

function recordExecutorRoleOutput(task: Task, output: ExecutorRoleOutput): void {
  const artifact = createArtifact(output.artifact.kind, output.artifact.title, output.role, output.artifact.content);
  recordAgentOutput(task, {
    role: output.role,
    summary: output.summary,
    confidence: output.confidence,
    riskLevel: output.riskLevel,
    risks: output.risks,
    needsOwnerDecision: output.needsOwnerDecision,
    nextAction: output.nextAction,
    artifact,
    ...(output.failureReason ? { failureReason: output.failureReason } : {})
  });
  addArtifact(
    task,
    createArtifact(
      'role_output',
      `${output.role} 输出快照`,
      output.role,
      JSON.stringify(
        {
          summary: output.summary,
          confidence: output.confidence,
          riskLevel: output.riskLevel,
          risks: output.risks,
          needsOwnerDecision: output.needsOwnerDecision,
          nextAction: output.nextAction
        },
        null,
        2
      )
    )
  );
}

function createExecutorTaskInput(task: Task, phase: ExecutorPhase, requestedOutcome: string): ExecutorTaskInput {
  const riskSignals = collectTaskRiskSignals(task);

  return {
    taskId: task.id,
    taskSummary: task.input,
    phase,
    currentStatus: task.state,
    artifacts: task.artifacts,
    contextSummary: summarizeTaskContext(task, riskSignals),
    riskSignals,
    requestedOutcome
  };
}

function handleExternalExecutorFailure(
  task: Task,
  status: ExecutorRunStatus,
  currentNode: TaskState,
  options: LeaderRunOptions
): Task {
  const reason = status.blockingReason ?? status.failureReason ?? '外部执行器未能完成当前阶段';
  moveTask(task, 'blocked', reason, currentNode);
  addArtifact(task, createBlockerArtifact(task.input, reason));
  pauseTask(task, {
    reason: '外部执行器未能继续推进，等待补充信息或切换执行策略',
    requestedInput: '请补充执行约束、修正配置或切换执行器后再恢复',
    resumeTargetState: 'planning',
    checkpointSummary: reason,
    validation: {
      passed: false,
      summary: '外部执行器未能继续推进，任务暂停',
      issues: [reason]
    }
  });
  persistTask(task, options);
  return task;
}

function validateExternalPrototype(task: Task, executionArtifacts?: ExecutorArtifacts): ValidationResult {
  if (executionArtifacts?.validation) {
    return executionArtifacts.validation;
  }

  const hasPlan = task.artifacts.some((artifact) => artifact.kind === 'implementation_plan');
  const hasCodeSummary = task.artifacts.some((artifact) => artifact.kind === 'code_summary');
  const hasTestReport = task.artifacts.some((artifact) => artifact.kind === 'test_report');
  const passed = hasPlan && hasCodeSummary && hasTestReport;

  return {
    passed,
    summary: passed ? '外部执行器验证通过，进入汇报' : '外部执行器验证失败，回流开发补齐产物',
    issues: passed ? [] : ['缺少计划、实现或测试产物，无法形成完整外部执行闭环']
  };
}

function createExternalExecutorResolution(executorName: string): TestCommandResolution {
  return {
    command: `executor:${executorName}`,
    source: 'unknown',
    reason: `验证由外部执行器 ${executorName} 执行`,
    blocked: false
  };
}

function createGovernancePlanArtifact(task: Task): Artifact {
  return createArtifact(
    'implementation_plan',
    'Leader 执行计划',
    'leader',
    JSON.stringify(
      {
        goal: task.input,
        executionModel: 'external_executor',
        nextSteps: [
          '由 Leader 先完成治理判断与风险筛查',
          '将开发执行委托给接入的外部执行器',
          '回收开发、测试、PR 或摘要产物',
          '根据结果决定汇报、回流或审批'
        ],
        knownRisks: collectInputRiskSignals(task.input).map((signal) => signal.description)
      },
      null,
      2
    )
  );
}

function recordAgentOutput(task: Task, output: AgentRunOutput): void {
  addArtifact(task, output.artifact);
  const agentRun: AgentRun = {
    id: createId('run'),
    role: output.role,
    summary: output.summary,
    confidence: output.confidence,
    riskLevel: output.riskLevel,
    risks: output.risks,
    needsOwnerDecision: output.needsOwnerDecision,
    nextAction: output.nextAction,
    ...(output.failureReason ? { failureReason: output.failureReason } : {}),
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

function createMeetingInput(task: Task, options: LeaderRunOptions): MeetingInput {
  const roleOutputs = collectMeetingRoleOutputs(task.agentRuns);
  const knownRisks = collectKnownRisks(task.agentRuns);
  const defaultOwnerSignal = options.forceOwnerDecision ?? /老板拍板|老板决策|老板确认/u.test(task.input);
  const ownerConstraints = defaultOwnerSignal ? ['请老板确认范围、优先级与交付方向'] : [];

  return {
    topic: task.input,
    triggerReason: getLastTransition(task)?.reason ?? 'planning 识别到需要会议对齐',
    roleOutputs,
    knownRisks,
    ownerConstraints
  };
}

function collectMeetingRoleOutputs(agentRuns: AgentRun[]): MeetingInput['roleOutputs'] {
  const roleOutputs: MeetingInput['roleOutputs'] = {};

  for (const run of agentRuns) {
    if (run.role === 'leader') {
      continue;
    }

    roleOutputs[run.role] = {
      summary: run.summary,
      riskLevel: run.riskLevel ?? 'low',
      risks: run.risks ?? [],
      needsOwnerDecision: run.needsOwnerDecision ?? false,
      nextAction: run.nextAction ?? 'continue'
    };
  }

  return roleOutputs;
}

function collectKnownRisks(agentRuns: AgentRun[]): string[] {
  const risks = new Set<string>();
  for (const run of agentRuns) {
    for (const risk of run.risks ?? []) {
      risks.add(risk);
    }
  }

  return [...risks];
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
    trigger: 'clarification_required',
    riskLevel: 'medium',
    status: 'pending'
  };
}

function decidePlanningRoute(
  input: string,
  options: LeaderRunOptions,
  pmDecision?: Pick<AgentRun, 'needsOwnerDecision' | 'nextAction' | 'risks'>,
  suppressInputOwnerDecisionSignals = false
): {
  needsMeeting: boolean;
  needsOwnerDecision: boolean;
  isBlocked: boolean;
  reason: string;
  approvalTrigger?: ApprovalRequest['trigger'];
  approvalRiskLevel: ApprovalRequest['riskLevel'];
} {
  const inputRiskSignals = collectInputRiskSignals(input, pmDecision);
  const effectiveRiskSignals = suppressInputOwnerDecisionSignals
    ? inputRiskSignals.filter((signal) => signal.trigger === 'role_requested_owner_decision')
    : inputRiskSignals;
  const ownerDecisionAssessment = shouldRequestOwnerDecision(effectiveRiskSignals);
  const forcedOwnerDecision = options.forceOwnerDecision === true;
  const approvalTriggerPart = ownerDecisionAssessment.trigger
    ? { approvalTrigger: ownerDecisionAssessment.trigger }
    : forcedOwnerDecision
      ? { approvalTrigger: 'role_requested_owner_decision' as const }
      : {};
  const approvalRiskLevel = forcedOwnerDecision && ownerDecisionAssessment.riskLevel === 'low'
    ? 'high'
    : ownerDecisionAssessment.riskLevel;
  const needsMeeting = options.forceMeeting ?? /会议|评审|同步/u.test(input);
  const needsOwnerDecision = options.forceOwnerDecision ?? ownerDecisionAssessment.needsOwnerDecision;
  const isBlocked = options.forceBlocked ?? /阻塞|blocked|依赖缺失|缺少依赖/u.test(input);
  const shouldConfirmBlockedInMeeting = needsMeeting && isBlocked && (
    (options.forceMeeting === true && options.forceBlocked === true)
    || /先.*(?:会议|评审)|会议评审|评审.*阻塞|确认阻塞/u.test(input)
  );

  if (shouldConfirmBlockedInMeeting) {
    return {
      needsMeeting: true,
      needsOwnerDecision,
      isBlocked: false,
      reason: '规划阶段识别到需先开会确认阻塞结论',
      ...approvalTriggerPart,
      approvalRiskLevel
    };
  }

  if (isBlocked) {
    return {
      needsMeeting,
      needsOwnerDecision,
      isBlocked,
      reason: '存在外部依赖缺失或阻塞条件，暂时无法继续',
      ...approvalTriggerPart,
      approvalRiskLevel
    };
  }

  if (needsMeeting) {
    return {
      needsMeeting,
      needsOwnerDecision,
      isBlocked,
      reason: '规划阶段识别到需要先开会对齐',
      ...approvalTriggerPart,
      approvalRiskLevel
    };
  }

  if (needsOwnerDecision) {
    return {
      needsMeeting,
      needsOwnerDecision,
      isBlocked,
      reason: ownerDecisionAssessment.reason ?? pmDecision?.risks?.[0] ?? '规划阶段存在需要老板拍板的关键选项',
      approvalTrigger: ownerDecisionAssessment.trigger ?? 'role_requested_owner_decision',
      approvalRiskLevel
    };
  }

  return {
    needsMeeting,
    needsOwnerDecision,
    isBlocked,
    reason: '规划完成，进入开发',
    ...approvalTriggerPart,
    approvalRiskLevel
  };
}

function createAgentRunInput(task: Task, currentStatus: TaskState, requestedOutcome: string): AgentRunInput {
  const riskSignals = collectTaskRiskSignals(task);

  return {
    taskId: task.id,
    taskSummary: task.input,
    currentStatus,
    artifacts: task.artifacts,
    contextSummary: summarizeTaskContext(task, riskSignals),
    riskSignals,
    requestedOutcome
  };
}

async function runAndRecordAgent(
  task: Task,
  role: Exclude<AgentRun['role'], 'leader'>,
  currentStatus: TaskState,
  requestedOutcome: string,
  options: LeaderRunOptions
): Promise<AgentRunOutput> {
  const input = createAgentRunInput(task, currentStatus, requestedOutcome);
  addArtifact(
    task,
    createArtifact(
      'role_input_snapshot',
      `${role} 输入快照`,
      'leader',
      JSON.stringify(
        {
          role,
          currentStatus,
          requestedOutcome,
          contextSummary: input.contextSummary,
          riskSignals: input.riskSignals
        },
        null,
        2
      )
    )
  );

  const output = await runAgent(role, input, createAgentExecutionOptions(options));
  recordAgentOutput(task, output);
  addArtifact(
    task,
    createArtifact(
      'role_output',
      `${role} 输出快照`,
      role,
      JSON.stringify(
        {
          summary: output.summary,
          confidence: output.confidence,
          riskLevel: output.riskLevel,
          risks: output.risks,
          needsOwnerDecision: output.needsOwnerDecision,
          nextAction: output.nextAction
        },
        null,
        2
      )
    )
  );

  return output;
}

function createAgentExecutionOptions(options: LeaderRunOptions): AgentExecutionOptions | undefined {
  if (!options.workspaceRoot && !hasConfiguredLlmProvider(options.llm ?? {})) {
    return undefined;
  }

  return {
    llm: options.llm ?? {},
    workspaceRoot: options.workspaceRoot ?? process.cwd()
  };
}

function shouldUseLegacyExecution(options: LeaderRunOptions): boolean {
  if (options.executionBackend === 'legacy') {
    return true;
  }

  if (options.executionBackend === 'external') {
    return false;
  }

  return hasConfiguredLlmProvider(options.llm ?? {})
    || Boolean(options.runner)
    || Boolean(options.verificationScripts?.length)
    || Boolean(options.repoConfigVerificationScript)
    || Boolean(options.packageJsonPath);
}

function summarizeTaskContext(task: Task, riskSignals: RiskSignal[] = collectTaskRiskSignals(task)): string {
  const lastTransition = task.transitions.at(-1);
  const statePart = `current=${task.state}`;
  const transitionPart = lastTransition ? `last=${lastTransition.from}->${lastTransition.to}` : 'last=none';
  return `${statePart}; ${transitionPart}; artifacts=${task.artifacts.length}; runs=${task.agentRuns.length}; risks=${riskSignals.length}`;
}

function getLatestArtifact(
  task: Task,
  predicate: (artifact: Task['artifacts'][number]) => boolean
): Task['artifacts'][number] | undefined {
  for (let i = task.artifacts.length - 1; i >= 0; i -= 1) {
    const artifact = task.artifacts[i];
    if (artifact && predicate(artifact)) {
      return artifact;
    }
  }

  return undefined;
}

function getLatestArtifactIndex(
  task: Task,
  predicate: (artifact: Task['artifacts'][number]) => boolean
): number {
  for (let i = task.artifacts.length - 1; i >= 0; i -= 1) {
    const artifact = task.artifacts[i];
    if (artifact && predicate(artifact)) {
      return i;
    }
  }

  return -1;
}

function hasArtifactUpdateSince(
  task: Task,
  sourceKinds: readonly Task['artifacts'][number]['kind'][],
  targetKinds: readonly Task['artifacts'][number]['kind'][]
): boolean {
  const latestSourceIndex = getLatestArtifactIndex(task, (artifact) => sourceKinds.includes(artifact.kind));
  const latestTargetIndex = getLatestArtifactIndex(task, (artifact) => targetKinds.includes(artifact.kind));
  return latestSourceIndex > latestTargetIndex;
}

function getLatestRoleRun(task: Task, role: Exclude<AgentRun['role'], 'leader'>): AgentRun | undefined {
  for (let i = task.agentRuns.length - 1; i >= 0; i -= 1) {
    if (task.agentRuns[i]?.role === role) {
      return task.agentRuns[i];
    }
  }

  return undefined;
}

function getLatestApprovalStatus(task: Task): ApprovalRequest['status'] | undefined {
  for (let i = task.approvalRequests.length - 1; i >= 0; i -= 1) {
    const request = task.approvalRequests[i];
    if (request) {
      return request.status;
    }
  }

  return undefined;
}

function normalizeTaskInputAfterOwnerApproval(input: string): string {
  return input
    .replace(/需要老板拍板|老板拍板|老板决策|老板确认/gu, '方向已确认')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
}

function getRoleEscalationDecision(
  task: Task,
  roles: readonly Exclude<AgentRun['role'], 'leader'>[]
): { type: 'meeting' | 'owner_decision'; reason: string } | undefined {
  const latestEscalationArtifactIndex = getLatestArtifactIndex(
    task,
    (artifact) => artifact.kind === 'meeting_notes' || artifact.kind === 'loopback_note'
  );

  for (const role of roles) {
    const run = getLatestRoleRun(task, role);
    if (!run) {
      continue;
    }

    const latestRoleArtifactIndex = getLatestArtifactIndex(
      task,
      (artifact) => artifact.createdBy === role
        && (artifact.kind === 'role_output'
          || artifact.kind === 'implementation_plan'
          || artifact.kind === 'architecture_note'
          || artifact.kind === 'code_summary'
          || artifact.kind === 'patch_proposal'
          || artifact.kind === 'test_report')
    );

    if (latestEscalationArtifactIndex > latestRoleArtifactIndex) {
      continue;
    }

    if (run.nextAction === 'trigger_meeting' || run.risks?.some((risk) => /分歧|冲突/u.test(risk))) {
      return {
        type: 'meeting',
        reason: `${role} 识别到方案冲突，需回到 meeting 对齐`
      };
    }

    if (run.needsOwnerDecision || run.nextAction === 'request_owner_decision') {
      return {
        type: 'owner_decision',
        reason: run.risks?.[0] ?? `${role} 识别到高风险事项，需老板确认`
      };
    }
  }

  return undefined;
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

function createOwnerDecisionRequest(
  reason: string,
  trigger: ApprovalRequest['trigger'] = 'role_requested_owner_decision',
  riskLevel: ApprovalRequest['riskLevel'] = 'high'
): ApprovalRequest {
  return {
    id: createId('approval'),
    reason,
    requestedBy: 'leader',
    trigger,
    riskLevel,
    status: 'pending'
  };
}

function getOwnerDecisionResumeTarget(trigger: ApprovalRequest['trigger']): TaskState {
  switch (trigger) {
    case 'scope_change':
    case 'acceptance_criteria_change':
    case 'multi_option_direction_change':
    case 'high_risk_command':
    case 'destructive_operation':
      return 'planning';
    case 'report_confirmation':
      return 'done';
    case 'role_requested_owner_decision':
    case 'clarification_required':
    default:
      return 'developing';
  }
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
  task.validation = options.validation;
  const checkpointArtifactIds = captureTaskContextArtifacts(task, {
    title: '暂停上下文摘要',
    reason: options.reason
  });
  task.checkpoint = createCheckpoint(task, options.checkpointSummary, checkpointArtifactIds);
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
