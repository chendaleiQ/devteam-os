import type { Artifact, NextAction, RiskLevel, RiskSignal, Role, TaskState } from '../domain.js';
import type { LlmProviderConfig } from '../llm/index.js';

export type AgentRole = Exclude<Role, 'leader'>;

export interface AgentRunInput {
  taskId: string;
  taskSummary: string;
  currentStatus: TaskState;
  artifacts: Artifact[];
  contextSummary: string;
  riskSignals: RiskSignal[];
  requestedOutcome: string;
}

export interface AgentExecutionOptions {
  llm?: LlmProviderConfig;
  workspaceRoot?: string;
}

export interface AgentRunOutput {
  role: AgentRole;
  summary: string;
  confidence: number;
  riskLevel: RiskLevel;
  risks: string[];
  needsOwnerDecision: boolean;
  nextAction: NextAction;
  artifact: Artifact;
  failureReason?: string;
}

export type AgentAdapterResult = AgentRunOutput | Promise<AgentRunOutput>;

export type AgentAdapter = (input: AgentRunInput, options?: AgentExecutionOptions) => AgentAdapterResult;
