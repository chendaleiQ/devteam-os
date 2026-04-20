import { mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync, existsSync, cpSync, readdirSync } from 'node:fs';
import { basename, resolve, join } from 'node:path';

import type { Task } from './domain.js';

export interface TaskStore {
  save(task: Task): void;
  get(id: string): Task | undefined;
}

export class InMemoryTaskStore implements TaskStore {
  private readonly tasks = new Map<string, Task>();

  save(task: Task): void {
    this.tasks.set(task.id, cloneTask(task));
  }

  get(id: string): Task | undefined {
    const task = this.tasks.get(id);
    return task ? cloneTask(task) : undefined;
  }
}

export interface RecoveryResult {
  success: boolean;
  recovered: boolean;
  reason: string;
  task?: Task;
}

export interface BackupInfo {
  taskId: string;
  backupPath: string;
  backedUpAt: string;
}

export class FileTaskStore implements TaskStore {
  private readonly rootDir: string;
  private readonly tasksDir: string;
  private readonly backupDir: string;

  constructor(baseDir: string = process.cwd()) {
    this.rootDir = resolve(baseDir);
    this.tasksDir = resolve(this.rootDir, '.devteam-os/tasks');
    this.backupDir = resolve(this.rootDir, '.devteam-os/backups');
  }

  save(task: Task): void {
    mkdirSync(this.tasksDir, { recursive: true });
    mkdirSync(this.backupDir, { recursive: true });

    const targetPath = this.getTaskFilePath(task.id);
    const tempPath = this.getTempFilePath(task.id);

    // Create backup of existing file
    if (existsSync(targetPath)) {
      this.createBackup(task.id);
    }

    // Atomic write: write to temp file first, then rename
    writeFileSync(tempPath, JSON.stringify(task, null, 2), 'utf8');
    renameSync(tempPath, targetPath);
  }

  get(id: string): Task | undefined {
    const filePath = this.getTaskFilePath(id);

    try {
      const raw = readFileSync(filePath, 'utf8');
      return JSON.parse(raw) as Task;
    } catch {
      return undefined;
    }
  }

  /**
   * Attempt to recover a task from backup
   */
  recoverFromBackup(taskId: string): RecoveryResult {
    const backupPath = this.getBackupFilePath(taskId);

    if (!existsSync(backupPath)) {
      return {
        success: false,
        recovered: false,
        reason: 'No backup found for this task'
      };
    }

    try {
      const raw = readFileSync(backupPath, 'utf8');
      const task = JSON.parse(raw) as Task;

      // Validate recovered task has required fields
      if (!this.isValidTask(task)) {
        return {
          success: false,
          recovered: false,
          reason: 'Backup file contains invalid task data'
        };
      }

      // Save recovered task as new version
      this.save(task);

      return {
        success: true,
        recovered: true,
        reason: 'Task recovered from backup successfully',
        task
      };
    } catch {
      return {
        success: false,
        recovered: false,
        reason: 'Failed to parse backup file'
      };
    }
  }

  /**
   * Attempt recovery with multiple strategies
   */
  autoRecover(taskId: string): RecoveryResult {
    // Strategy 1: Try to recover from corrupted file (partial JSON)
    const filePath = this.getTaskFilePath(taskId);

    if (existsSync(filePath)) {
      try {
        const raw = readFileSync(filePath, 'utf8');
        const task = this.parsePartialJson(raw);
        if (task) {
          return {
            success: true,
            recovered: true,
            reason: 'Task recovered by parsing partial JSON',
            task
          };
        }
      } catch {
        // Continue to next strategy
      }
    }

    // Strategy 2: Try to recover from backup
    return this.recoverFromBackup(taskId);
  }

  /**
   * Get all task IDs stored
   */
  listTaskIds(): string[] {
    if (!existsSync(this.tasksDir)) {
      return [];
    }

    return readdirSync(this.tasksDir)
      .filter((file) => file.endsWith('.json'))
      .map((file) => file.replace('.json', ''));
  }

  /**
   * Get backup information for a task
   */
  getBackupInfo(taskId: string): BackupInfo | undefined {
    const backupPath = this.getBackupFilePath(taskId);

    if (!existsSync(backupPath)) {
      return undefined;
    }

    return {
      taskId,
      backupPath,
      backedUpAt: new Date().toISOString()
    };
  }

  /**
   * Delete a task and its backup
   */
  delete(taskId: string): boolean {
    const filePath = this.getTaskFilePath(taskId);
    const backupPath = this.getBackupFilePath(taskId);

    let deleted = false;

    if (existsSync(filePath)) {
      unlinkSync(filePath);
      deleted = true;
    }

    if (existsSync(backupPath)) {
      unlinkSync(backupPath);
    }

    return deleted;
  }

  /**
   * Health check for storage
   */
  healthCheck(): { healthy: boolean; issues: string[] } {
    const issues: string[] = [];

    try {
      mkdirSync(this.tasksDir, { recursive: true });
    } catch {
      issues.push('Cannot create tasks directory');
    }

    try {
      mkdirSync(this.backupDir, { recursive: true });
    } catch {
      issues.push('Cannot create backup directory');
    }

    return {
      healthy: issues.length === 0,
      issues
    };
  }

  private createBackup(taskId: string): void {
    const sourcePath = this.getTaskFilePath(taskId);
    const backupPath = this.getBackupFilePath(taskId);

    cpSync(sourcePath, backupPath, { force: true });
  }

  private getTaskFilePath(id: string): string {
    const safeId = validateTaskId(id);
    const filePath = resolve(this.tasksDir, `${safeId}.json`);

    if (!filePath.startsWith(`${this.tasksDir}/`)) {
      throw new Error('任务文件路径超出允许范围');
    }

    return filePath;
  }

  private getTempFilePath(id: string): string {
    const safeId = validateTaskId(id);
    return resolve(this.tasksDir, `.${safeId}.tmp`);
  }

  private getBackupFilePath(id: string): string {
    const safeId = validateTaskId(id);
    return resolve(this.backupDir, `${safeId}.backup.json`);
  }

  private isValidTask(task: unknown): task is Task {
    if (typeof task !== 'object' || task === null) {
      return false;
    }

    const t = task as Record<string, unknown>;
    return (
      typeof t.id === 'string' &&
      typeof t.input === 'string' &&
      typeof t.state === 'string'
    );
  }

  private parsePartialJson(raw: string): Task | undefined {
    // Try to extract valid JSON from potentially corrupted content
    const trimmed = raw.trim();

    // Strategy 1: Try direct parse
    try {
      return JSON.parse(trimmed) as Task;
    } catch {
      // Continue
    }

    // Strategy 2: Try to find complete JSON object
    const objectStart = trimmed.indexOf('{');
    const objectEnd = trimmed.lastIndexOf('}');

    if (objectStart !== -1 && objectEnd !== -1 && objectEnd > objectStart) {
      const jsonCandidate = trimmed.substring(objectStart, objectEnd + 1);
      try {
        return JSON.parse(jsonCandidate) as Task;
      } catch {
        // Continue
      }
    }

    return undefined;
  }
}

function validateTaskId(id: string): string {
  const safeId = id.trim();

  if (!safeId) {
    throw new Error('taskId 不能为空');
  }

  if (safeId !== basename(safeId) || safeId === '.' || safeId === '..' || safeId.includes('/') || safeId.includes('\\')) {
    throw new Error('taskId 必须是单文件 basename');
  }

  return safeId;
}

function cloneTask(task: Task): Task {
  return structuredClone(task);
}
