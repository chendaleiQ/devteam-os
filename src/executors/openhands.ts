import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { spawn } from 'node:child_process';

import type { NextAction, RiskLevel } from '../domain.js';
import type { ExternalExecutor, ExecutorArtifacts, ExecutorPhase, ExecutorProgressKind, ExecutorRunStatus, ExecutorSubmission, ExecutorTaskInput } from './types.js';

type ResultStatus = 'completed' | 'blocked' | 'failed';

interface OpenHandsExecutorConfig {
  command?: string;
}

interface OpenHandsDevelopingResult {
  status: ResultStatus;
  summary: string;
  architecture_note?: string;
  code_summary?: string;
  risks?: string[];
  risk_level?: RiskLevel;
  needs_owner_decision?: boolean;
  next_action?: NextAction;
}

interface OpenHandsTestingResult {
  status: ResultStatus;
  summary: string;
  test_report?: string;
  validation?: {
    passed: boolean;
    summary: string;
    issues: string[];
  };
  risks?: string[];
  risk_level?: RiskLevel;
  needs_owner_decision?: boolean;
  next_action?: NextAction;
}

interface StoredRun {
  submission: ExecutorSubmission;
  status: ExecutorRunStatus;
  artifacts: ExecutorArtifacts;
}

interface OpenHandsRuntimeEnv extends NodeJS.ProcessEnv {
  OPENHANDS_PERSISTENCE_DIR: string;
  OPENHANDS_CONVERSATIONS_DIR: string;
  OPENHANDS_WORK_DIR: string;
  OPENHANDS_SUPPRESS_BANNER: string;
}

const DEFAULT_MINIMAX_MODEL = 'MiniMax-M2.7';
const DEFAULT_MINIMAX_BASE_URL = 'https://api.minimaxi.com/v1';
const PLACEHOLDER_ENV_PATTERNS = [
  /^__FILL_IN_.+__$/u,
  /^__REPLACE_.+__$/u,
  /^YOUR_[A-Z0-9_]+$/u,
  /^REPLACE_[A-Z0-9_]+$/u
];

export class OpenHandsExternalExecutor implements ExternalExecutor {
  readonly name = 'openhands';

  private readonly commandOverride: string | undefined;
  private readonly runs = new Map<string, StoredRun>();

  constructor(config: OpenHandsExecutorConfig = {}) {
    this.commandOverride = config.command;
  }

  async submitTask(input: ExecutorTaskInput): Promise<ExecutorSubmission> {
    const runId = `openhands_${Math.random().toString(36).slice(2, 10)}`;
    const submission: ExecutorSubmission = {
      executor: this.name,
      runId,
      phase: input.phase,
      summary: input.phase === 'developing'
        ? 'OpenHands 已接受开发阶段任务'
        : 'OpenHands 已接受测试阶段任务'
    };

    const env = buildOpenHandsEnv(input.workspaceRoot);
    const missingEnvVars = getMissingLlmEnvVars(env);
    if (missingEnvVars.length > 0) {
      const reason = `OpenHands headless mode 缺少必要环境变量: ${missingEnvVars.join(', ')}`;
      const status = createFailedStatus(submission, reason);
      const artifacts = buildFailureArtifacts(reason);
      this.runs.set(runId, { submission, status, artifacts });
      return submission;
    }

    const resultPath = prepareResultPath(input);
    const prompt = buildOpenHandsPrompt(input, resultPath);
    emitProgress(input, 'status', 'OpenHands headless 会话已启动');
    const execution = await runOpenHandsCommand(
      this.resolveCommand(input.workspaceRoot),
      ['--headless', '--json', '--override-with-envs', '--task', prompt],
      input.workspaceRoot,
      env,
      input
    );
    emitProgress(input, execution.exitStatus === 0 ? 'status' : 'warning', `OpenHands 进程已结束 (exit=${execution.exitStatus ?? 'null'})`);

    const stdout = execution.stdout;
    const stderr = execution.stderr;
    const parsed = readResultFile(input.phase, resultPath);
    const status = buildStatus(submission, execution.exitStatus, execution.errorMessage, stdout, stderr, parsed);
    const artifacts = buildArtifacts(input.phase, parsed, stdout, stderr);

    this.runs.set(runId, {
      submission,
      status,
      artifacts
    });

    return submission;
  }

