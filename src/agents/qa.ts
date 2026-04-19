import { runStructuredRoleLlmAgent } from './llm-adapter.js';
import type { AgentExecutionOptions, AgentRunInput, AgentRunOutput } from './types.js';

export async function runQaAgent(input: AgentRunInput, options?: AgentExecutionOptions): Promise<AgentRunOutput> {
  return runStructuredRoleLlmAgent('qa', input, options?.llm ?? {});
}
