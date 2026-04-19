import type { LlmGenerateRequest, LlmGenerateResponse, LlmProvider } from './types.js';

export const MOCK_MODEL = 'mock-deterministic-v1';

export class MockLlmProvider implements LlmProvider {
  readonly name = 'mock' as const;

  async generate(request: LlmGenerateRequest): Promise<LlmGenerateResponse> {
    const structuredResponse = buildStructuredMockResponse(request);
    if (structuredResponse) {
      return {
        provider: this.name,
        model: MOCK_MODEL,
        text: JSON.stringify(structuredResponse)
      };
    }

    return {
      provider: this.name,
      model: MOCK_MODEL,
      text: `[mock:${MOCK_MODEL}] ${request.prompt}`
    };
  }
}

function buildStructuredMockResponse(request: LlmGenerateRequest): Record<string, unknown> | undefined {
  if (!request.system?.includes('controlled delivery workflow')) {
    return undefined;
  }

  const prompt = parsePrompt(request.prompt);
  if (!prompt) {
    return undefined;
  }

  if (prompt.role === 'pm') {
    return buildPmPayload(prompt);
  }

  if (prompt.role === 'architect') {
    return buildArchitectPayload(prompt);
  }

  if (prompt.role === 'qa') {
    return buildQaPayload(prompt);
  }

  if (prompt.role === 'developer') {
    return buildDeveloperPayload(prompt);
  }

  return undefined;
}

function buildPmPayload(prompt: MockPrompt): Record<string, unknown> {
  const needsOwnerDecision = /预算冲突|范围冲突|优先级冲突|拍板|审批/u.test(prompt.taskSummary);
  const riskLevel = needsOwnerDecision ? 'high' : hasMediumOrHighRisk(prompt) ? 'medium' : 'low';
  const risks = needsOwnerDecision
    ? ['存在预算/范围冲突，需老板确认交付优先级']
    : prompt.riskSignals.map((signal) => signal.description);

  return {
    summary: needsOwnerDecision ? 'PM 识别到优先级冲突，建议先老板拍板' : 'PM 输出可执行计划',
    confidence: 0.88,
    riskLevel,
    risks,
    needsOwnerDecision,
    nextAction: needsOwnerDecision ? 'request_owner_decision' : 'continue',
    artifactContent: `围绕需求拆分最小闭环步骤：${prompt.taskSummary}`
  };
}

function buildArchitectPayload(prompt: MockPrompt): Record<string, unknown> {
  const hasMediumRisk = hasMediumOrHighRisk(prompt);

  return {
    summary: 'Architect 输出骨架设计说明',
    confidence: 0.86,
    riskLevel: hasMediumRisk ? 'medium' : 'low',
    risks: hasMediumRisk ? ['架构侧识别到中高风险信号，建议先收敛边界'] : [],
    needsOwnerDecision: false,
    nextAction: 'continue',
    artifactContent: '采用 Leader 单入口 + 轻量状态机 + 结构化产物模型。'
  };
}

function buildQaPayload(prompt: MockPrompt): Record<string, unknown> {
  const hasKnownRisks = prompt.riskSignals.length > 0;

  return {
    summary: 'QA 输出测试结论',
    confidence: 0.87,
    riskLevel: hasKnownRisks ? 'medium' : 'low',
    risks: hasKnownRisks ? prompt.riskSignals.map((signal) => signal.description) : [],
    needsOwnerDecision: false,
    nextAction: 'continue',
    artifactContent: '对最小闭环进行基础验证，确认状态推进与交付报告生成。'
  };
}

function buildDeveloperPayload(prompt: MockPrompt): Record<string, unknown> {
  const safeTaskId = sanitizeTaskId(prompt.taskId);

  return {
    summary: 'Developer 通过 mock 生成结构化 patch proposal',
    confidence: 0.89,
    riskLevel: 'low',
    risks: [],
    needsOwnerDecision: false,
    nextAction: 'continue',
    patchProposal: {
      format: 'devteam.patch-proposal.v1',
      summary: '新增 mock developer proposal 占位文件',
      rationale: '让显式 mock provider 也走受控 proposal 校验与写入链路，同时避免污染普通代码路径。',
      verificationPlan: ['运行 agent protocol 测试', '运行 leader workflow 验证'],
      changes: [
        {
          path: `.devteam-os/mock-developer-proposal-${safeTaskId}.ts`,
          operation: 'add',
          purpose: '写入可预测且低侵入的 mock proposal 文件',
          content: [
            `export const mockDeveloperProposalTaskId = ${JSON.stringify(prompt.taskId || 'task_unknown')};`,
            `export const mockDeveloperProposalSummary = ${JSON.stringify(prompt.taskSummary || 'mock developer proposal')};`,
            ''
          ].join('\n')
        }
      ]
    }
  };
}

function hasMediumOrHighRisk(prompt: MockPrompt): boolean {
  return prompt.riskSignals.some((signal) => signal.level === 'medium' || signal.level === 'high');
}

interface MockPrompt {
  role?: string;
  taskId?: string;
  taskSummary: string;
  riskSignals: Array<{
    description: string;
    level?: string | undefined;
  }>;
}

function parsePrompt(prompt: string): MockPrompt | undefined {
  let payload: unknown;

  try {
    payload = JSON.parse(prompt);
  } catch {
    return undefined;
  }

  if (!isRecord(payload)) {
    return undefined;
  }

  const taskSummary = typeof payload.taskSummary === 'string' ? payload.taskSummary : '';
  const riskSignals = Array.isArray(payload.riskSignals)
    ? payload.riskSignals
        .filter(isRecord)
        .map((signal) => {
          const description = typeof signal.description === 'string' ? signal.description : '';

          if (typeof signal.level === 'string') {
            return {
              level: signal.level,
              description
            };
          }

          return { description };
        })
        .filter((signal) => signal.description.length > 0)
    : [];

  return {
    ...(typeof payload.role === 'string' ? { role: payload.role } : {}),
    ...(typeof payload.taskId === 'string' ? { taskId: payload.taskId } : {}),
    taskSummary,
    riskSignals
  };
}

function sanitizeTaskId(taskId: string | undefined): string {
  const normalized = (taskId ?? 'task-unknown').trim().replace(/[^a-zA-Z0-9_-]+/gu, '-');
  return normalized.length > 0 ? normalized : 'task-unknown';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