  async pollRun(runId: string): Promise<ExecutorRunStatus> {
    const run = this.runs.get(runId);
    if (!run) {
      throw new Error(`Unknown executor run: ${runId}`);
    }

    return run.status;
  }

  async requestChanges(runId: string, note: string): Promise<void> {
    if (!this.runs.has(runId)) {
      throw new Error(`Unknown executor run: ${runId}`);
    }

    void note;
  }

  async approve(runId: string): Promise<void> {
    if (!this.runs.has(runId)) {
      throw new Error(`Unknown executor run: ${runId}`);
    }
  }

  async collectArtifacts(runId: string): Promise<ExecutorArtifacts> {
    const run = this.runs.get(runId);
    if (!run) {
      throw new Error(`Unknown executor run: ${runId}`);
    }

    return run.artifacts;
  }

  private resolveCommand(workspaceRoot: string): string {
    if (this.commandOverride) {
      return this.commandOverride;
    }

    if (process.env.DEVTEAM_OPENHANDS_COMMAND) {
      return process.env.DEVTEAM_OPENHANDS_COMMAND;
    }

    const workspaceCommand = resolve(workspaceRoot, '.openhands-venv/bin/openhands');
    if (existsSync(workspaceCommand)) {
      return workspaceCommand;
    }

    return 'openhands';
  }
}

interface OpenHandsCommandExecution {
  exitStatus: number | null;
  errorMessage?: string;
  stdout: string;
  stderr: string;
}

function buildOpenHandsEnv(workspaceRoot: string): OpenHandsRuntimeEnv {
  const persistenceDir = resolve(workspaceRoot, '.devteam-os/openhands-home');
  const conversationsDir = resolve(persistenceDir, 'conversations');
  const cliHomeDir = process.env.DEVTEAM_OPENHANDS_HOME ?? resolve(persistenceDir, 'home');

  mkdirSync(conversationsDir, { recursive: true });
  mkdirSync(resolve(cliHomeDir, '.openhands'), { recursive: true });

  return {
    ...resolveOpenHandsLlmEnv(process.env),
    // OpenHands CLI 1.14 still initializes LLMProfileStore() from Path.home().
    // Keep HOME inside the workspace so auxiliary profile writes stay sandbox-safe.
    HOME: cliHomeDir,
    OPENHANDS_PERSISTENCE_DIR: process.env.OPENHANDS_PERSISTENCE_DIR ?? persistenceDir,
    OPENHANDS_CONVERSATIONS_DIR: process.env.OPENHANDS_CONVERSATIONS_DIR ?? conversationsDir,
    OPENHANDS_WORK_DIR: process.env.OPENHANDS_WORK_DIR ?? workspaceRoot,
    OPENHANDS_SUPPRESS_BANNER: process.env.OPENHANDS_SUPPRESS_BANNER ?? '1'
  };
}

function resolveOpenHandsLlmEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const minimaxApiKey = env.MINIMAX_API_KEY;
  const minimaxModel = env.MINIMAX_MODEL;
  const minimaxBaseUrl = env.MINIMAX_BASE_URL;
  const hasMiniMaxConfig = Boolean(minimaxApiKey || minimaxModel || minimaxBaseUrl);

  return {
    ...env,
    LLM_API_KEY: env.LLM_API_KEY ?? minimaxApiKey,
    LLM_MODEL: env.LLM_MODEL ?? (hasMiniMaxConfig ? normalizeMiniMaxModel(minimaxModel) : undefined),
    LLM_BASE_URL: env.LLM_BASE_URL ?? (hasMiniMaxConfig ? minimaxBaseUrl ?? DEFAULT_MINIMAX_BASE_URL : undefined)
  };
}

