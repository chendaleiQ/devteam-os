import { createArtifact } from '../artifacts.js';
import type { NextAction, RiskLevel } from '../domain.js';
import { createLlmProvider, LlmSchemaError, type LlmProviderConfig } from '../llm/index.js';
import { parsePatchProposal, type PatchProposal } from '../patch-proposal.js';
import type { AgentRole, AgentRunInput, AgentRunOutput } from './types.js';

type LlmEnabledRole = Extract<AgentRole, 'pm' | 'architect' | 'qa'>;

interface LlmRolePayload {
  summary: string;
  confidence: number;
  riskLevel: RiskLevel;
  risks: string[];
  needsOwnerDecision: boolean;
  nextAction: NextAction;
  artifactContent: string;
}

const ROLE_ARTIFACT_CONFIG: Record<LlmEnabledRole, { kind: AgentRunOutput['artifact']['kind']; title: string }> = {
  pm: { kind: 'implementation_plan', title: '实施计划' },
  architect: { kind: 'architecture_note', title: '架构说明' },
  qa: { kind: 'test_report', title: '测试报告' }
};

const ALLOWED_KEYS = new Set<keyof LlmRolePayload>([
  'summary',
  'confidence',
  'riskLevel',
  'risks',
  'needsOwnerDecision',
  'nextAction',
  'artifactContent'
]);

interface LlmDeveloperPayload {
  summary: string;
  confidence: number;
  riskLevel: RiskLevel;
  risks: string[];
  needsOwnerDecision: boolean;
  nextAction: NextAction;
  patchProposal: PatchProposal;
}

const DEVELOPER_ALLOWED_KEYS = new Set<keyof LlmDeveloperPayload>([
  'summary',
  'confidence',
  'riskLevel',
  'risks',
  'needsOwnerDecision',
  'nextAction',
  'patchProposal'
]);

export async function runStructuredRoleLlmAgent(
  role: LlmEnabledRole,
  input: AgentRunInput,
  llm: LlmProviderConfig
): Promise<AgentRunOutput> {
  const provider = createLlmProvider(llm);
  const response = await provider.generate({
    system: buildSystemPrompt(role),
    prompt: buildUserPrompt(role, input)
  });
  const payload = parseLlmPayload(response.text);
  const artifactConfig = ROLE_ARTIFACT_CONFIG[role];

  return {
    role,
    summary: payload.summary,
    confidence: payload.confidence,
    riskLevel: payload.riskLevel,
    risks: payload.risks,
    needsOwnerDecision: payload.needsOwnerDecision,
    nextAction: payload.nextAction,
    artifact: createArtifact(artifactConfig.kind, artifactConfig.title, role, payload.artifactContent)
  };
}

export async function runDeveloperPatchProposalLlmAgent(
  input: AgentRunInput,
  llm: LlmProviderConfig,
  workspaceRoot: string = process.cwd()
): Promise<AgentRunOutput> {
  const provider = createLlmProvider(llm);
  const response = await provider.generate({
    system: buildDeveloperSystemPrompt(),
    prompt: buildUserPrompt('developer', input)
  });
  const payload = parseDeveloperPayload(response.text, workspaceRoot);

  return {
    role: 'developer',
    summary: payload.summary,
    confidence: payload.confidence,
    riskLevel: payload.riskLevel,
    risks: payload.risks,
    needsOwnerDecision: payload.needsOwnerDecision,
    nextAction: payload.nextAction,
    artifact: createArtifact('patch_proposal', '结构化补丁提案', 'developer', JSON.stringify(payload.patchProposal, null, 2))
  };
}

function buildSystemPrompt(role: LlmEnabledRole): string {
  return [
    `You are the ${role} role in a controlled delivery workflow.`,
    'Return only a JSON object.',
    'Do not wrap JSON in markdown fences.',
    'Do not include any fields other than: summary, confidence, riskLevel, risks, needsOwnerDecision, nextAction, artifactContent.',
    'confidence must be a number between 0 and 1.',
    'riskLevel must be one of: low, medium, high.',
    'nextAction must be one of: continue, request_owner_decision, trigger_meeting, rework, block.'
  ].join(' ');
}

function buildDeveloperSystemPrompt(): string {
  return [
    'You are the developer role in a controlled delivery workflow.',
    'Return only a JSON object.',
    'Do not wrap JSON in markdown fences.',
    'Do not include any fields other than: summary, confidence, riskLevel, risks, needsOwnerDecision, nextAction, patchProposal.',
    'confidence must be a number between 0 and 1.',
    'riskLevel must be one of: low, medium, high.',
    'nextAction must be one of: continue, request_owner_decision, trigger_meeting, rework, block.',
    'patchProposal must be a JSON object with format, summary, rationale, verificationPlan, and changes.',
    'patchProposal.format must be devteam.patch-proposal.v1.',
    'Each change must include path, operation, purpose, and content.',
    'Only use add or update operations.',
    'Prefer safe, predictable, low-intrusion paths under .devteam-os/ when generating mockable proposals.'
  ].join(' ');
}

