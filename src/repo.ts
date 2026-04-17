import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

export interface WorkspaceFileReadResult {
  absolutePath: string;
  relativePath: string;
  content: string;
}

export interface WorkspaceSearchResult {
  relativePath: string;
  match: 'path' | 'content';
  preview: string;
}

export interface WorkspaceChangeSummary {
  blocked: boolean;
  source: 'git_diff' | 'unavailable';
  summary: string;
}

const ignoredDirectoryNames = new Set(['node_modules', '.git', '.devteam-os']);

export function resolveWorkspacePath(workspaceRoot: string, requestedPath: string): string {
  const realWorkspaceRoot = realpathSync(workspaceRoot);
  const targetPath = isAbsolute(requestedPath)
    ? resolve(requestedPath)
    : resolve(realWorkspaceRoot, requestedPath);

  assertInsideWorkspace(realWorkspaceRoot, targetPath);

  if (existsSync(targetPath)) {
    const realTargetPath = realpathSync(targetPath);
    assertInsideWorkspace(realWorkspaceRoot, realTargetPath);
    return realTargetPath;
  }

  assertInsideWorkspace(realWorkspaceRoot, dirname(targetPath));
  return targetPath;
}

export function readWorkspaceFile(workspaceRoot: string, requestedPath: string): WorkspaceFileReadResult {
  const absolutePath = resolveWorkspacePath(workspaceRoot, requestedPath);
  const realWorkspaceRoot = realpathSync(workspaceRoot);

  return {
    absolutePath,
    relativePath: toWorkspaceRelativePath(realWorkspaceRoot, absolutePath),
    content: readFileSync(absolutePath, 'utf8')
  };
}

export function searchWorkspaceFiles(workspaceRoot: string, query: string): WorkspaceSearchResult[] {
  const realWorkspaceRoot = realpathSync(workspaceRoot);
  const normalizedQuery = query.trim().toLowerCase();

  if (!normalizedQuery) {
    return [];
  }

  const results: WorkspaceSearchResult[] = [];
  walkWorkspace(realWorkspaceRoot, (absolutePath) => {
    const relativePath = toWorkspaceRelativePath(realWorkspaceRoot, absolutePath);

    if (relativePath.toLowerCase().includes(normalizedQuery)) {
      results.push({
        relativePath,
        match: 'path',
        preview: relativePath
      });
      return;
    }

    const content = safeReadTextFile(absolutePath);
    if (!content) {
      return;
    }

    const matchedLine = content.split(/\r?\n/u).find((line) => line.toLowerCase().includes(normalizedQuery));
    if (matchedLine) {
      results.push({
        relativePath,
        match: 'content',
        preview: matchedLine.trim().slice(0, 200)
      });
    }
  });

  return results;
}

export function summarizeWorkspaceChanges(workspaceRoot: string): WorkspaceChangeSummary {
  let realWorkspaceRoot: string;
  try {
    realWorkspaceRoot = realpathSync(workspaceRoot);
  } catch {
    return {
      blocked: false,
      source: 'unavailable',
      summary: '无法读取 workspace root，未生成 git diff 摘要'
    };
  }

  const result = spawnSync('git', ['diff', '--stat', '--no-ext-diff'], {
    cwd: realWorkspaceRoot,
    shell: false,
    encoding: 'utf8',
    timeout: 5000
  });

  if (result.error || result.status !== 0) {
    return {
      blocked: false,
      source: 'unavailable',
      summary: 'git diff 摘要不可用，已安全跳过变更摘要生成'
    };
  }

  const output = result.stdout.trim();
  return {
    blocked: false,
    source: 'git_diff',
    summary: output || '当前 workspace 没有 git diff 变更'
  };
}

function assertInsideWorkspace(workspaceRoot: string, targetPath: string): void {
  const relativePath = relative(workspaceRoot, targetPath);
  if (relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath))) {
    return;
  }

  throw new Error(`拒绝访问 workspace 外路径: ${targetPath}`);
}

function walkWorkspace(directoryPath: string, onFile: (absolutePath: string) => void): void {
  for (const entry of readdirSync(directoryPath, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectoryNames.has(entry.name)) {
      continue;
    }

    const absolutePath = resolve(directoryPath, entry.name);
    if (entry.isDirectory()) {
      walkWorkspace(absolutePath, onFile);
      continue;
    }

    if (entry.isFile()) {
      onFile(absolutePath);
    }
  }
}

function safeReadTextFile(absolutePath: string): string | undefined {
  try {
    if (statSync(absolutePath).size > 1024 * 1024) {
      return undefined;
    }

    return readFileSync(absolutePath, 'utf8');
  } catch {
    return undefined;
  }
}

function toWorkspaceRelativePath(workspaceRoot: string, absolutePath: string): string {
  return relative(workspaceRoot, absolutePath).split(sep).join('/');
}
