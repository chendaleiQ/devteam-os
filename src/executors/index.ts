import { OpenHandsExternalExecutor } from './openhands.js';
import type { ExternalExecutor } from './types.js';

export type {
  ExternalExecutor,
  ExecutorArtifacts,
  ExecutorPhase,
  ExecutorProgressEvent,
  ExecutorProgressKind,
  ExecutorRoleOutput,
  ExecutorRunState,
  ExecutorRunStatus,
  ExecutorSubmission,
  ExecutorTaskInput
} from './types.js';

const executorRegistry: Record<string, ExternalExecutor> = {
  openhands: new OpenHandsExternalExecutor()
};

export function resolveExternalExecutor(executor?: string | ExternalExecutor): ExternalExecutor {
  if (executor && typeof executor !== 'string') {
    return executor;
  }

  const requestedExecutor = executor ?? process.env.DEVTEAM_EXECUTOR ?? 'openhands';
  const resolvedExecutor = executorRegistry[requestedExecutor];

  if (!resolvedExecutor) {
    throw new Error(`Unknown external executor: ${requestedExecutor}`);
  }

  return resolvedExecutor;
}
