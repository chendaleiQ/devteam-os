import { afterEach, describe, expect, it } from 'vitest';

import { resolveExternalExecutor } from '../src/executors/index.js';

const ENV_KEYS = [
  'DEVTEAM_EXECUTOR',
  'MINIMAX_API_KEY',
  'MINIMAX_MODEL',
  'MINIMAX_BASE_URL',
  'LLM_API_KEY',
  'LLM_MODEL',
  'LLM_BASE_URL'
] as const;

afterEach(() => {
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }
});

describe('executor registry policy', () => {
  it('默认执行器固定为 openhands', () => {
    expect(resolveExternalExecutor().name).toBe('openhands');
  });

  it('mock executor 已不再被注册', () => {
    expect(() => resolveExternalExecutor('mock-executor')).toThrow('Unknown external executor: mock-executor');
    expect(() => resolveExternalExecutor('mock')).toThrow('Unknown external executor: mock');
  });
});
