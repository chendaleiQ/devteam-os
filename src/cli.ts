#!/usr/bin/env node

import { fileURLToPath } from 'node:url';

import { approveLeaderTask, resolveBlockedTask, resumeLeaderTask, runLeaderTask, type LeaderRunOptions } from './leader.js';
import type { LeaderRunResult } from './domain.js';
import { FileTaskStore, type TaskStore } from './storage.js';

export interface CliDependencies {
  store?: TaskStore;
  cwd?: string;
}

export function runCli(args: string[], deps: CliDependencies = {}): string {
  const command = args[0];
  const store = deps.store ?? new FileTaskStore(deps.cwd ?? process.cwd());

  if (!command) {
    throw new Error('用法: start "需求" | resume <taskId> --note "补充信息" | approve <taskId> | resolve-block <taskId> --note "说明"');
  }

  switch (command) {
    case 'start': {
      const input = getPositionalText(args.slice(1));
      if (!input) {
        throw new Error('start 需要需求文本');
      }
      return formatResult(runLeaderTask(input, { store, ...parseLeaderOptions(args) }));
    }
    case 'resume': {
      const taskId = args[1];
      if (!taskId) {
        throw new Error('resume 需要 taskId');
      }
      const note = getOptionValue(args, '--note');
      return formatResult(resumeLeaderTask(taskId, { store, ...parseLeaderOptions(args), ...(note ? { note } : {}) }));
    }
    case 'approve': {
      const taskId = args[1];
      if (!taskId) {
        throw new Error('approve 需要 taskId');
      }
      return formatResult(approveLeaderTask(taskId, { store, ...parseLeaderOptions(args) }));
    }
    case 'resolve-block': {
      const taskId = args[1];
      if (!taskId) {
        throw new Error('resolve-block 需要 taskId');
      }
      const note = getOptionValue(args, '--note');
      return formatResult(resolveBlockedTask(taskId, { store, ...parseLeaderOptions(args), ...(note ? { note } : {}) }));
    }
    default:
      throw new Error(`未知命令: ${command}`);
  }
}

function parseLeaderOptions(args: string[]): LeaderRunOptions {
  const verify = args.find((arg) => arg.startsWith('--verify='));

  if (!verify) {
    return {};
  }

  return {
    verificationScripts: verify
      .slice('--verify='.length)
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
  };
}

function getOptionValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);

  if (index >= 0) {
    return args[index + 1];
  }

  const inline = args.find((arg) => arg.startsWith(`${name}=`));
  return inline?.slice(name.length + 1);
}

function getPositionalText(args: string[]): string {
  return args.filter((arg) => !arg.startsWith('--')).join(' ').trim();
}

function formatResult(result: LeaderRunResult): string {
  const { task } = result;
  return [
    `taskId=${task.id}`,
    `state=${task.state}`,
    `paused=${result.paused ? 'yes' : 'no'}`,
    `summary=${task.deliveryReport?.summary ?? task.validation?.summary ?? '无'}`
  ].join(' ');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    console.log(runCli(process.argv.slice(2)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
