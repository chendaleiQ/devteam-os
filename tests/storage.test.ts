import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';

import type { Task } from '../src/domain.js';
import { FileTaskStore } from '../src/storage.js';

const tempDirs: string[] = [];

function createTestTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task_recovery_test',
    input: '测试 JSON 落盘与恢复',
    state: 'developing',
    needsClarification: false,
    artifacts: [],
    agentRuns: [],
    transitions: [],
    approvalRequests: [],
    ...overrides
  };
}

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
      approvalRequests: [],
      checkpoint: {
        state: 'blocked',
        transitionCount: 1,
        artifactCount: 2,
        summary: '等待补充外部依赖'
      },
      waitingSummary: {
        reason: '任务受阻，等待解除阻塞',
        requestedInput: '补充缺失依赖、信息或资源后再恢复',
        resumeTargetState: 'planning'
      },
      testCommandResolution: {
        command: 'executor:openhands',
        source: 'executor',
        reason: '验证由外部执行器 openhands 执行',
        blocked: false
      }
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

describe('backup and recovery', () => {
  it('创建新任务时不创建备份', () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'devteam-os-'));
    tempDirs.push(rootDir);
    const store = new FileTaskStore(rootDir);
    const task = createTestTask({ id: 'task_new_backup' });

    store.save(task);

    const backupPath = resolve(rootDir, '.devteam-os/backups/task_new_backup.backup.json');
    expect(existsSync(backupPath)).toBe(false);
  });

  it('更新任务时创建备份', () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'devteam-os-'));
    tempDirs.push(rootDir);
    const store = new FileTaskStore(rootDir);
    const taskV1 = createTestTask({ id: 'task_backup_update', state: 'planning' });
    const taskV2 = createTestTask({ id: 'task_backup_update', state: 'developing' });

    store.save(taskV1);
    store.save(taskV2);

    const backupPath = resolve(rootDir, '.devteam-os/backups/task_backup_update.backup.json');
    expect(existsSync(backupPath)).toBe(true);

    const backupContent = JSON.parse(readFileSync(backupPath, 'utf8'));
    expect(backupContent.state).toBe('planning');
  });

  it('从备份恢复任务', () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'devteam-os-'));
    tempDirs.push(rootDir);
    const store = new FileTaskStore(rootDir);
    const taskV1 = createTestTask({ id: 'task_recover', state: 'planning' });
    const taskV2 = createTestTask({ id: 'task_recover', state: 'developing' });

    // First save creates the file
    store.save(taskV1);
    // Second save creates backup of V1 (V1 is now in backup)
    store.save(taskV2);
    // Delete only the current file (V2), keep backup
    unlinkSync(resolve(rootDir, '.devteam-os/tasks/task_recover.json'));

    expect(store.get('task_recover')).toBeUndefined();

    // Recover from backup should restore V1
    const result = store.recoverFromBackup('task_recover');
    expect(result.success).toBe(true);
    expect(result.recovered).toBe(true);
    expect(result.task?.state).toBe('planning');
    expect(store.get('task_recover')?.state).toBe('planning');
  });

  it('无备份时恢复返回失败', () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'devteam-os-'));
    tempDirs.push(rootDir);
    const store = new FileTaskStore(rootDir);

    const result = store.recoverFromBackup('nonexistent_task');
    expect(result.success).toBe(false);
    expect(result.recovered).toBe(false);
    expect(result.reason).toBe('No backup found for this task');
  });

  it('无效备份数据恢复失败', () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'devteam-os-'));
    tempDirs.push(rootDir);
    mkdirSync(join(rootDir, '.devteam-os/backups'), { recursive: true });
    writeFileSync(
      resolve(rootDir, '.devteam-os/backups/invalid_backup.backup.json'),
      JSON.stringify({ invalid: 'data' }),
      'utf8'
    );

    const store = new FileTaskStore(rootDir);
    const result = store.recoverFromBackup('invalid_backup');

    expect(result.success).toBe(false);
    expect(result.reason).toBe('Backup file contains invalid task data');
  });

  it('自动恢复从部分 JSON 恢复成功', () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'devteam-os-'));
    tempDirs.push(rootDir);

    // Create the directory structure first
    mkdirSync(resolve(rootDir, '.devteam-os/tasks'), { recursive: true });

    // Simulate partial/corrupted file with valid JSON inside
    const validTask = createTestTask({ id: 'task_partial' });
    writeFileSync(
      resolve(rootDir, '.devteam-os/tasks/task_partial.json'),
      'garbage prefix\n' + JSON.stringify(validTask) + '\ngarbage suffix',
      'utf8'
    );

    const store = new FileTaskStore(rootDir);
    const result = store.autoRecover('task_partial');
    expect(result.success).toBe(true);
    expect(result.recovered).toBe(true);
    expect(result.reason).toBe('Task recovered by parsing partial JSON');
  });

  it('自动恢复回退到备份恢复', () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'devteam-os-'));
    tempDirs.push(rootDir);
    const store = new FileTaskStore(rootDir);
    const task = createTestTask({ id: 'task_auto_backup', state: 'testing' });

    // First save to create initial version
    store.save(task);

    // Create a backup manually by saving a different state first, then corrupting
    const taskBackup = createTestTask({ id: 'task_auto_backup', state: 'testing' });
    store.save(taskBackup);

    // Overwrite with corrupted content
    writeFileSync(
      resolve(rootDir, '.devteam-os/tasks/task_auto_backup.json'),
      '{corrupted json',
      'utf8'
    );

    // Auto-recover should find valid JSON in file doesn't work, then fall back to backup
    const result = store.autoRecover('task_auto_backup');
    expect(result.success).toBe(true);
    expect(result.recovered).toBe(true);
    expect(result.task?.state).toBe('testing');
  });
});

