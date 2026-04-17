import { createArtifact } from '../artifacts.js';
import type { AgentRunInput, AgentRunOutput } from './types.js';

export function runDeveloperAgent(_input: AgentRunInput): AgentRunOutput {
  return {
    role: 'developer',
    summary: 'Developer 输出实现摘要',
    artifact: createArtifact('code_summary', '实现摘要', 'developer', '生成原型闭环所需代码骨架与占位执行逻辑。')
  };
}
