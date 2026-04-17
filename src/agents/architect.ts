import { createArtifact } from '../artifacts.js';
import type { AgentRunInput, AgentRunOutput } from './types.js';

export function runArchitectAgent(_input: AgentRunInput): AgentRunOutput {
  return {
    role: 'architect',
    summary: 'Architect 输出骨架设计说明',
    artifact: createArtifact('architecture_note', '架构说明', 'architect', '采用 Leader 单入口 + 轻量状态机 + 结构化产物模型。')
  };
}
