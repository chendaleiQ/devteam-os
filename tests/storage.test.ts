import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';

import type { Task } from '../src/domain.js';
import { FileTaskStore } from '../src/storage.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('file task store', () => {
  it('保存并读取任务 JSON', () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'devteam-os-'));
    tempDirs.push(rootDir);
    const store = new FileTaskStore(rootDir);
    const task: Task = {
      id: 'task_file_store',
      input: '实现本地持久化',
      state: 'blocked',
      needsClarification: false,
      artifacts: [],
      agentRuns: [],
      transitions: [],
      approvalRequests: []
    };

    store.save(task);

    expect(store.get(task.id)).toEqual(task);
  });

  it('拒绝带路径分隔符或归一化别名的 taskId', () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'devteam-os-'));
    tempDirs.push(rootDir);
    const store = new FileTaskStore(rootDir);
    const baseTask: Task = {
      id: 'task_file_store',
      input: '实现本地持久化',
      state: 'blocked',
      needsClarification: false,
      artifacts: [],
      agentRuns: [],
      transitions: [],
      approvalRequests: []
    };

    expect(() => store.save({ ...baseTask, id: 'a/../b' })).toThrow('basename');
    expect(() => store.get('a/../b')).toThrow('basename');
    expect(() => store.get('a\\..\\b')).toThrow('basename');
  });

  it('损坏 JSON 时 get 返回 undefined', () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'devteam-os-'));
    tempDirs.push(rootDir);
    mkdirSync(join(rootDir, '.devteam-os/tasks'), { recursive: true });
    writeFileSync(join(rootDir, '.devteam-os/tasks/task_corrupt.json'), '{not-json', 'utf8');

    const store = new FileTaskStore(rootDir);

    expect(store.get('task_corrupt')).toBeUndefined();
  });
});
