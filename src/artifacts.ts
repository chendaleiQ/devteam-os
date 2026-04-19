import type {
  Artifact,
  ArtifactKind,
  Checkpoint,
  DeliveryReport,
  LoopbackReason,
  Role,
  Task,
  TaskState,
  ValidationResult,
  WaitingSummary
} from './domain.js';
import { collectTaskRiskSignals } from './risk.js';

export function createArtifact(
  kind: ArtifactKind,
  title: string,
  createdBy: Role,
  content: string
): Artifact {
  return {
    id: createId('artifact'),
    kind,
    title,
    createdBy,
    content
  };
}

export function addArtifact(task: Task, artifact: Artifact): Artifact {
  task.artifacts.push(artifact);
  return artifact;
}

export function buildDeliveryReport(task: Task, validation: ValidationResult): DeliveryReport {
  const pendingItems = validation.passed ? [] : [...validation.issues];
  const summary = task.waitingSummary?.reason ?? (validation.passed ? `最小 Leader 闭环已跑通；验证: ${validation.summary}` : validation.summary);

  if (task.waitingSummary) {
    pendingItems.push(`等待输入: ${task.waitingSummary.requestedInput}`);
    pendingItems.push(`恢复目标: ${task.waitingSummary.resumeTargetState}`);
  }

  if (task.checkpoint) {
    pendingItems.push(`检查点: ${task.checkpoint.summary}`);
  }

  return {
    finalState: task.state,
    summary,
    completedSteps: task.transitions.map((transition) => `${transition.from} -> ${transition.to}`),
    pendingItems,
    artifactIds: task.artifacts.map((artifact) => artifact.id),
    keyArtifactIds: collectKeyArtifactIds(task),
    validation
  };
}

export function createCheckpoint(task: Task, summary: string, artifactIds: string[] = []): Checkpoint {
  return {
    state: task.state,
    transitionCount: task.transitions.length,
    artifactCount: task.artifacts.length,
    summary,
    ...(artifactIds.length > 0 ? { artifactIds } : {})
  };
}

export function setWaitingSummary(
  task: Task,
  waitingSummary: { reason: string; requestedInput: string; resumeTargetState: TaskState }
): WaitingSummary {
  task.waitingSummary = waitingSummary;
  return task.waitingSummary;
}

export function clearWaitingState(task: Task): void {
  delete task.waitingSummary;
  delete task.checkpoint;
}

export function createId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function createLoopbackArtifact(
  reason: LoopbackReason,
  title: string,
  createdBy: Role,
  detail: string | Record<string, unknown>
): Artifact {
  return createArtifact(
    'loopback_note',
    title,
    createdBy,
    typeof detail === 'string'
      ? JSON.stringify({ reason, detail }, null, 2)
      : JSON.stringify({ reason, ...detail }, null, 2)
  );
}

export function captureTaskContextArtifacts(
  task: Task,
  options: { title?: string; reason?: string; createdBy?: Role } = {}
): string[] {
  const createdBy = options.createdBy ?? 'leader';
  const contextArtifact = addArtifact(
    task,
    createArtifact(
      'context_summary',
      options.title ?? '状态上下文摘要',
      createdBy,
      JSON.stringify(buildTaskContextSnapshot(task, options.reason), null, 2)
    )
  );

  const riskArtifact = addArtifact(
    task,
    createArtifact(
      'risk_assessment',
      '风险评估',
      createdBy,
      JSON.stringify(
        {
          state: task.state,
          riskSignals: collectTaskRiskSignals(task)
        },
        null,
        2
      )
    )
  );

  return [contextArtifact.id, riskArtifact.id];
}

function buildTaskContextSnapshot(task: Task, reason?: string): Record<string, unknown> {
  const lastTransition = task.transitions.at(-1);

  return {
    ...(reason ? { reason } : {}),
    state: task.state,
    lastTransition: lastTransition ? `${lastTransition.from}->${lastTransition.to}` : 'none',
    artifactCount: task.artifacts.length,
    agentRunCount: task.agentRuns.length,
    waitingSummary: task.waitingSummary,
    validation: task.validation,
    pendingApprovals: task.approvalRequests.filter((request) => request.status === 'pending').map((request) => ({
      id: request.id,
      reason: request.reason,
      trigger: request.trigger,
      riskLevel: request.riskLevel
    }))
  };
}

function collectKeyArtifactIds(task: Task): string[] {
  const keyKinds = new Set<ArtifactKind>([
    'implementation_plan',
    'architecture_note',
    'patch_proposal',
    'code_summary',
    'test_report',
    'meeting_notes',
    'blocker_report',
    'executor_request',
    'executor_result',
    'risk_assessment',
    'loopback_note',
    'context_summary',
    'delivery_summary'
  ]);

  const ids = [...task.artifacts]
    .filter((artifact) => keyKinds.has(artifact.kind))
    .slice(-8)
    .map((artifact) => artifact.id);

  if (task.checkpoint?.artifactIds) {
    for (const artifactId of task.checkpoint.artifactIds) {
      if (!ids.includes(artifactId)) {
        ids.push(artifactId);
      }
    }
  }

  return ids;
}