function buildUserPrompt(role: AgentRole, input: AgentRunInput): string {
  return JSON.stringify(
    {
      role,
      taskId: input.taskId,
      taskSummary: input.taskSummary,
      currentStatus: input.currentStatus,
      contextSummary: input.contextSummary,
      requestedOutcome: input.requestedOutcome,
      riskSignals: input.riskSignals,
      artifacts: input.artifacts.map((artifact) => ({
        kind: artifact.kind,
        title: artifact.title,
        createdBy: artifact.createdBy,
        content: artifact.content
      }))
    },
    null,
    2
  );
}

function parseLlmPayload(text: string): LlmRolePayload {
  let payload: unknown;

  try {
    payload = JSON.parse(text);
  } catch {
    throw new LlmSchemaError('Agent LLM output is not valid JSON');
  }

  if (!isRecord(payload)) {
    throw new LlmSchemaError('Agent LLM output must be a JSON object');
  }

  const keys = Object.keys(payload);
  for (const key of keys) {
    if (!ALLOWED_KEYS.has(key as keyof LlmRolePayload)) {
      throw new LlmSchemaError(`Agent LLM output contains unsupported field: ${key}`);
    }
  }

  const { summary, confidence, riskLevel, risks, needsOwnerDecision, nextAction, artifactContent } = payload;

  if (typeof summary !== 'string' || summary.trim().length === 0) {
    throw new LlmSchemaError('Agent LLM output missing valid summary');
  }
  if (typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new LlmSchemaError('Agent LLM output missing valid confidence');
  }
  if (riskLevel !== 'low' && riskLevel !== 'medium' && riskLevel !== 'high') {
    throw new LlmSchemaError('Agent LLM output missing valid riskLevel');
  }
  const normalizedRisks = normalizeRisks(risks);
  if (normalizedRisks === null) {
    throw new LlmSchemaError('Agent LLM output missing valid risks');
  }
  if (typeof needsOwnerDecision !== 'boolean') {
    throw new LlmSchemaError('Agent LLM output missing valid needsOwnerDecision');
  }
  if (!isNextAction(nextAction)) {
    throw new LlmSchemaError('Agent LLM output missing valid nextAction');
  }
  const normalizedArtifactContent = normalizeArtifactContent(artifactContent);
  if (normalizedArtifactContent === null) {
    throw new LlmSchemaError('Agent LLM output missing valid artifactContent');
  }

  return {
    summary,
    confidence,
    riskLevel,
    risks: normalizedRisks,
    needsOwnerDecision,
    nextAction,
    artifactContent: normalizedArtifactContent
  };
}

function parseDeveloperPayload(text: string, workspaceRoot: string): LlmDeveloperPayload {
  let payload: unknown;

  try {
    payload = JSON.parse(text);
  } catch {
    throw new LlmSchemaError('Agent LLM output is not valid JSON');
  }

  if (!isRecord(payload)) {
    throw new LlmSchemaError('Agent LLM output must be a JSON object');
  }

  for (const key of Object.keys(payload)) {
    if (!DEVELOPER_ALLOWED_KEYS.has(key as keyof LlmDeveloperPayload)) {
      throw new LlmSchemaError(`Agent LLM output contains unsupported field: ${key}`);
    }
  }

  const { summary, confidence, riskLevel, risks, needsOwnerDecision, nextAction, patchProposal } = payload;

  if (typeof summary !== 'string' || summary.trim().length === 0) {
    throw new LlmSchemaError('Agent LLM output missing valid summary');
  }
  if (typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new LlmSchemaError('Agent LLM output missing valid confidence');
  }
  if (riskLevel !== 'low' && riskLevel !== 'medium' && riskLevel !== 'high') {
    throw new LlmSchemaError('Agent LLM output missing valid riskLevel');
  }
  const normalizedRisks = normalizeRisks(risks);
  if (normalizedRisks === null) {
    throw new LlmSchemaError('Agent LLM output missing valid risks');
  }
  if (typeof needsOwnerDecision !== 'boolean') {
    throw new LlmSchemaError('Agent LLM output missing valid needsOwnerDecision');
  }
  if (!isNextAction(nextAction)) {
    throw new LlmSchemaError('Agent LLM output missing valid nextAction');
  }

  try {
    return {
      summary,
      confidence,
      riskLevel,
      risks: normalizedRisks,
      needsOwnerDecision,
      nextAction,
      patchProposal: parsePatchProposal(JSON.stringify(patchProposal), workspaceRoot)
    };
  } catch (error) {
    if (error instanceof Error) {
      throw new LlmSchemaError(`Agent LLM output missing valid patchProposal: ${error.message}`);
    }
    throw new LlmSchemaError('Agent LLM output missing valid patchProposal');
  }
}

function isNextAction(value: unknown): value is NextAction {
  return value === 'continue'
    || value === 'request_owner_decision'
    || value === 'trigger_meeting'
    || value === 'rework'
    || value === 'block';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeArtifactContent(value: unknown): string | null {
  if (typeof value === 'string') {
    return value.trim().length > 0 ? value : null;
  }

  if (Array.isArray(value) || isRecord(value)) {
    return JSON.stringify(value, null, 2);
  }

  return null;
}

function normalizeRisks(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  if (value.every((risk) => typeof risk === 'string')) {
    return value;
  }

  if (value.every((risk) => isRecord(risk) && typeof risk.description === 'string')) {
    return value.map((risk) => risk.description as string);
  }

  return null;
}
