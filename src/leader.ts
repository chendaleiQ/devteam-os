import type {
  AgentRun,
  ApprovalRequest,
  Artifact,
  LeaderRunResult,
  Role,
  StateTransition,
  Task,
  TaskState,
  ValidationResult
} from './domain.js';
import { addArtifact, buildDeliveryReport, createArtifact, createId } from './artifacts.js';
import { createSafeScriptRunner, type SafeScriptRunner } from './runner.js';
import type { TaskStore } from './storage.js';
import { advanceState, assertValidTransition, isPauseState } from './workflow.js';

interface PlaceholderAgentOutput {
  role: Exclude<Role, 'leader'>;
  summary: string;
  artifact: Artifact;
}

export interface LeaderRunOptions {
  forceMeeting?: boolean;
  forceOwnerDecision?: boolean;
  forceBlocked?: boolean;
  store?: TaskStore;
  runner?: SafeScriptRunner;
  verificationScripts?: string[];
}

export interface LeaderResumeOptions extends LeaderRunOptions {
  note?: string;
}

export function runLeaderTask(input: string, options: LeaderRunOptions = {}): LeaderRunResult {
  const normalizedInput = input.trim();
  const task: Task = {
    id: createId('task'),
    input: normalizedInput,
    state: 'intake',
    needsClarification: needsClarification(normalizedInput),
    artifacts: [],
    agentRuns: [],
    transitions: [],
    approvalRequests: []
  };

  addArtifact(
    task,
    createArtifact(
      task.needsClarification ? 'clarification_request' : 'requirements_brief',
      task.needsClarification ? '待澄清问题' : '需求简报',
      'leader',
      task.needsClarification
        ? `需求信息不足，请补充更具体目标：${normalizedInput || '（空输入）'}`
        : `老板需求：${normalizedInput}`
    )
  );
  persistTask(task, options.store);

  return continueLeaderTask(task, options);
}

export function resumeLeaderTask(taskId: string, options: LeaderResumeOptions): LeaderRunResult {
  const task = loadTask(taskId, options.store);

  if (task.state !== 'clarifying') {
    throw new Error(`任务 ${taskId} 当前状态不是 clarifying，无法 resume`);
  }

  const note = options.note?.trim();

  if (note) {
    task.input = `${task.input}\n补充说明：${note}`;
    addArtifact(task, createArtifact('requirements_brief', '补充说明', 'leader', note));
  }

  task.needsClarification = needsClarification(note ? task.input : task.input);
  if (task.needsClarification) {
    task.deliveryReport = buildDeliveryReport(task, {
      passed: false,
      summary: '补充信息仍不足，继续等待澄清',
      issues: ['仍缺少可执行目标或范围']
    });
    persistTask(task, options.store);
    return { task, paused: true };
  }

  resolvePendingApprovals(task);
  moveTask(task, advanceState(task.state), '已补充澄清信息，恢复推进');
  persistTask(task, options.store);

  return continueLeaderTask(task, options);
}

export function approveLeaderTask(taskId: string, options: LeaderRunOptions): LeaderRunResult {
  const task = loadTask(taskId, options.store);

  if (task.state !== 'awaiting_owner_decision') {
    throw new Error(`任务 ${taskId} 当前状态不是 awaiting_owner_decision，无法 approve`);
  }

  resolvePendingApprovals(task);
  const pauseOrigin = getLastTransition(task)?.from;

  if (pauseOrigin === 'reporting') {
    moveTask(task, 'done', '老板已批准汇报结果，任务完成');
    task.deliveryReport = buildDeliveryReport(task, task.validation ?? {
      passed: true,
      summary: '老板批准后完成交付',
      issues: []
    });
    persistTask(task, options.store);
    return { task, paused: false };
  }

  moveTask(task, 'developing', '老板已批准，进入安全下一步开发');
  persistTask(task, options.store);

  return continueLeaderTask(task, options);
}

export function resolveBlockedTask(taskId: string, options: LeaderResumeOptions): LeaderRunResult {
  const task = loadTask(taskId, options.store);

  if (task.state !== 'blocked') {
    throw new Error(`任务 ${taskId} 当前状态不是 blocked，无法解除阻塞`);
  }

  addArtifact(
    task,
    createArtifact('requirements_brief', '解除阻塞说明', 'leader', options.note?.trim() || '阻塞已解除，恢复推进')
  );
  moveTask(task, 'planning', '阻塞已解除，回到 planning 重新推进');
  persistTask(task, options.store);

  return continueLeaderTask(task, { ...options, forceBlocked: false });
}