async function runOpenHandsCommand(
  command: string,
  args: string[],
  workspaceRoot: string,
  env: NodeJS.ProcessEnv,
  input: ExecutorTaskInput
): Promise<OpenHandsCommandExecution> {
  return await new Promise((resolvePromise) => {
    let stdout = '';
    let stderr = '';
    let stdoutBuffer = '';
    let stderrBuffer = '';
    let resolved = false;

    const child = spawn(command, args, {
      cwd: workspaceRoot,
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    const finalize = (result: OpenHandsCommandExecution): void => {
      if (resolved) {
        return;
      }

      resolved = true;
      resolvePromise(result);
    };

    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');

    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk;
      stdoutBuffer = consumeOutputBuffer(stdoutBuffer + chunk, (line) => emitOpenHandsStdoutProgress(input, line));
    });

    child.stderr?.on('data', (chunk: string) => {
      stderr += chunk;
      stderrBuffer = consumeOutputBuffer(stderrBuffer + chunk, (line) => emitOpenHandsStderrProgress(input, line));
    });

    child.once('error', (error) => {
      finalize({
        exitStatus: null,
        errorMessage: error.message,
        stdout,
        stderr
      });
    });

    child.once('close', (code) => {
      flushRemainingBuffer(stdoutBuffer, (line) => emitOpenHandsStdoutProgress(input, line));
      flushRemainingBuffer(stderrBuffer, (line) => emitOpenHandsStderrProgress(input, line));
      finalize({
        exitStatus: code,
        stdout,
        stderr
      });
    });
  });
}

function consumeOutputBuffer(buffer: string, handleLine: (line: string) => void): string {
  let nextBuffer = buffer;
  while (true) {
    const newlineIndex = nextBuffer.indexOf('\n');
    if (newlineIndex < 0) {
      return nextBuffer;
    }

    const line = nextBuffer.slice(0, newlineIndex).trim();
    nextBuffer = nextBuffer.slice(newlineIndex + 1);
    if (line) {
      handleLine(line);
    }
  }
}

function flushRemainingBuffer(buffer: string, handleLine: (line: string) => void): void {
  const line = buffer.trim();
  if (line) {
    handleLine(line);
  }
}

function emitOpenHandsStdoutProgress(input: ExecutorTaskInput, line: string): void {
  const normalizedLine = normalizeOpenHandsStdoutLine(line);
  if (!normalizedLine) {
    return;
  }

  const progress = parseOpenHandsProgressLine(input.phase, normalizedLine);
  emitProgress(input, progress.kind, progress.message, line);
}

function emitOpenHandsStderrProgress(input: ExecutorTaskInput, line: string): void {
  emitProgress(input, inferStderrKind(line), line, line);
}

function parseOpenHandsProgressLine(phase: ExecutorPhase, line: string): { kind: ExecutorProgressKind; message: string } {
  try {
    const payload = JSON.parse(line) as Record<string, unknown>;
    const message = extractOpenHandsProgressMessage(payload);
    if (message) {
      return {
        kind: inferJsonProgressKind(payload),
        message
      };
    }
  } catch {
    // Ignore JSON parse errors and fall back to raw output.
  }

  return {
    kind: 'observation',
    message: `[${phase}] ${line}`
  };
}

function normalizeOpenHandsStdoutLine(line: string): string | undefined {
  const normalized = line.trim();

  if (!normalized) {
    return undefined;
  }

  if (/^--JSON Event--$/u.test(normalized)) {
    return undefined;
  }

  if (/^[\[{]$|^[\]}],?$/u.test(normalized)) {
    return undefined;
  }

  if (/^"(activated_skills|critic_result|extended_content|id|kind|llm_message|content|name|reasoning_content|responses_reasoning_item|role|thinking_blocks|tool_call_id|tool_calls|sender|source|timestamp|cache_prompt|type|text|llm_response_id)"\s*:/u.test(normalized)) {
    return undefined;
  }

  if (/^[│╭╰─]/u.test(normalized)) {
    return undefined;
  }

  if (/^OpenHands CLI terminal UI may not work correctly/u.test(normalized) || /^To override Rich's detection/u.test(normalized)) {
    return undefined;
  }

  if (/^Number of agent messages:/u.test(normalized) || /^Last message sent by the agent:/u.test(normalized)) {
    return undefined;
  }

  return normalized;
}

