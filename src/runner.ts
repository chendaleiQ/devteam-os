import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import type { TestCommandResolution } from './domain.js';

export interface ScriptRunResult {
  script: string;
  ok: boolean;
  blocked: boolean;
  summary: string;
}

export interface SafeScriptRunner {
  runScript(script: string): ScriptRunResult;
}

export interface SafeScriptRunnerOptions {
  availableScripts?: string[];
  allowlist?: string[];
  executor?: ScriptExecutor;
  packageJsonPath?: string;
}

export interface TestCommandResolutionOptions {
  userCommand?: string;
  repoConfigCommand?: string;
  packageScripts?: string[];
  packageJsonPath?: string;
  allowlist?: string[];
}

export interface ScriptExecutorOptions {
  shell: false;
}

export interface ScriptExecutorResult {
  status: number | null;
  stdout?: string;
  stderr?: string;
  error?: Error;
}

export type ScriptExecutor = (
  command: 'npm',
  args: ['run', string],
  options: ScriptExecutorOptions
) => ScriptExecutorResult;

const defaultAllowlist = ['typecheck', 'test', 'build'];
const safeScriptNamePattern = /^[A-Za-z0-9:_-]+$/u;
const packageScriptPreference = ['typecheck', 'test', 'build'];

export function resolveTestCommand(options: TestCommandResolutionOptions = {}): TestCommandResolution {
  const allowlist = new Set(options.allowlist ?? defaultAllowlist);
  const packageScripts = options.packageScripts ?? readPackageScripts(options.packageJsonPath);
  const availableScripts = new Set(packageScripts);

  const userCommand = normalizeScriptName(options.userCommand);
  if (userCommand) {
    return resolveExplicitCommand(userCommand, 'user', allowlist);
  }

  const repoConfigCommand = normalizeScriptName(options.repoConfigCommand);
  if (repoConfigCommand) {
    return resolveExplicitCommand(repoConfigCommand, 'repo_config', allowlist);
  }

  const packageScriptCommand = packageScriptPreference.find((script) => availableScripts.has(script) && allowlist.has(script));
  if (packageScriptCommand) {
    return {
      command: packageScriptCommand,
      source: 'package_scripts',
      reason: `从 package.json scripts 自动识别 ${packageScriptCommand}`,
      blocked: false
    };
  }

  return {
    command: '',
    source: 'unknown',
    reason: '未找到用户指定、repo 配置或可识别的 package script 测试命令',
    blocked: true
  };
}

export function createSafeScriptRunner(options: SafeScriptRunnerOptions = {}): SafeScriptRunner {
  const allowlist = new Set(options.allowlist ?? defaultAllowlist);
  const availableScripts = new Set(options.availableScripts ?? readPackageScripts(options.packageJsonPath));
  const executor = options.executor ?? spawnNpmScript;

  return {
    runScript(script: string): ScriptRunResult {
      const normalizedScript = normalizeScriptName(script);

      if (!normalizedScript || !safeScriptNamePattern.test(normalizedScript)) {
        return blockedResult(normalizedScript, '拒绝危险或空脚本名称');
      }

      if (!allowlist.has(normalizedScript)) {
        return blockedResult(normalizedScript, '拒绝不在 allowlist 内的 package script');
      }

      if (!availableScripts.has(normalizedScript)) {
        return blockedResult(normalizedScript, '拒绝 package.json 中不存在的 package script');
      }

      const runResult = executor('npm', ['run', normalizedScript], { shell: false });
      const ok = runResult.status === 0;

      return {
        script: normalizedScript,
        ok,
        blocked: false,
        summary: ok
          ? `已安全执行 package script: ${normalizedScript}`
          : `package script 执行失败: ${normalizedScript}${runResult.stderr ? `; ${runResult.stderr}` : ''}`
      };
    }
  };
}

function spawnNpmScript(command: 'npm', args: ['run', string], options: ScriptExecutorOptions): ScriptExecutorResult {
  const result = spawnSync(command, args, {
    shell: options.shell,
    encoding: 'utf8'
  });

  const output: ScriptExecutorResult = {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr
  };

  if (result.error) {
    output.error = result.error;
  }

  return output;
}

function readPackageScripts(packageJsonPath = resolve(process.cwd(), 'package.json')): string[] {
  try {
    const parsed = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { scripts?: Record<string, unknown> };
    return Object.entries(parsed.scripts ?? {})
      .filter(([, value]) => typeof value === 'string')
      .map(([name]) => name);
  } catch {
    return [];
  }
}

function resolveExplicitCommand(
  command: string,
  source: 'user' | 'repo_config',
  allowlist: Set<string>
): TestCommandResolution {
  if (!safeScriptNamePattern.test(command)) {
    return {
      command,
      source,
      reason: '拒绝危险或空测试脚本名称',
      blocked: true
    };
  }

  if (!allowlist.has(command)) {
    return {
      command,
      source,
      reason: '拒绝不在 allowlist 内的测试脚本名称',
      blocked: true
    };
  }

  return {
    command,
    source,
    reason: source === 'user' ? '使用用户指定测试命令' : '使用 repo 配置测试命令',
    blocked: false
  };
}

function normalizeScriptName(script?: string): string {
  return script?.trim() ?? '';
}

function blockedResult(script: string, summary: string): ScriptRunResult {
  return {
    script,
    ok: false,
    blocked: true,
    summary
  };
}
