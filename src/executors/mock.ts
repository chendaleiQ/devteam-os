import type { ExternalExecutor, ExecutorArtifacts, ExecutorPhase, ExecutorRoleOutput, ExecutorRunStatus, ExecutorSubmission, ExecutorTaskInput } from './types.js';

interface StoredRun {
  submission: ExecutorSubmission;
  status: ExecutorRunStatus;
  artifacts: ExecutorArtifacts;
}

export class MockExternalExecutor implements ExternalExecutor {
  readonly name = 'mock-executor';

  private readonly runs = new Map<string, StoredRun>();

  async submitTask(input: ExecutorTaskInput): Promise<ExecutorSubmission> {
    const runId = `exec_${Math.random().toString(36).slice(2, 10)}`;
    const submission: ExecutorSubmission = {
      executor: this.name,
      runId,
      phase: input.phase,
      summary: input.phase === 'developing'
        ? 'Mock executor 已接受开发阶段任务'
        : 'Mock executor 已接受测试阶段任务'
    };

    const status = buildRunStatus(input, this.name, runId);
    const artifacts = buildArtifacts(input);
    this.runs.set(runId, { submission, status, artifacts });
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
}

function buildRunStatus(input: ExecutorTaskInput, executorName: string, runId: string): ExecutorRunStatus {
  if (/执行器阻塞|executor blocked/u.test(input.taskSummary)) {
    return {
      executor: executorName,
      runId,
      phase: input.phase,
      state: 'blocked',
      summary: '外部执行器报告存在阻塞条件',
      blockingReason: '外部执行器缺少继续推进所需条件'
    };
  }

  if (/执行器失败|executor failed/u.test(input.taskSummary)) {
    return {
      executor: executorName,
      runId,
      phase: input.phase,
      state: 'failed',
      summary: '外部执行器执行失败',
      failureReason: '外部执行器返回失败状态'
    };
  }

  return {
    executor: executorName,
    runId,
    phase: input.phase,
    state: 'completed',
    summary: input.phase === 'developing'
      ? '外部执行器已完成开发阶段'
      : '外部执行器已完成测试阶段'
  };
}

function buildArtifacts(input: ExecutorTaskInput): ExecutorArtifacts {
  if (input.phase === 'developing') {
    const needsRework = /失败|回流|补齐/u.test(input.contextSummary);

    const roleOutputs: ExecutorRoleOutput[] = [
      {
        role: 'architect',
        summary: '外部执行器已生成架构边界说明',
        confidence: 0.87,
        riskLevel: needsRework ? 'medium' : 'low',
        risks: needsRework ? ['当前处于回流修复阶段，需关注改动边界'] : [],
        needsOwnerDecision: false,
        nextAction: 'continue',
        artifact: {
          kind: 'architecture_note',
          title: '架构说明',
          content: '外部执行器建议保持单入口治理层结构，并将真实开发执行委托给接入的执行平台。'
        }
      },
      {
        role: 'developer',
        summary: needsRework ? '外部执行器已根据回流结果补齐实现' : '外部执行器已完成实现阶段产出',
        confidence: 0.9,
        riskLevel: needsRework ? 'medium' : 'low',
        risks: needsRework ? ['修复阶段需再次验证关键路径'] : [],
        needsOwnerDecision: false,
        nextAction: needsRework ? 'rework' : 'continue',
        artifact: {
          kind: 'code_summary',
          title: '实现摘要',
          content: needsRework
            ? '外部执行器已根据失败验证结果补齐实现，并准备重新验证。'
            : '外部执行器已输出当前需求对应的实现摘要与改动说明。'
        }
      }
    ];

    return {
      summary: '外部执行器已返回开发阶段产物',
      roleOutputs
    };
  }

  const failedValidation = /失败|fail|error|报错/u.test(`${input.taskSummary}\n${input.contextSummary}`);

  return {
    summary: failedValidation ? '外部执行器报告验证失败' : '外部执行器报告验证通过',
    roleOutputs: [
      {
        role: 'qa',
        summary: failedValidation ? '外部执行器识别到验证失败并建议回流修复' : '外部执行器已完成验证并建议进入汇报',
        confidence: 0.88,
        riskLevel: failedValidation ? 'medium' : 'low',
        risks: failedValidation ? ['当前验证未通过，需要回流开发'] : [],
        needsOwnerDecision: false,
        nextAction: failedValidation ? 'rework' : 'continue',
        artifact: {
          kind: 'test_report',
          title: '测试报告',
          content: failedValidation
            ? '外部执行器测试结果：存在失败项，需要回流修复。'
            : '外部执行器测试结果：关键验证已通过，可进入汇报。'
        }
      }
    ],
    validation: {
      passed: !failedValidation,
      summary: failedValidation ? '外部执行器验证失败，回流开发补齐产物' : '外部执行器验证通过，进入汇报',
      issues: failedValidation ? ['外部执行器报告验证失败，需回流修复'] : []
    }
  };
}
