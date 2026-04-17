import { runArchitectAgent } from './architect.js';
import { runDeveloperAgent } from './developer.js';
import { runPmAgent } from './pm.js';
import { runQaAgent } from './qa.js';
import type { AgentAdapter, AgentRole, AgentRunOutput } from './types.js';

export type { AgentAdapter, AgentRole, AgentRunInput, AgentRunOutput } from './types.js';

export const agentRegistry: Record<AgentRole, AgentAdapter> = {
  pm: runPmAgent,
  architect: runArchitectAgent,
  developer: runDeveloperAgent,
  qa: runQaAgent
};

export function runAgent(role: AgentRole, input: string): AgentRunOutput {
  return agentRegistry[role]({ input });
}
