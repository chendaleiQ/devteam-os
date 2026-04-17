import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';

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

export class FileTaskStore implements TaskStore {
  private readonly rootDir: string;
  private readonly tasksDir: string;

  constructor(baseDir: string = process.cwd()) {
    this.rootDir = resolve(baseDir);
    this.tasksDir = resolve(this.rootDir, '.devteam-os/tasks');
  }

  save(task: Task): void {
    mkdirSync(this.tasksDir, { recursive: true });
    writeFileSync(this.getTaskFilePath(task.id), JSON.stringify(task, null, 2), 'utf8');
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

  private getTaskFilePath(id: string): string {
    const safeId = validateTaskId(id);
    const filePath = resolve(this.tasksDir, `${safeId}.json`);

    if (!filePath.startsWith(`${this.tasksDir}/`)) {
      throw new Error('任务文件路径超出允许范围');
    }

    return filePath;
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
