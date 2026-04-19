import { existsSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

import { resolveWorkspacePath } from './repo.js';

export const PATCH_PROPOSAL_FORMAT = 'devteam.patch-proposal.v1';

export type PatchProposalOperation = 'add' | 'update';

export interface PatchProposalChange {
  path: string;
  operation: PatchProposalOperation;
  purpose: string;
  content: string;
}

export interface PatchProposal {
  format: typeof PATCH_PROPOSAL_FORMAT;
  summary: string;
  rationale: string;
  verificationPlan: string[];
  changes: PatchProposalChange[];
}

export class PatchProposalValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PatchProposalValidationError';
  }
}

export function parsePatchProposal(text: string, workspaceRoot: string): PatchProposal {
  let payload: unknown;

  try {
    payload = JSON.parse(text);
  } catch {
    throw new PatchProposalValidationError('Patch proposal is not valid JSON');
  }

  return validatePatchProposal(payload, workspaceRoot);
}

export function validatePatchProposal(proposal: unknown, workspaceRoot: string): PatchProposal {
  if (!isRecord(proposal)) {
    throw new PatchProposalValidationError('Patch proposal must be a JSON object');
  }

  const { format, summary, rationale, verificationPlan, changes } = proposal;

  if (format !== PATCH_PROPOSAL_FORMAT) {
    throw new PatchProposalValidationError(`Patch proposal format must be ${PATCH_PROPOSAL_FORMAT}`);
  }
  if (typeof summary !== 'string' || summary.trim().length === 0) {
    throw new PatchProposalValidationError('Patch proposal missing valid summary');
  }
  if (typeof rationale !== 'string' || rationale.trim().length === 0) {
    throw new PatchProposalValidationError('Patch proposal missing valid rationale');
  }
  if (!Array.isArray(verificationPlan) || verificationPlan.length === 0 || verificationPlan.some((item) => typeof item !== 'string' || item.trim().length === 0)) {
    throw new PatchProposalValidationError('Patch proposal missing valid verificationPlan');
  }
  if (!Array.isArray(changes)) {
    throw new PatchProposalValidationError('Patch proposal missing valid changes');
  }

  const realWorkspaceRoot = realpathSync(workspaceRoot);
  const seenPaths = new Set<string>();
  const validatedChanges = changes.map((change, index) => validateChange(change, index, realWorkspaceRoot, seenPaths));

  return {
    format: PATCH_PROPOSAL_FORMAT,
    summary: summary.trim(),
    rationale: rationale.trim(),
    verificationPlan: verificationPlan.map((item) => item.trim()),
    changes: validatedChanges
  };
}

function validateChange(
  change: unknown,
  index: number,
  workspaceRoot: string,
  seenPaths: Set<string>
): PatchProposalChange {
  if (!isRecord(change)) {
    throw new PatchProposalValidationError(`Patch proposal change #${index + 1} must be an object`);
  }

  const { path, operation, purpose, content } = change;

  if (typeof path !== 'string' || path.trim().length === 0) {
    throw new PatchProposalValidationError(`Patch proposal change #${index + 1} missing valid path`);
  }

  const normalizedPath = normalizeRelativeWorkspacePath(path, workspaceRoot);
  if (seenPaths.has(normalizedPath)) {
    throw new PatchProposalValidationError(`Patch proposal contains duplicate path operation: ${normalizedPath}`);
  }
  seenPaths.add(normalizedPath);

  if (operation !== 'add' && operation !== 'update') {
    throw new PatchProposalValidationError(`Patch proposal change #${index + 1} has invalid operation: ${String(operation)}`);
  }
  if (typeof purpose !== 'string' || purpose.trim().length === 0) {
    throw new PatchProposalValidationError(`Patch proposal change #${index + 1} missing valid purpose`);
  }
  if (typeof content !== 'string') {
    throw new PatchProposalValidationError(`Patch proposal change #${index + 1} missing valid content`);
  }

  const absolutePath = resolveWorkspacePath(workspaceRoot, normalizedPath);
  const fileExists = existsSync(absolutePath);

  if (operation === 'add' && fileExists) {
    throw new PatchProposalValidationError(`Patch proposal add target already exists: ${normalizedPath}`);
  }
  if (operation === 'update' && !fileExists) {
    throw new PatchProposalValidationError(`Patch proposal update target does not exist: ${normalizedPath}`);
  }

  return {
    path: normalizedPath,
    operation,
    purpose: purpose.trim(),
    content
  };
}

function normalizeRelativeWorkspacePath(requestedPath: string, workspaceRoot: string): string {
  const trimmedPath = requestedPath.trim();

  if (trimmedPath.length === 0) {
    throw new PatchProposalValidationError('Patch proposal path must not be empty');
  }
  if (isAbsolute(trimmedPath)) {
    throw new PatchProposalValidationError(`Patch proposal path must be workspace-relative: ${trimmedPath}`);
  }

  const absolutePath = resolve(workspaceRoot, trimmedPath);
  const relativePath = relative(workspaceRoot, absolutePath);

  if (relativePath === '' || relativePath.startsWith('..') || isAbsolute(relativePath)) {
    throw new PatchProposalValidationError(`Patch proposal path must stay inside workspace: ${trimmedPath}`);
  }

  const parentPath = resolve(workspaceRoot, dirname(trimmedPath));
  const parentRelativePath = relative(workspaceRoot, parentPath);
  if (parentRelativePath.startsWith('..') || isAbsolute(parentRelativePath)) {
    throw new PatchProposalValidationError(`Patch proposal path must stay inside workspace: ${trimmedPath}`);
  }

  return relativePath.split(sep).join('/');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
