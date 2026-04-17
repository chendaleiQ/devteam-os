import type { Artifact, ArtifactKind, DeliveryReport, Role, Task, ValidationResult } from './domain.js';

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
  return {
    finalState: task.state,
    summary: validation.passed ? '最小 Leader 闭环已跑通' : '任务暂停，等待补充或返工',
    completedSteps: task.transitions.map((transition) => `${transition.from} -> ${transition.to}`),
    pendingItems: validation.passed ? [] : validation.issues,
    artifactIds: task.artifacts.map((artifact) => artifact.id),
    validation
  };
}

export function createId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}
