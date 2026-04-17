import type { Artifact, Role } from '../domain.js';

export type AgentRole = Exclude<Role, 'leader'>;

export interface AgentRunInput {
  input: string;
}

export interface AgentRunOutput {
  role: AgentRole;
  summary: string;
  artifact: Artifact;
}

export type AgentAdapter = (input: AgentRunInput) => AgentRunOutput;
