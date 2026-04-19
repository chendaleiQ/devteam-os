import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  PatchProposalValidationError,
  validatePatchProposal
} from '../src/patch-proposal.js';

describe('patch proposal validation', () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { force: true, recursive: true });
    }
  });

  function createWorkspace(): string {
    const root = mkdtempSync(join(tmpdir(), 'devteam-os-patch-proposal-'));
    roots.push(root);
    return root;
  }

  it('合法 proposal 可通过校验', () => {
    const workspaceRoot = createWorkspace();
    writeFileSync(join(workspaceRoot, 'existing.ts'), 'export const value = 1;\n', 'utf8');

    expect(() => validatePatchProposal({
      format: 'devteam.patch-proposal.v1',
      summary: '更新现有文件并新增说明文件',
      rationale: '保持行为变更可审阅且不直接写盘',
      verificationPlan: ['运行相关测试', '复核 proposal 结构'],
      changes: [
        {
          path: 'existing.ts',
          operation: 'update',
          purpose: '调整已有实现',
          content: 'export const value = 2;\n'
        },
        {
          path: 'docs/proposal.md',
          operation: 'add',
          purpose: '补充说明',
          content: '# proposal\n'
        }
      ]
    }, workspaceRoot)).not.toThrow();
  });

  it('缺字段失败', () => {
    const workspaceRoot = createWorkspace();

    expect(() => validatePatchProposal({
      format: 'devteam.patch-proposal.v1',
      rationale: 'missing summary',
      verificationPlan: ['run tests'],
      changes: []
    }, workspaceRoot)).toThrow(PatchProposalValidationError);
  });

  it('非法操作失败', () => {
    const workspaceRoot = createWorkspace();

    expect(() => validatePatchProposal({
      format: 'devteam.patch-proposal.v1',
      summary: 'bad op',
      rationale: 'bad op',
      verificationPlan: ['run tests'],
      changes: [
        {
          path: 'file.ts',
          operation: 'delete',
          purpose: 'bad',
          content: 'x'
        }
      ]
    }, workspaceRoot)).toThrow(/operation/u);
  });

  it('workspace 外路径失败', () => {
    const workspaceRoot = createWorkspace();

    expect(() => validatePatchProposal({
      format: 'devteam.patch-proposal.v1',
      summary: 'outside path',
      rationale: 'outside path',
      verificationPlan: ['run tests'],
      changes: [
        {
          path: '../outside.ts',
          operation: 'add',
          purpose: 'bad',
          content: 'x'
        }
      ]
    }, workspaceRoot)).toThrow(/workspace/u);
  });

  it('同路径冲突失败', () => {
    const workspaceRoot = createWorkspace();

    expect(() => validatePatchProposal({
      format: 'devteam.patch-proposal.v1',
      summary: 'duplicate path',
      rationale: 'duplicate path',
      verificationPlan: ['run tests'],
      changes: [
        {
          path: 'src/file.ts',
          operation: 'add',
          purpose: 'first',
          content: 'x'
        },
        {
          path: 'src/file.ts',
          operation: 'update',
          purpose: 'second',
          content: 'y'
        }
      ]
    }, workspaceRoot)).toThrow(/duplicate|冲突/u);
  });

  it('add 写已存在文件失败', () => {
    const workspaceRoot = createWorkspace();
    writeFileSync(join(workspaceRoot, 'existing.ts'), 'export const value = 1;\n', 'utf8');

    expect(() => validatePatchProposal({
      format: 'devteam.patch-proposal.v1',
      summary: 'bad add',
      rationale: 'bad add',
      verificationPlan: ['run tests'],
      changes: [
        {
          path: 'existing.ts',
          operation: 'add',
          purpose: 'bad',
          content: 'x'
        }
      ]
    }, workspaceRoot)).toThrow(/already exists|已存在/u);
  });

  it('update 写不存在文件失败', () => {
    const workspaceRoot = createWorkspace();

    expect(() => validatePatchProposal({
      format: 'devteam.patch-proposal.v1',
      summary: 'bad update',
      rationale: 'bad update',
      verificationPlan: ['run tests'],
      changes: [
        {
          path: 'missing.ts',
          operation: 'update',
          purpose: 'bad',
          content: 'x'
        }
      ]
    }, workspaceRoot)).toThrow(/does not exist|不存在/u);
  });
});
