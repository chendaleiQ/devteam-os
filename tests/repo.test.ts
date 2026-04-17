import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { readWorkspaceFile, searchWorkspaceFiles, summarizeWorkspaceChanges } from '../src/repo.js';

describe('repo workspace utilities', () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { force: true, recursive: true });
    }
  });

  function createWorkspace(): string {
    const root = mkdtempSync(join(tmpdir(), 'devteam-os-repo-'));
    roots.push(root);
    return root;
  }

  it('安全读取工作区内文件', () => {
    const workspaceRoot = createWorkspace();
    mkdirSync(join(workspaceRoot, 'docs'));
    writeFileSync(join(workspaceRoot, 'docs', 'note.md'), 'hello workspace', 'utf8');

    const result = readWorkspaceFile(workspaceRoot, 'docs/note.md');

    expect(result).toMatchObject({
      relativePath: 'docs/note.md',
      content: 'hello workspace'
    });
  });

  it('拒绝路径穿越或工作区外文件', () => {
    const workspaceRoot = createWorkspace();
    const outsideFile = join(tmpdir(), `devteam-os-outside-${Date.now()}.txt`);
    writeFileSync(outsideFile, 'secret', 'utf8');

    expect(() => readWorkspaceFile(workspaceRoot, '../outside.txt')).toThrow(/workspace/i);
    expect(() => readWorkspaceFile(workspaceRoot, outsideFile)).toThrow(/workspace/i);

    rmSync(outsideFile, { force: true });
  });

  it('可生成变更摘要或在 git diff 不可用时返回安全说明', () => {
    const workspaceRoot = createWorkspace();
    writeFileSync(join(workspaceRoot, 'file.txt'), 'content', 'utf8');

    const summary = summarizeWorkspaceChanges(workspaceRoot);

    expect(summary.blocked).toBe(false);
    expect(summary.summary.length).toBeGreaterThan(0);
    expect(summary.source).toMatch(/git_diff|unavailable/);
  });

  it('搜索工作区文件名与内容并忽略常见目录', () => {
    const workspaceRoot = createWorkspace();
    mkdirSync(join(workspaceRoot, 'src'));
    mkdirSync(join(workspaceRoot, 'node_modules'));
    mkdirSync(join(workspaceRoot, '.git'));
    mkdirSync(join(workspaceRoot, '.devteam-os'));
    writeFileSync(join(workspaceRoot, 'src', 'target-file.ts'), 'const keyword = "hello workspace";', 'utf8');
    writeFileSync(join(workspaceRoot, 'node_modules', 'ignored.txt'), 'target-file hello workspace', 'utf8');
    writeFileSync(join(workspaceRoot, '.git', 'ignored.txt'), 'target-file hello workspace', 'utf8');
    writeFileSync(join(workspaceRoot, '.devteam-os', 'ignored.txt'), 'target-file hello workspace', 'utf8');

    expect(searchWorkspaceFiles(workspaceRoot, 'target-file')).toEqual([
      {
        relativePath: 'src/target-file.ts',
        match: 'path',
        preview: 'src/target-file.ts'
      }
    ]);

    expect(searchWorkspaceFiles(workspaceRoot, 'hello workspace')).toEqual([
      {
        relativePath: 'src/target-file.ts',
        match: 'content',
        preview: 'const keyword = "hello workspace";'
      }
    ]);
  });
});
