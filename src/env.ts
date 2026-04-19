import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { config as loadDotenv, parse as parseDotenv } from 'dotenv';

const loadedEnvPaths = new Set<string>();

interface LoadProjectEnvOptions {
  scope?: string;
  managedKeys?: readonly string[];
}

interface ScopedEnvState {
  envPath: string | undefined;
  injectedValues: Map<string, string>;
}

const scopedEnvStates = new Map<string, ScopedEnvState>();

export function loadProjectEnv(rootDir: string | undefined, options: LoadProjectEnvOptions = {}): void {
  if (options.scope) {
    loadScopedProjectEnv(rootDir, options.scope, options.managedKeys);
    return;
  }

  if (!rootDir) {
    return;
  }

  const envPath = resolve(rootDir, '.env');

  if (loadedEnvPaths.has(envPath) || !existsSync(envPath)) {
    return;
  }

  loadDotenv({ path: envPath, override: false, quiet: true });
  loadedEnvPaths.add(envPath);
}

function loadScopedProjectEnv(rootDir: string | undefined, scope: string, managedKeys?: readonly string[]): void {
  const state = getScopedEnvState(scope);
  const envPath = rootDir ? resolve(rootDir, '.env') : undefined;

  if (envPath === state.envPath) {
    return;
  }

  clearScopedEnv(state);
  state.envPath = envPath;

  if (!envPath || !existsSync(envPath)) {
    return;
  }

  const parsed = parseDotenv(readFileSync(envPath, 'utf8'));
  const keys = managedKeys ?? Object.keys(parsed);

  for (const key of keys) {
    const value = parsed[key];

    if (typeof value !== 'string' || value.length === 0 || process.env[key] !== undefined) {
      continue;
    }

    process.env[key] = value;
    state.injectedValues.set(key, value);
  }
}

function getScopedEnvState(scope: string): ScopedEnvState {
  const existingState = scopedEnvStates.get(scope);

  if (existingState) {
    return existingState;
  }

  const state: ScopedEnvState = { envPath: undefined, injectedValues: new Map() };
  scopedEnvStates.set(scope, state);
  return state;
}

function clearScopedEnv(state: ScopedEnvState): void {
  for (const [key, value] of state.injectedValues) {
    if (process.env[key] === value) {
      delete process.env[key];
    }
  }

  state.injectedValues.clear();
}
