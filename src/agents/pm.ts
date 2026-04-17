import { createArtifact } from '../artifacts.js';
import type { AgentRunInput, AgentRunOutput } from './types.js';

export function runPmAgent(input: AgentRunInput): AgentRunOutput {
  return {
    role: 'pm',
    summary: 'PM 输出可执行计划',
    artifact: createArtifact('implementation_plan', '实施计划', 'pm', `围绕需求拆分最小闭环步骤：${input.input}`)
  };
}