function extractOpenHandsProgressMessage(payload: Record<string, unknown>): string | undefined {
  const directText = firstNonEmptyString([
    asProgressText(payload.message),
    asProgressText(payload.content),
    asProgressText(payload.summary),
    asProgressText(payload.text),
    asProgressText(payload.observation)
  ]);
  if (directText) {
    return directText;
  }

  const type = asProgressText(payload.type);
  const name = asProgressText(payload.name);
  const tool = asProgressText(payload.tool);
  const action = asProgressText(payload.action);
  const command = asProgressText(payload.command);
  const path = asProgressText(payload.path);
  const status = asProgressText(payload.status);

  const parts = [
    type,
    name,
    tool,
    action,
    command ? `command=${command}` : undefined,
    path ? `path=${path}` : undefined,
    status ? `status=${status}` : undefined
  ].filter((value): value is string => Boolean(value));

  if (parts.length > 0) {
    return parts.join(' ');
  }

  return compactJson(payload);
}

function inferJsonProgressKind(payload: Record<string, unknown>): ExecutorProgressKind {
  const rawKind = `${asProgressText(payload.level) ?? ''} ${asProgressText(payload.type) ?? ''}`.toLowerCase();
  if (rawKind.includes('error') || rawKind.includes('fail')) {
    return 'error';
  }
  if (rawKind.includes('warn')) {
    return 'warning';
  }
  if (rawKind.includes('action') || payload.command || payload.tool || payload.path) {
    return 'action';
  }
  if (rawKind.includes('status')) {
    return 'status';
  }
  return 'observation';
}

function inferStderrKind(line: string): ExecutorProgressKind {
  return /error|fail|traceback|exception/u.test(line) ? 'error' : 'warning';
}

function emitProgress(
  input: ExecutorTaskInput,
  kind: ExecutorProgressKind,
  message: string,
  raw?: string
): void {
  input.onProgress?.({
    executor: 'openhands',
    phase: input.phase,
    kind,
    message,
    ...(raw ? { raw } : {})
  });
}

function asProgressText(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const normalized = value.replace(/\s+/gu, ' ').trim();
    return normalized.length > 0 ? normalized : undefined;
  }

  if (Array.isArray(value)) {
    return firstNonEmptyString(value.map((item) => asProgressText(item)));
  }

  if (typeof value === 'object' && value !== null) {
    return compactJson(value as Record<string, unknown>);
  }

  return undefined;
}

function firstNonEmptyString(values: Array<string | undefined>): string | undefined {
  return values.find((value): value is string => Boolean(value));
}

function compactJson(payload: Record<string, unknown>): string {
  return JSON.stringify(payload).slice(0, 240);
}

function getMissingLlmEnvVars(env: NodeJS.ProcessEnv): string[] {
  const missing: string[] = [];

  if (isMissingOrPlaceholder(env.LLM_API_KEY)) {
    missing.push('LLM_API_KEY / MINIMAX_API_KEY');
  }

  if (isMissingOrPlaceholder(env.LLM_MODEL)) {
    missing.push('LLM_MODEL / MINIMAX_MODEL');
  }

  return missing;
}

function normalizeMiniMaxModel(model: string | undefined): string {
  const normalized = (model ?? DEFAULT_MINIMAX_MODEL).trim();
  return normalized.startsWith('openai/') ? normalized : `openai/${normalized}`;
}

function isMissingOrPlaceholder(value: string | undefined): boolean {
  if (!value) {
    return true;
  }

  const normalized = value.trim();
  if (!normalized) {
    return true;
  }

  return PLACEHOLDER_ENV_PATTERNS.some((pattern) => pattern.test(normalized));
}

