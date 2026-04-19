import { runStructuredRoleLlmAgent } from './llm-adapter.js';
import type { AgentExecutionOptions, AgentRunInput, AgentRunOutput } from './types.js';

export async function runPmAgent(input: AgentRunInput, options?: AgentExecutionOptions): Promise<AgentRunOutput> {
  return runStructuredRoleLlmAgent('pm', input, options?.llm ?? {});
}