describe('atomic writes', () => {
  it('原子写入使用临时文件', () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'devteam-os-'));
    tempDirs.push(rootDir);
    const store = new FileTaskStore(rootDir);
    const task = createTestTask({ id: 'task_atomic' });

    store.save(task);

    const tempPath = resolve(rootDir, '.devteam-os/tasks/.task_atomic.tmp');
    expect(existsSync(tempPath)).toBe(false);
  });
});

describe('list and delete', () => {
  it('列出所有任务 ID', () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'devteam-os-'));
    tempDirs.push(rootDir);
    const store = new FileTaskStore(rootDir);

    store.save(createTestTask({ id: 'task_list_1' }));
    store.save(createTestTask({ id: 'task_list_2' }));
    store.save(createTestTask({ id: 'task_list_3' }));

    const ids = store.listTaskIds();
    expect(ids).toContain('task_list_1');
    expect(ids).toContain('task_list_2');
    expect(ids).toContain('task_list_3');
    expect(ids.length).toBe(3);
  });

  it('删除任务同时删除备份', () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'devteam-os-'));
    tempDirs.push(rootDir);
    const store = new FileTaskStore(rootDir);
    const task = createTestTask({ id: 'task_delete' });

    store.save(task);
    store.save(createTestTask({ id: 'task_delete', state: 'testing' })); // Create backup

    expect(existsSync(resolve(rootDir, '.devteam-os/tasks/task_delete.json'))).toBe(true);
    expect(existsSync(resolve(rootDir, '.devteam-os/backups/task_delete.backup.json'))).toBe(true);

    store.delete('task_delete');

    expect(existsSync(resolve(rootDir, '.devteam-os/tasks/task_delete.json'))).toBe(false);
    expect(existsSync(resolve(rootDir, '.devteam-os/backups/task_delete.backup.json'))).toBe(false);
  });

  it('获取备份信息', () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'devteam-os-'));
    tempDirs.push(rootDir);
    const store = new FileTaskStore(rootDir);
    const task = createTestTask({ id: 'task_backup_info' });

    store.save(task);
    store.save(createTestTask({ id: 'task_backup_info', state: 'testing' }));

    const info = store.getBackupInfo('task_backup_info');
    expect(info).toBeDefined();
    expect(info?.taskId).toBe('task_backup_info');
    expect(info?.backupPath).toContain('task_backup_info.backup.json');
  });

  it('不存在任务的备份信息返回 undefined', () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'devteam-os-'));
    tempDirs.push(rootDir);
    const store = new FileTaskStore(rootDir);

    expect(store.getBackupInfo('nonexistent')).toBeUndefined();
  });
});

describe('health check', () => {
  it('健康检查通过', () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'devteam-os-'));
    tempDirs.push(rootDir);
    const store = new FileTaskStore(rootDir);

    const result = store.healthCheck();
    expect(result.healthy).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('空目录结构时健康检查通过（自动创建）', () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'devteam-os-'));
    tempDirs.push(rootDir);
    const store = new FileTaskStore(rootDir);

    const result = store.healthCheck();
    expect(result.healthy).toBe(true);

    expect(existsSync(resolve(rootDir, '.devteam-os/tasks'))).toBe(true);
    expect(existsSync(resolve(rootDir, '.devteam-os/backups'))).toBe(true);
  });
});