function createFailedStatus(submission: ExecutorSubmission, failureReason: string): ExecutorRunStatus {
  return {
    executor: submission.executor,
    runId: submission.runId,
    phase: submission.phase,
    state: 'failed',
    summary: 'OpenHands 执行失败',
    failureReason
  };
}

function buildFailureArtifacts(failureReason: string): ExecutorArtifacts {
  return {
    summary: failureReason,
    roleOutputs: []
  };
}

function prepareResultPath(input: ExecutorTaskInput): string {
  const dirPath = resolve(input.workspaceRoot, '.devteam-os/openhands');
  mkdirSync(dirPath, { recursive: true });
  const resultPath = resolve(dirPath, `${input.taskId}-${input.phase}.json`);
  rmSync(resultPath, { force: true });
  return resultPath;
}

function buildOpenHandsPrompt(input: ExecutorTaskInput, resultPath: string): string {
  const relativeResultPath = relative(input.workspaceRoot, resultPath) || resultPath;

  if (input.phase === 'developing') {
    return [
      'You are OpenHands executing a DevTeamOS development-stage task.',
      'Work only in the current repository.',
      `Task: ${input.taskSummary}`,
      `Requested outcome: ${input.requestedOutcome}`,
      `Context summary: ${input.contextSummary}`,
      `Risk signals: ${JSON.stringify(input.riskSignals.map((signal) => ({
        code: signal.code,
        level: signal.level,
        description: signal.description
      })))}`,
      'Focus on implementation and architecture boundaries.',
      'At the end, write a JSON file to the exact path below and ensure it exists before exiting.',
      `Result file: ${relativeResultPath}`,
      'JSON schema:',
      '{',
      '  "status": "completed" | "blocked" | "failed",',
      '  "summary": "string",',
      '  "architecture_note": "string",',
      '  "code_summary": "string",',
      '  "risks": ["string"],',
      '  "risk_level": "low" | "medium" | "high",',
      '  "needs_owner_decision": boolean,',
      '  "next_action": "continue" | "request_owner_decision" | "trigger_meeting" | "rework" | "block"',
      '}'
    ].join('\n');
  }

  return [
    'You are OpenHands executing a DevTeamOS testing-stage task.',
    'Work only in the current repository.',
    `Task: ${input.taskSummary}`,
    `Requested outcome: ${input.requestedOutcome}`,
    `Context summary: ${input.contextSummary}`,
    `Risk signals: ${JSON.stringify(input.riskSignals.map((signal) => ({
      code: signal.code,
      level: signal.level,
      description: signal.description
    })))}`,
    'Run the appropriate verification you judge necessary for this repository, then summarize the result.',
    'At the end, write a JSON file to the exact path below and ensure it exists before exiting.',
    `Result file: ${relativeResultPath}`,
    'JSON schema:',
    '{',
    '  "status": "completed" | "blocked" | "failed",',
    '  "summary": "string",',
    '  "test_report": "string",',
    '  "validation": {',
    '    "passed": boolean,',
    '    "summary": "string",',
    '    "issues": ["string"]',
    '  },',
    '  "risks": ["string"],',
    '  "risk_level": "low" | "medium" | "high",',
    '  "needs_owner_decision": boolean,',
    '  "next_action": "continue" | "request_owner_decision" | "trigger_meeting" | "rework" | "block"',
    '}'
  ].join('\n');
}

