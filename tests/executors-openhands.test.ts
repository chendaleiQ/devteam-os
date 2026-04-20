import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { OpenHandsExternalExecutor } from '../src/executors/openhands.js';
import type { ExecutorTaskInput } from '../src/executors/types.js';

const tempDirs: string[] = [];
const ENV_KEYS = [
  'MINIMAX_API_KEY',
  'MINIMAX_MODEL',
  'MINIMAX_BASE_URL',
  'LLM_API_KEY',
  'LLM_MODEL',
  'LLM_BASE_URL',
  'OPENHANDS_PERSISTENCE_DIR',
  'OPENHANDS_CONVERSATIONS_DIR',
  'OPENHANDS_WORK_DIR',
  'OPENHANDS_SUPPRESS_BANNER'
] as const;

afterEach(() => {
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }

  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('OpenHands executor', () => {
  it('缺少 LLM 必要环境变量时会提前失败并给出明确原因', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'devteam-os-openhands-missing-env-'));
    tempDirs.push(workspaceRoot);

    const executor = new OpenHandsExternalExecutor();
    const submission = await executor.submitTask(createInput(workspaceRoot, 'developing'));
    const status = await executor.pollRun(submission.runId);
    const artifacts = await executor.collectArtifacts(submission.runId);

    expect(status.state).toBe('failed');
    expect(status.failureReason).toContain('LLM_API_KEY / MINIMAX_API_KEY');
    expect(status.failureReason).toContain('LLM_MODEL / MINIMAX_MODEL');
    expect(artifacts.roleOutputs).toEqual([]);
  });

  it('MiniMax key 仍是占位值时会在本地前置校验失败', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'devteam-os-openhands-minimax-placeholder-'));
    tempDirs.push(workspaceRoot);

    process.env.MINIMAX_API_KEY = '__FILL_IN_YOUR_MINIMAX_API_KEY__';

    const executor = new OpenHandsExternalExecutor();
    const submission = await executor.submitTask(createInput(workspaceRoot, 'developing'));
    const status = await executor.pollRun(submission.runId);

    expect(status.state).toBe('failed');
    expect(status.failureReason).toContain('MINIMAX_API_KEY');
  });
});

function createInput(workspaceRoot: string, phase: 'developing' | 'testing'): ExecutorTaskInput {
  return {
    taskId: 'task_123',
    taskSummary: '请实现一个本地 JSON 落盘与恢复的 TypeScript 原型',
    phase,
    currentStatus: phase,
    workspaceRoot,
    artifacts: [],
    contextSummary: 'current=planning; last=intake->planning; artifacts=1; runs=0; risks=0',
    riskSignals: [],
    requestedOutcome: phase === 'developing' ? '完成开发' : '完成测试'
  };
}