function continueLeaderTask(task: Task, options: LeaderRunOptions = {}): LeaderRunResult {
  if (task.state === 'intake') {
    if (task.needsClarification) {
      moveTask(task, advanceState(task.state, { needsClarification: true }), '需求过于模糊，需要老板澄清');
      task.approvalRequests.push(createClarificationRequest());
      task.deliveryReport = buildDeliveryReport(task, {
        passed: false,
        summary: '等待澄清，尚未进入交付阶段',
        issues: ['需求描述过短或缺少可执行目标']
      });
      persistTask(task, options.store);
      return {
        task,
        paused: isPauseState(task.state)
      };
    }

    moveTask(task, advanceState(task.state, { needsClarification: false }), '需求清晰，进入规划');
    persistTask(task, options.store);
  }

  if (task.state === 'planning') {
    if (!task.agentRuns.some((run) => run.role === 'pm')) {
      const pmOutput = runPlaceholderAgent('pm', task.input);
      recordAgentOutput(task, pmOutput);
    }

    const routing = decidePlanningRoute(task.input, options);
    const planningNextState = advanceState(task.state, {
      needsMeeting: routing.needsMeeting,
      needsOwnerDecision: routing.needsOwnerDecision,
      isBlocked: routing.isBlocked
    });
    moveTask(
      task,
      planningNextState,
      routing.reason
    );
    persistTask(task, options.store);

    if (planningNextState === 'blocked') {
      addArtifact(task, createBlockerArtifact(task.input, routing.reason));
      task.deliveryReport = buildDeliveryReport(task, {
        passed: false,
        summary: '任务受阻，等待解除阻塞',
        issues: [routing.reason]
      });
      persistTask(task, options.store);
      return {
        task,
        paused: isPauseState(task.state)
      };
    }

    if (planningNextState === 'awaiting_owner_decision') {
      task.approvalRequests.push(createOwnerDecisionRequest('规划阶段需要老板拍板后再继续'));
      task.deliveryReport = buildDeliveryReport(task, {
        passed: false,
        summary: '等待老板决策，任务暂停',
        issues: ['范围、优先级或方向需要老板确认']
      });
      persistTask(task, options.store);
      return {
        task,
        paused: isPauseState(task.state)
      };
    }
  }

  if (task.state === 'meeting') {
    const meetingNeedsOwnerDecision = options.forceOwnerDecision ?? /老板拍板|老板决策|老板确认/u.test(task.input);
    const meetingArtifact = createMeetingArtifact(task.input, meetingNeedsOwnerDecision);
    addArtifact(task, meetingArtifact);
    const postMeetingState = advanceState(task.state, { needsOwnerDecision: meetingNeedsOwnerDecision, isBlocked: false });
    moveTask(
      task,
      postMeetingState,
      meetingNeedsOwnerDecision ? '会议结论要求老板拍板' : '会议结论明确，可进入开发'
    );
    persistTask(task, options.store);

    if (postMeetingState === 'awaiting_owner_decision') {
      task.approvalRequests.push(createOwnerDecisionRequest('会议已形成方案，但需老板最终拍板'));
      task.deliveryReport = buildDeliveryReport(task, {
        passed: false,
        summary: '会议已完成，等待老板决策',
        issues: ['会议结论涉及老板拍板项']
      });
      persistTask(task, options.store);
      return {
        task,
        paused: isPauseState(task.state)
      };
    }
  }

  if (task.state === 'developing') {
    if (!task.agentRuns.some((run) => run.role === 'architect')) {
      const architectOutput = runPlaceholderAgent('architect', task.input);
      recordAgentOutput(task, architectOutput);
    }
    if (!task.agentRuns.some((run) => run.role === 'developer')) {
      const developerOutput = runPlaceholderAgent('developer', task.input);
      recordAgentOutput(task, developerOutput);
    }

    moveTask(task, advanceState(task.state), '开发占位产物已生成，进入测试');
    persistTask(task, options.store);
  }

  if (task.state === 'testing') {
    if (!task.agentRuns.some((run) => run.role === 'qa')) {
      const qaOutput = runPlaceholderAgent('qa', task.input);
      recordAgentOutput(task, qaOutput);
    }

    const validation = validatePrototype(task, options);
    task.validation = validation;
    const testingNextState = advanceState(task.state, { validationResult: validation });
    moveTask(task, testingNextState, validation.summary);
    persistTask(task, options.store);

    if (testingNextState === 'developing') {
      task.deliveryReport = buildDeliveryReport(task, validation);
      persistTask(task, options.store);
      return {
        task,
        paused: isPauseState(task.state)
      };
    }
  }

  if (task.state === 'reporting') {
    addArtifact(
      task,
      createArtifact('delivery_summary', '交付摘要', 'leader', `已完成最小闭环：规划、开发、测试、汇报。输入需求：${task.input}`)
    );

    const reportingNeedsOwnerDecision = shouldWaitForOwnerDecisionAtReporting(task.input, options);
    const postReportingState = advanceState(task.state, { needsOwnerDecision: reportingNeedsOwnerDecision });
    moveTask(
      task,
      postReportingState,
      reportingNeedsOwnerDecision ? '汇报涉及老板最终拍板' : '汇报完成，任务结束'
    );

    if (postReportingState === 'awaiting_owner_decision') {
      task.approvalRequests.push(createOwnerDecisionRequest('汇报阶段需要老板确认是否按当前方案交付'));
      task.deliveryReport = buildDeliveryReport(task, {
        passed: false,
        summary: '已完成汇报，等待老板最终决策',
        issues: ['交付前仍需老板确认']
      });
      persistTask(task, options.store);
      return {
        task,
        paused: isPauseState(task.state)
      };
    }
  }

  task.deliveryReport = buildDeliveryReport(task, task.validation ?? {
    passed: true,
    summary: '已完成默认验证',
    issues: []
  });
  persistTask(task, options.store);

  return {
    task,
    paused: isPauseState(task.state)
  };
}