function readResultFile(phase: ExecutorPhase, resultPath: string): OpenHandsDevelopingResult | OpenHandsTestingResult | undefined {
  if (!existsSync(resultPath)) {
    return undefined;
  }

  try {
    const raw = JSON.parse(readFileSync(resultPath, 'utf8')) as Record<string, unknown>;
    if (phase === 'developing') {
      return {
        status: normalizeStatus(raw.status),
        summary: asString(raw.summary, 'OpenHands 已完成开发阶段'),
        architecture_note: optionalString(raw.architecture_note),
        code_summary: optionalString(raw.code_summary),
        risks: normalizeStringArray(raw.risks),
        risk_level: normalizeRiskLevel(raw.risk_level),
        needs_owner_decision: Boolean(raw.needs_owner_decision),
        next_action: normalizeNextAction(raw.next_action)
      };
    }

    const validationRaw = isRecord(raw.validation) ? raw.validation : {};
    return {
      status: normalizeStatus(raw.status),
      summary: asString(raw.summary, 'OpenHands 已完成测试阶段'),
      test_report: optionalString(raw.test_report),
      validation: {
        passed: Boolean(validationRaw.passed),
        summary: asString(validationRaw.summary, 'OpenHands 已返回测试结论'),
        issues: normalizeStringArray(validationRaw.issues)
      },
      risks: normalizeStringArray(raw.risks),
      risk_level: normalizeRiskLevel(raw.risk_level),
      needs_owner_decision: Boolean(raw.needs_owner_decision),
      next_action: normalizeNextAction(raw.next_action)
    };
  } catch {
    return undefined;
  }
}

function buildStatus(
  submission: ExecutorSubmission,
  exitStatus: number | null,
  errorMessage: string | undefined,
  stdout: string,
  stderr: string,
  parsed: OpenHandsDevelopingResult | OpenHandsTestingResult | undefined
): ExecutorRunStatus {
  if (parsed?.status === 'blocked') {
    return {
      executor: submission.executor,
      runId: submission.runId,
      phase: submission.phase,
      state: 'blocked',
      summary: parsed.summary,
      blockingReason: parsed.summary
    };
  }

  if (parsed?.status === 'failed') {
    return {
      executor: submission.executor,
      runId: submission.runId,
      phase: submission.phase,
      state: 'failed',
      summary: parsed.summary,
      failureReason: parsed.summary
    };
  }

  if (exitStatus === 0 && parsed) {
    return {
      executor: submission.executor,
      runId: submission.runId,
      phase: submission.phase,
      state: 'completed',
      summary: parsed.summary
    };
  }

  const failureReason = extractFailureReason(stdout, stderr, errorMessage);
  return {
    executor: submission.executor,
    runId: submission.runId,
    phase: submission.phase,
    state: 'failed',
    summary: 'OpenHands 执行失败',
    failureReason
  };
}

function extractFailureReason(stdout: string, stderr: string, errorMessage: string | undefined): string {
  if (errorMessage) {
    return errorMessage;
  }

  const candidates = [
    ...extractFailureReasonCandidates(stdout),
    ...extractFailureReasonCandidates(stderr)
  ];

  const preferred = candidates.find((line) => /authentication|unauthorized|forbidden|permissionerror|traceback|exception|error|failed|missing/u.test(line));
  if (preferred) {
    return preferred;
  }

  return candidates[0] ?? 'OpenHands 未输出可用结果文件';
}

function extractFailureReasonCandidates(output: string): string[] {
  return output
    .split(/\r?\n/u)
    .map((line) => normalizeFailureReasonLine(line))
    .filter((line): line is string => Boolean(line));
}

function normalizeFailureReasonLine(line: string): string | undefined {
  const normalized = line.trim();
  if (!normalized) {
    return undefined;
  }

  if (/^\+[-+]+\+$/u.test(normalized) || /^[│╭╰─]/u.test(normalized)) {
    return undefined;
  }

  if (/^--JSON Event--$/u.test(normalized)) {
    return undefined;
  }

  if (/^OpenHands CLI terminal UI may not work correctly/u.test(normalized)
    || /^To override Rich's detection/u.test(normalized)
    || /^Initializing agent\.\.\.$/u.test(normalized)
    || /^✓ Agent initialized with model:/u.test(normalized)
    || /^Agent is working$/u.test(normalized)
    || /^Goodbye!/u.test(normalized)
    || /^Conversation ID:/u.test(normalized)
    || /^Hint: run openhands --resume/u.test(normalized)
    || /^conversation\.$/u.test(normalized)) {
    return undefined;
  }

  const detailMatch = normalized.match(/^"detail":\s*"(.+)"[,]?$/u);
  if (detailMatch) {
    return detailMatch[1];
  }

  const codeMatch = normalized.match(/^"code":\s*"(.+)"[,]?$/u);
  if (codeMatch) {
    return codeMatch[1];
  }

  if (/^"(activated_skills|critic_result|extended_content|id|kind|llm_message|content|name|reasoning_content|responses_reasoning_item|role|thinking_blocks|tool_call_id|tool_calls|sender|source|timestamp|cache_prompt|type|text|llm_response_id)"\s*:/u.test(normalized)) {
    return undefined;
  }

  return normalized;
}

