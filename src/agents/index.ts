import { runArchitectAgent } from './architect.js';
import { runDeveloperAgent } from './developer.js';
import { runPmAgent } from './pm.js';
import { runQaAgent } from './qa.js';
import type { AgentAdapter, AgentExecutionOptions, AgentRole, AgentRunInput, AgentRunOutput } from './types.js';

export type { AgentAdapter, AgentExecutionOptions, AgentRole, AgentRunInput, AgentRunOutput } from './types.js';

export const agentRegistry: Record<AgentRole, AgentAdapter> = {
  pm: runPmAgent,
  architect: runArchitectAgent,
  developer: runDeveloperAgent,
  qa: runQaAgent
};

export async function runAgent(role: AgentRole, input: AgentRunInput, options?: AgentExecutionOptions): Promise<AgentRunOutput> {
  return await agentRegistry[role](input, options);
}
