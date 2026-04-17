import type {
  Artifact,
  ArtifactKind,
  Checkpoint,
  DeliveryReport,
  Role,
  Task,
  TaskState,
  ValidationResult,
  WaitingSummary
} from './domain.js';

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
    validation
  };
}

export function createCheckpoint(task: Task, summary: string): Checkpoint {
  return {
    state: task.state,
    transitionCount: task.transitions.length,
    artifactCount: task.artifacts.length,
    summary
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
