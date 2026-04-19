import type { Artifact, ArtifactKind, NextAction, RiskLevel, RiskSignal, Role, TaskState, ValidationResult } from '../domain.js';

export type ExecutorPhase = 'developing' | 'testing';
export type ExecutorRunState = 'submitted' | 'running' | 'completed' | 'blocked' | 'failed';
export type ExecutionRole = Exclude<Role, 'leader'>;

export interface ExecutorTaskInput {
  taskId: string;
  taskSummary: string;
  phase: ExecutorPhase;
  currentStatus: TaskState;
  artifacts: Artifact[];
  contextSummary: string;
  riskSignals: RiskSignal[];
  requestedOutcome: string;
}

export interface ExecutorSubmission {
  executor: string;
  runId: string;
  phase: ExecutorPhase;
  summary: string;
}

export interface ExecutorRunStatus {
  executor: string;
  runId: string;
  phase: ExecutorPhase;
  state: ExecutorRunState;
  summary: string;
  blockingReason?: string;
  failureReason?: string;
}

export interface ExecutorArtifactSpec {
  kind: ArtifactKind;
  title: string;
  content: string;
}

export interface ExecutorRoleOutput {
  role: ExecutionRole;
  summary: string;
  confidence: number;
  riskLevel: RiskLevel;
  risks: string[];
  needsOwnerDecision: boolean;
  nextAction: NextAction;
  artifact: ExecutorArtifactSpec;
  failureReason?: string;
}

export interface ExecutorArtifacts {
  summary: string;
  roleOutputs: ExecutorRoleOutput[];
  validation?: ValidationResult;
  links?: Array<{ label: string; url: string }>;
}

export interface ExternalExecutor {
  readonly name: string;
  submitTask(input: ExecutorTaskInput): Promise<ExecutorSubmission>;
  pollRun(runId: string): Promise<ExecutorRunStatus>;
  requestChanges(runId: string, note: string): Promise<void>;
  approve(runId: string): Promise<void>;
  collectArtifacts(runId: string): Promise<ExecutorArtifacts>;
}
