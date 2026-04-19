import type { ApprovalRequest, LeaderRunResult, StateTransition, Task } from './domain.js';
import { loadProjectEnv } from './env.js';
import {
  addArtifact,
  buildDeliveryReport,
  captureTaskContextArtifacts,
  createArtifact,
  createCheckpoint,
  createId,
  setWaitingSummary
} from './artifacts.js';
import type { ExternalExecutor } from './executors/index.js';
import { runLeaderGraph } from './leader-graph.js';
import type { LlmProviderConfig } from './llm/index.js';
import { createSafeScriptRunner, type SafeScriptRunner } from './runner.js';
import type { TaskStore } from './storage.js';

export interface LeaderRunOptions {
  executionBackend?: 'legacy' | 'external';
  executor?: string | ExternalExecutor;
  forceMeeting?: boolean;
  forceOwnerDecision?: boolean;
  forceBlocked?: boolean;
  workspaceRoot?: string;
  store?: TaskStore;
  runner?: SafeScriptRunner;
  verificationScripts?: string[];
  repoConfigVerificationScript?: string;
  packageJsonPath?: string;
  llm?: LlmProviderConfig;
}

export interface LeaderResumeOptions extends LeaderRunOptions {
  note?: string;
}

const WORKSPACE_ENV_KEYS = [
  'DEVTEAM_EXECUTOR',
  'DEVTEAM_LLM_PROVIDER',
  'DEVTEAM_LLM_MODEL',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_BASE_URL'
] as const;

export async function runLeaderTask(input: string, options: LeaderRunOptions = {}): Promise<LeaderRunResult> {
  loadWorkspaceEnv(options.workspaceRoot);

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
  loadWorkspaceEnv(options.workspaceRoot);

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
    const checkpointArtifactIds = captureTaskContextArtifacts(task, {
      title: '继续澄清上下文摘要',
      reason: '补充信息仍不足，继续等待澄清'
    });
    task.checkpoint = createCheckpoint(task, 'clarifying 暂停，补充说明后仍需继续澄清', checkpointArtifactIds);
    task.deliveryReport = buildDeliveryReport(task, {
      passed: false,
      summary: '补充信息仍不足，继续等待澄清',
      issues: ['仍缺少可执行目标或范围']
    });
    persistTask(task, options.store);
    return { task, paused: true };
  }

  resolvePendingApprovals(task, 'approved');
  persistTask(task, options.store);
  return runLeaderGraph(task, options);
}

export async function approveLeaderTask(taskId: string, options: LeaderRunOptions): Promise<LeaderRunResult> {
  loadWorkspaceEnv(options.workspaceRoot);

  const task = loadTask(taskId, options.store);

  if (task.state !== 'awaiting_owner_decision') {
    throw new Error(`任务 ${taskId} 当前状态不是 awaiting_owner_decision，无法 approve`);
  }

  resolvePendingApprovals(task, 'approved');
  persistTask(task, options.store);
  return runLeaderGraph(task, options);
}

export async function rejectLeaderTask(taskId: string, options: LeaderResumeOptions): Promise<LeaderRunResult> {
  loadWorkspaceEnv(options.workspaceRoot);

  const task = loadTask(taskId, options.store);

  if (task.state !== 'awaiting_owner_decision') {
    throw new Error(`任务 ${taskId} 当前状态不是 awaiting_owner_decision，无法 reject`);
  }

  const note = options.note?.trim();
  if (note) {
    addArtifact(task, createArtifact('requirements_brief', '老板驳回说明', 'leader', note));
  }

  resolvePendingApprovals(task, 'rejected');
  persistTask(task, options.store);
  return runLeaderGraph(task, options);
}

export async function requestChangesLeaderTask(taskId: string, options: LeaderResumeOptions): Promise<LeaderRunResult> {
  loadWorkspaceEnv(options.workspaceRoot);

  const task = loadTask(taskId, options.store);

  if (task.state !== 'awaiting_owner_decision') {
    throw new Error(`任务 ${taskId} 当前状态不是 awaiting_owner_decision，无法 revise`);
  }

  const note = options.note?.trim();
  task.input = normalizeTaskInputAfterOwnerChanges(task.input);
  if (note) {
    task.input = `${task.input}\n老板修改意见：${note}`;
    addArtifact(task, createArtifact('requirements_brief', '老板修改意见', 'leader', note));
  }

  resolvePendingApprovals(task, 'changes_requested');
  persistTask(task, options.store);
  return runLeaderGraph(task, options);
}

export async function resolveBlockedTask(taskId: string, options: LeaderResumeOptions): Promise<LeaderRunResult> {
  loadWorkspaceEnv(options.workspaceRoot);

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

function resolvePendingApprovals(task: Task, status: ApprovalRequest['status']): void {
  for (const request of task.approvalRequests) {
    if (request.status === 'pending') {
      request.status = status;
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

function normalizeTaskInputAfterOwnerChanges(input: string): string {
  return input
    .replace(/需要老板拍板|老板拍板|老板决策|老板确认/gu, '已收敛方向')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
}

function persistTask(task: Task, store?: TaskStore): void {
  store?.save(task);
}

function loadWorkspaceEnv(workspaceRoot: string | undefined): void {
  loadProjectEnv(workspaceRoot, {
    scope: 'leader-workspace',
    managedKeys: WORKSPACE_ENV_KEYS
  });
}

export { createSafeScriptRunner };
export type { SafeScriptRunner, ApprovalRequest, StateTransition };
