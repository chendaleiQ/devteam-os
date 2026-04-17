import { describe, expect, it } from 'vitest';

import { createSafeScriptRunner, resolveTestCommand } from '../src/runner.js';

describe('safe script runner', () => {
  it('拒绝不在 allowlist 内的脚本', () => {
    const runner = createSafeScriptRunner({ availableScripts: ['test', 'typecheck', 'build'] });

    expect(runner.runScript('deploy')).toMatchObject({
      ok: false,
      blocked: true
    });
  });

  it('拒绝危险脚本名称', () => {
    const runner = createSafeScriptRunner({ availableScripts: ['test', 'typecheck', 'build'] });

    expect(runner.runScript('git reset --hard')).toMatchObject({
      ok: false,
      blocked: true
    });
  });

  it('拒绝 package.json 中不存在的 script', () => {
    const runner = createSafeScriptRunner({
      allowlist: ['typecheck', 'build'],
      availableScripts: ['typecheck']
    });

    expect(runner.runScript('build')).toMatchObject({
      ok: false,
      blocked: true
    });
  });

  it('使用无 shell 的 npm run 参数调用 executor', async () => {
    const calls: Array<{ command: string; args: string[]; shell?: boolean }> = [];
    const runner = createSafeScriptRunner({
      allowlist: ['typecheck'],
      availableScripts: ['typecheck'],
      executor: (command, args, options) => {
        calls.push({ command, args, shell: options.shell });
        return { status: 0, stdout: 'ok', stderr: '' };
      }
    });

    const result = await runner.runScript('typecheck');

    expect(result).toMatchObject({ ok: true, blocked: false });
    expect(calls).toEqual([
      {
        command: 'npm',
        args: ['run', 'typecheck'],
        shell: false
      }
    ]);
  });
});

describe('test command resolution', () => {
  it('用户指定命令优先', () => {
    expect(resolveTestCommand({
      userCommand: 'test',
      repoConfigCommand: 'typecheck',
      packageScripts: ['build']
    })).toMatchObject({
      command: 'test',
      source: 'user',
      blocked: false
    });
  });

  it('repo 配置命令次之', () => {
    expect(resolveTestCommand({
      repoConfigCommand: 'typecheck',
      packageScripts: ['test']
    })).toMatchObject({
      command: 'typecheck',
      source: 'repo_config',
      blocked: false
    });
  });

  it('自动识别 package scripts 中的 typecheck/test/build', () => {
    expect(resolveTestCommand({ packageScripts: ['lint', 'build'] })).toMatchObject({
      command: 'build',
      source: 'package_scripts',
      blocked: false
    });

    expect(resolveTestCommand({ packageScripts: ['test', 'build'] })).toMatchObject({
      command: 'test',
      source: 'package_scripts',
      blocked: false
    });

    expect(resolveTestCommand({ packageScripts: ['typecheck', 'test', 'build'] })).toMatchObject({
      command: 'typecheck',
      source: 'package_scripts',
      blocked: false
    });
  });

  it('无可用命令时 blocked', () => {
    expect(resolveTestCommand({ packageScripts: ['lint'] })).toMatchObject({
      command: '',
      source: 'unknown',
      blocked: true
    });
  });
});
