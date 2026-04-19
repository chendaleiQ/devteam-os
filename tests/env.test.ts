import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { loadProjectEnv } from '../src/env.js';

const tempDirs: string[] = [];
const ENV_KEYS = ['DEVTEAM_ENV_TEST_VALUE', 'DEVTEAM_ENV_TEST_EXISTING', 'DEVTEAM_ENV_TEST_ONCE'] as const;

afterEach(() => {
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }

  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('loadProjectEnv', () => {
  it('指定目录有 .env 时可加载变量', () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'devteam-os-env-'));
    tempDirs.push(rootDir);
    writeFileSync(join(rootDir, '.env'), 'DEVTEAM_ENV_TEST_VALUE=from-dotenv\n', 'utf8');

    loadProjectEnv(rootDir);

    expect(process.env.DEVTEAM_ENV_TEST_VALUE).toBe('from-dotenv');
  });

  it('.env 不存在时不报错', () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'devteam-os-env-'));
    tempDirs.push(rootDir);

    expect(() => loadProjectEnv(rootDir)).not.toThrow();
  });

  it('已有 process.env 不被 .env 覆盖', () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'devteam-os-env-'));
    tempDirs.push(rootDir);
    writeFileSync(join(rootDir, '.env'), 'DEVTEAM_ENV_TEST_EXISTING=from-dotenv\n', 'utf8');
    process.env.DEVTEAM_ENV_TEST_EXISTING = 'from-shell';

    loadProjectEnv(rootDir);

    expect(process.env.DEVTEAM_ENV_TEST_EXISTING).toBe('from-shell');
  });

  it('同一路径重复加载保持幂等', () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'devteam-os-env-'));
    tempDirs.push(rootDir);
    const envPath = join(rootDir, '.env');
    writeFileSync(envPath, 'DEVTEAM_ENV_TEST_ONCE=first\n', 'utf8');

    loadProjectEnv(rootDir);
    writeFileSync(envPath, 'DEVTEAM_ENV_TEST_ONCE=second\n', 'utf8');

    loadProjectEnv(rootDir);

    expect(process.env.DEVTEAM_ENV_TEST_ONCE).toBe('first');
  });

  it('带 scope 时切换目录会清理上一次注入的值', () => {
    const firstRoot = mkdtempSync(join(tmpdir(), 'devteam-os-env-a-'));
    const secondRoot = mkdtempSync(join(tmpdir(), 'devteam-os-env-b-'));
    tempDirs.push(firstRoot, secondRoot);
    writeFileSync(join(firstRoot, '.env'), 'DEVTEAM_ENV_TEST_VALUE=from-first\n', 'utf8');

    loadProjectEnv(firstRoot, { scope: 'leader-workspace', managedKeys: ['DEVTEAM_ENV_TEST_VALUE'] });
    loadProjectEnv(secondRoot, { scope: 'leader-workspace', managedKeys: ['DEVTEAM_ENV_TEST_VALUE'] });

    expect(process.env.DEVTEAM_ENV_TEST_VALUE).toBeUndefined();
  });

  it('带 scope 时 shell env 仍优先且不会被清理', () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'devteam-os-env-'));
    tempDirs.push(rootDir);
    writeFileSync(join(rootDir, '.env'), 'DEVTEAM_ENV_TEST_EXISTING=from-dotenv\n', 'utf8');
    process.env.DEVTEAM_ENV_TEST_EXISTING = 'from-shell';

    loadProjectEnv(rootDir, { scope: 'leader-workspace', managedKeys: ['DEVTEAM_ENV_TEST_EXISTING'] });
    loadProjectEnv(undefined, { scope: 'leader-workspace', managedKeys: ['DEVTEAM_ENV_TEST_EXISTING'] });

    expect(process.env.DEVTEAM_ENV_TEST_EXISTING).toBe('from-shell');
  });
});
