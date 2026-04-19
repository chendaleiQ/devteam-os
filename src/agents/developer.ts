import { createArtifact } from '../artifacts.js';
import { hasConfiguredLlmProvider } from '../llm/index.js';
import { runDeveloperPatchProposalLlmAgent } from './llm-adapter.js';
import type { AgentExecutionOptions, AgentRunInput, AgentRunOutput } from './types.js';

export async function runDeveloperAgent(input: AgentRunInput, options?: AgentExecutionOptions): Promise<AgentRunOutput> {
  if (hasConfiguredLlmProvider(options?.llm)) {
    return runDeveloperPatchProposalLlmAgent(input, options?.llm ?? {}, options?.workspaceRoot);
  }

  const needsRework = /失败|回流|补齐/u.test(input.contextSummary);

  return {
    role: 'developer',
    summary: needsRework ? 'Developer 根据回流结果补充实现' : 'Developer 输出实现摘要',
    confidence: 0.83,
    riskLevel: needsRework ? 'medium' : 'low',
    risks: needsRework ? ['当前处于回流修复阶段，需关注变更稳定性'] : [],
    needsOwnerDecision: false,
    nextAction: needsRework ? 'rework' : 'continue',
    artifact: createArtifact('code_summary', '实现摘要', 'developer', '生成原型闭环所需代码骨架与占位执行逻辑。')
  };
}