function buildArtifacts(
  phase: ExecutorPhase,
  parsed: OpenHandsDevelopingResult | OpenHandsTestingResult | undefined,
  stdout: string,
  stderr: string
): ExecutorArtifacts {
  if (phase === 'developing') {
    const result = parsed as OpenHandsDevelopingResult | undefined;
    return {
      summary: result?.summary ?? 'OpenHands 已完成开发阶段，但未返回结构化结果文件；已回退为 transcript 摘要',
      roleOutputs: [
        {
          role: 'architect',
          summary: result?.summary ?? 'OpenHands 已返回架构阶段结果',
          confidence: 0.75,
          riskLevel: result?.risk_level ?? 'medium',
          risks: result?.risks ?? [],
          needsOwnerDecision: result?.needs_owner_decision ?? false,
          nextAction: result?.next_action ?? 'continue',
          artifact: {
            kind: 'architecture_note',
            title: 'OpenHands 架构说明',
            content: result?.architecture_note ?? buildTranscriptFallback(stdout, stderr)
          }
        },
        {
          role: 'developer',
          summary: result?.summary ?? 'OpenHands 已返回开发阶段结果',
          confidence: 0.82,
          riskLevel: result?.risk_level ?? 'medium',
          risks: result?.risks ?? [],
          needsOwnerDecision: result?.needs_owner_decision ?? false,
          nextAction: result?.next_action ?? 'continue',
          artifact: {
            kind: 'code_summary',
            title: 'OpenHands 实现摘要',
            content: result?.code_summary ?? buildTranscriptFallback(stdout, stderr)
          }
        }
      ]
    };
  }

  const result = parsed as OpenHandsTestingResult | undefined;
  const validation = result?.validation ?? {
    passed: false,
    summary: 'OpenHands 未返回结构化测试结果',
    issues: ['缺少 OpenHands testing result 文件']
  };

  return {
    summary: result?.summary ?? validation.summary,
    roleOutputs: [
      {
        role: 'qa',
        summary: result?.summary ?? validation.summary,
        confidence: 0.8,
        riskLevel: result?.risk_level ?? (validation.passed ? 'low' : 'medium'),
        risks: result?.risks ?? validation.issues,
        needsOwnerDecision: result?.needs_owner_decision ?? false,
        nextAction: result?.next_action ?? (validation.passed ? 'continue' : 'rework'),
        artifact: {
          kind: 'test_report',
          title: 'OpenHands 测试报告',
          content: result?.test_report ?? buildTranscriptFallback(stdout, stderr)
        }
      }
    ],
    validation
  };
}

function buildTranscriptFallback(stdout: string, stderr: string): string {
  const content = [stdout.trim(), stderr.trim()].filter(Boolean).join('\n\n').trim();
  return content || 'OpenHands 未返回 transcript 内容。';
}

function normalizeStatus(value: unknown): ResultStatus {
  return value === 'completed' || value === 'blocked' || value === 'failed' ? value : 'completed';
}

function normalizeRiskLevel(value: unknown): RiskLevel {
  return value === 'low' || value === 'medium' || value === 'high' ? value : 'medium';
}

function normalizeNextAction(value: unknown): NextAction {
  return value === 'continue'
    || value === 'request_owner_decision'
    || value === 'trigger_meeting'
    || value === 'rework'
    || value === 'block'
    ? value
    : 'continue';
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.length > 0) : [];
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
