import type { ApprovalRequest, LeaderRunResult, StateTransition, Task } from './domain.js';
import {
  addArtifact,
  buildDeliveryReport,
  createArtifact,
  createCheckpoint,
  createId,
  setWaitingSummary
} from './artifacts.js';
import { runLeaderGraph } from './leader-graph.js';
import { createSafeScriptRunner, type SafeScriptRunner } from './runner.js';
import type { TaskStore } from './storage.js';

export interface LeaderRunOptions {
  forceMeeting?: boolean;
  forceOwnerDecision?: boolean;
  forceBlocked?: boolean;
  store?: TaskStore;
  runner?: SafeScriptRunner;
  verificationScripts?: string[];
  repoConfigVerificationScript?: string;
  packageJsonPath?: string;
}

export interface LeaderResumeOptions extends LeaderRunOptions {
  note?: string;
}

export async function runLeaderTask(input: string, options: LeaderRunOptions = {}): Promise<LeaderRunResult> {
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

  return runLeaderGraph(task, options);
}

export async function resumeLeaderTask(taskId: string, options: LeaderResumeOptions): Promise<LeaderRunResult> {
  const task = loadTask(taskId, options.store);

  if (!canResumeTask(task)) {
    throw new Error(`任务 ${taskId} 当前状态不是 clarifying/developing(验证失败)，无法 resume`);
  }

  const note = options.note?.trim();

  if (note) {
    task.input = `${task.input}\n补充说明：${note}`;
    addArtifact(task, createArtifact('requirements_brief', '补充说明', 'leader', note));
  }

  if (task.state === 'developing') {
    persistTask(task, options.store);
    return runLeaderGraph(task, options);
  }

  task.needsClarification = needsClarification(task.input);
  if (task.needsClarification) {
    setWaitingSummary(task, {
      reason: '补充信息仍不足，继续等待澄清',
      requestedInput: '请补充更清晰的目标、范围或约束',
      resumeTargetState: 'planning'
    });
    task.checkpoint = createCheckpoint(task, 'clarifying 暂停，补充说明后仍需继续澄清');
    task.deliveryReport = buildDeliveryReport(task, {
      passed: false,
      summary: '补充信息仍不足，继续等待澄清',
      issues: ['仍缺少可执行目标或范围']
    });
    persistTask(task, options.store);
    return { task, paused: true };
  }

  resolvePendingApprovals(task);
  persistTask(task, options.store);
  return runLeaderGraph(task, options);
}

export async function approveLeaderTask(taskId: string, options: LeaderRunOptions): Promise<LeaderRunResult> {
  const task = loadTask(taskId, options.store);

  if (task.state !== 'awaiting_owner_decision') {
    throw new Error(`任务 ${taskId} 当前状态不是 awaiting_owner_decision，无法 approve`);
  }

  resolvePendingApprovals(task);
  persistTask(task, options.store);
  return runLeaderGraph(task, options);
}

export async function resolveBlockedTask(taskId: string, options: LeaderResumeOptions): Promise<LeaderRunResult> {
  const task = loadTask(taskId, options.store);

  if (task.state !== 'blocked') {
    throw new Error(`任务 ${taskId} 当前状态不是 blocked，无法解除阻塞`);
  }

  addArtifact(
    task,
    createArtifact('requirements_brief', '解除阻塞说明', 'leader', options.note?.trim() || '阻塞已解除，恢复推进')
  );
  persistTask(task, options.store);
  return runLeaderGraph(task, { ...options, forceBlocked: false });
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

function canResumeTask(task: Task): boolean {
  return task.state === 'clarifying' || (task.state === 'developing' && task.validation?.passed === false);
}

function needsClarification(input: string): boolean {
  if (!input) {
    return true;
  }

  const compact = input.replace(/\s+/g, '');
  return compact.length < 8;
}

function persistTask(task: Task, store?: TaskStore): void {
  store?.save(task);
}

export { createSafeScriptRunner };
export type { SafeScriptRunner, ApprovalRequest, StateTransition };