function runPlaceholderAgent(role: Exclude<Role, 'leader'>, input: string): PlaceholderAgentOutput {
  switch (role) {
    case 'pm':
      return {
        role,
        summary: 'PM 输出可执行计划',
        artifact: createArtifact('implementation_plan', '实施计划', role, `围绕需求拆分最小闭环步骤：${input}`)
      };
    case 'architect':
      return {
        role,
        summary: 'Architect 输出骨架设计说明',
        artifact: createArtifact('architecture_note', '架构说明', role, '采用 Leader 单入口 + 轻量状态机 + 结构化产物模型。')
      };
    case 'developer':
      return {
        role,
        summary: 'Developer 输出实现摘要',
        artifact: createArtifact('code_summary', '实现摘要', role, '生成原型闭环所需代码骨架与占位执行逻辑。')
      };
    case 'qa':
      return {
        role,
        summary: 'QA 输出测试结论',
        artifact: createArtifact('test_report', '测试报告', role, '对最小闭环进行基础验证，确认状态推进与交付报告生成。')
      };
  }
}

function validatePrototype(task: Task, options: LeaderRunOptions): ValidationResult {
  const hasPlan = task.artifacts.some((artifact) => artifact.kind === 'implementation_plan');
  const hasCodeSummary = task.artifacts.some((artifact) => artifact.kind === 'code_summary');
  const hasTestReport = task.artifacts.some((artifact) => artifact.kind === 'test_report');
  const verificationResults = runVerificationScripts(options);
  const passed = hasPlan && hasCodeSummary && hasTestReport && verificationResults.every((result) => result.ok && !result.blocked);
  const verificationIssues = verificationResults.filter((result) => !result.ok || result.blocked).map((result) => result.summary);

  return {
    passed,
    summary: passed ? '基础验证通过，进入汇报' : '基础验证失败，回流开发补齐产物',
    issues: passed ? [] : ['缺少必要的计划、实现或测试产物', ...verificationIssues]
  };
}

function loadTask(taskId: string, store?: TaskStore): Task {
  const task = store?.get(taskId);

  if (!task) {
    throw new Error(`未找到任务: ${taskId}`);
  }

  return task;
}

function resolvePendingApprovals(task: Task): void {
  for (const request of task.approvalRequests) {
    if (request.status === 'pending') {
      request.status = 'approved';
    }
  }
}

function getLastTransition(task: Task): StateTransition | undefined {
  return task.transitions.at(-1);
}

function runVerificationScripts(options: LeaderRunOptions) {
  const verificationScripts = options.verificationScripts?.filter(Boolean) ?? [];

  if (verificationScripts.length === 0) {
    return [];
  }

  const runner = options.runner ?? createSafeScriptRunner();
  return verificationScripts.map((script) => runner.runScript(script));
}

function recordAgentOutput(task: Task, output: PlaceholderAgentOutput): void {
  addArtifact(task, output.artifact);
  const agentRun: AgentRun = {
    id: createId('run'),
    role: output.role,
    summary: output.summary,
    producedArtifactIds: [output.artifact.id]
  };
  task.agentRuns.push(agentRun);
}

function moveTask(task: Task, nextState: TaskState, reason: string): void {
  assertValidTransition(task.state, nextState);
  const transition: StateTransition = {
    from: task.state,
    to: nextState,
    reason
  };
  task.transitions.push(transition);
  task.state = nextState;
}

function createClarificationRequest(): ApprovalRequest {
  return {
    id: createId('approval'),
    reason: '请老板补充更清晰的交付目标、范围或约束',
    requestedBy: 'leader',
    status: 'pending'
  };
}

function needsClarification(input: string): boolean {
  if (!input) {
    return true;
  }

  const compact = input.replace(/\s+/g, '');
  return compact.length < 8;
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

function createMeetingArtifact(input: string, needsOwnerDecision: boolean): Artifact {
  return createArtifact(
    'meeting_notes',
    '会议结论',
    'leader',
    JSON.stringify(
      {
        topic: input,
        decisions: ['先按本地原型边界推进', '不引入 Web、多用户、云部署与复杂并行'],
        risks: needsOwnerDecision ? ['存在需要老板拍板的范围或优先级'] : [],
        nextStep: needsOwnerDecision ? 'awaiting_owner_decision' : 'developing'
      },
      null,
      2
    )
  );
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

function persistTask(task: Task, store?: TaskStore): void {
  store?.save(task);
}
