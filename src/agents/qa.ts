import { createArtifact } from '../artifacts.js';
import type { AgentRunInput, AgentRunOutput } from './types.js';

export function runQaAgent(_input: AgentRunInput): AgentRunOutput {
  return {
    role: 'qa',
    summary: 'QA 输出测试结论',
    artifact: createArtifact('test_report', '测试报告', 'qa', '对最小闭环进行基础验证，确认状态推进与交付报告生成。')
  };
}
