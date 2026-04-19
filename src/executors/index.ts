import { MockExternalExecutor } from './mock.js';
import type { ExternalExecutor } from './types.js';

export type { ExternalExecutor, ExecutorArtifacts, ExecutorPhase, ExecutorRoleOutput, ExecutorRunState, ExecutorRunStatus, ExecutorSubmission, ExecutorTaskInput } from './types.js';

const executorRegistry: Record<string, ExternalExecutor> = {
  'mock-executor': new MockExternalExecutor(),
  mock: new MockExternalExecutor()
};

export function resolveExternalExecutor(executor?: string | ExternalExecutor): ExternalExecutor {
  if (executor && typeof executor !== 'string') {
    return executor;
  }

  const requestedExecutor = executor ?? process.env.DEVTEAM_EXECUTOR ?? 'mock-executor';
  const resolvedExecutor = executorRegistry[requestedExecutor];

  if (!resolvedExecutor) {
    throw new Error(`Unknown external executor: ${requestedExecutor}`);
  }

  return resolvedExecutor;
}
