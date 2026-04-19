import { runStructuredRoleLlmAgent } from './llm-adapter.js';
import type { AgentExecutionOptions, AgentRunInput, AgentRunOutput } from './types.js';

export async function runArchitectAgent(input: AgentRunInput, options?: AgentExecutionOptions): Promise<AgentRunOutput> {
  return runStructuredRoleLlmAgent('architect', input, options?.llm ?? {});
}
