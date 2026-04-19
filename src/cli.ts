#!/usr/bin/env node

import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

import { loadProjectEnv } from './env.js';
import { approveLeaderTask, rejectLeaderTask, requestChangesLeaderTask, resolveBlockedTask, resumeLeaderTask, runLeaderTask, type LeaderRunOptions } from './leader.js';
import type { LeaderRunResult } from './domain.js';
import { FileTaskStore, type TaskStore } from './storage.js';

export interface CliDependencies {
  store?: TaskStore;
  cwd?: string;
  io?: CliIO;
}

export interface CliIO {
  prompt(message: string): Promise<string | undefined>;
  write(message: string): void;
}

export async function runCli(args: string[], deps: CliDependencies = {}): Promise<string> {
  loadProjectEnv(deps.cwd ?? process.cwd());

  const command = args[0];
  const store = deps.store ?? new FileTaskStore(deps.cwd ?? process.cwd());
  const io = deps.io ?? createDefaultCliIo();

  if (!command) {
    throw new Error('用法: start "需求" | interactive [需求] | resume <taskId> --note "补充信息" | approve <taskId> | reject <taskId> [--note "说明"] | revise <taskId> --note "修改意见" | resolve-block <taskId> --note "说明"');
  }

  switch (command) {
    case 'start': {
      const input = getPositionalText(args.slice(1));
      if (!input) {
        throw new Error('start 需要需求文本');
      }
        return formatResult(await runLeaderTask(input, { store, ...parseLeaderOptions(args) }));
    }
    case 'resume': {
      const taskId = args[1];
      if (!taskId) {
        throw new Error('resume 需要 taskId');
      }
      const note = getOptionValue(args, '--note');
        return formatResult(await resumeLeaderTask(taskId, { store, ...parseLeaderOptions(args), ...(note ? { note } : {}) }));
    }
    case 'approve': {
      const taskId = args[1];
      if (!taskId) {
        throw new Error('approve 需要 taskId');
      }
        return formatResult(await approveLeaderTask(taskId, { store, ...parseLeaderOptions(args) }));
    }
    case 'reject': {
      const taskId = args[1];
      if (!taskId) {
        throw new Error('reject 需要 taskId');
      }
      const note = getOptionValue(args, '--note');
        return formatResult(await rejectLeaderTask(taskId, { store, ...parseLeaderOptions(args), ...(note ? { note } : {}) }));
    }
    case 'revise': {
      const taskId = args[1];
      if (!taskId) {
        throw new Error('revise 需要 taskId');
      }
      const note = getOptionValue(args, '--note');
      return formatResult(await requestChangesLeaderTask(taskId, { store, ...parseLeaderOptions(args), ...(note ? { note } : {}) }));
    }
    case 'resolve-block': {
      const taskId = args[1];
      if (!taskId) {
        throw new Error('resolve-block 需要 taskId');
      }
      const note = getOptionValue(args, '--note');
        return formatResult(await resolveBlockedTask(taskId, { store, ...parseLeaderOptions(args), ...(note ? { note } : {}) }));
    }
    case 'interactive': {
      const transcript: string[] = [];
      const write = (message: string) => {
        transcript.push(message);
        io.write(message);
      };
      const options = { store, ...parseLeaderOptions(args) };

      const input = await getInteractiveInput(args.slice(1), io);
      if (!input) {
        return transcript.join('\n');
      }

      let result = await runLeaderTask(input, options);
      writeInteractiveUpdate(result, write);

      while (result.paused) {
        const nextResult = await continueInteractiveSession(result, io, options, write);
        if (!nextResult) {
          break;
        }

        result = nextResult;
        writeInteractiveUpdate(result, write);
      }

      return transcript.join('\n');
    }
    default:
      throw new Error(`未知命令: ${command}`);
  }
}

async function getInteractiveInput(args: string[], io: CliIO): Promise<string | undefined> {
  const positionalInput = getPositionalText(args);
  if (positionalInput) {
    return positionalInput;
  }

  const promptedInput = (await io.prompt('请输入需求：'))?.trim();
  if (!promptedInput || isExitInput(promptedInput)) {
    return undefined;
  }

  return promptedInput;
}

function isExitInput(input: string): boolean {
  const normalized = input.trim().toLowerCase();
  return normalized === 'exit' || normalized === 'quit';
}

function createDefaultCliIo(): CliIO {
  return {
    async prompt(message: string) {
      const readline = createInterface({
        input: process.stdin,
        output: process.stdout
      });

      try {
        return await readline.question(message);
      } finally {
        readline.close();
      }
    },
    write(message: string) {
      process.stdout.write(`${message}\n`);
    }
  };
}

async function continueInteractiveSession(
  result: LeaderRunResult,
  io: CliIO,
  options: LeaderRunOptions,
  write: (message: string) => void
): Promise<LeaderRunResult | undefined> {
  const { task } = result;
  const promptText = `${task.waitingSummary?.requestedInput ?? getDefaultPausedPrompt(task.state)}：`;

  switch (task.state) {
    case 'clarifying': {
      while (true) {
        const rawNote = await io.prompt(promptText);
        if (rawNote === undefined) {
          write('已退出当前交互会话。');
          return undefined;
        }
        const note = rawNote.trim();
        if (isExitInput(note ?? '')) {
          write('已退出当前交互会话。');
          return undefined;
        }
        if (!note) {
          write('无效输入：请输入补充说明，或输入 exit/quit 退出。');
          continue;
        }

        return resumeLeaderTask(task.id, { ...options, note });
      }
    }
    case 'awaiting_owner_decision': {
      while (true) {
        const rawDecision = await io.prompt(promptText);
        if (rawDecision === undefined) {
          write('已退出当前交互会话。');
          return undefined;
        }
        const decision = rawDecision.trim().toLowerCase();
        if (isExitInput(decision ?? '')) {
          write('已退出当前交互会话。');
          return undefined;
        }
        if (decision === 'approve') {
          return approveLeaderTask(task.id, options);
        }
        if (decision === 'reject' || decision.startsWith('reject ')) {
          const note = rawDecision.trim().slice('reject'.length).trim();
          return rejectLeaderTask(task.id, { ...options, ...(note ? { note } : {}) });
        }
        if (decision === 'revise' || decision.startsWith('revise ')) {
          const note = rawDecision.trim().slice('revise'.length).trim();
          return requestChangesLeaderTask(task.id, { ...options, ...(note ? { note } : {}) });
        }
        if (decision !== 'approve') {
          write('无效输入：请输入 approve / reject / revise，或输入 exit/quit 退出。');
          continue;
        }
      }
    }
    case 'blocked': {
      while (true) {
        const rawNote = await io.prompt(promptText);
        if (rawNote === undefined) {
          write('已退出当前交互会话。');
          return undefined;
        }
        const note = rawNote.trim();
        if (isExitInput(note ?? '')) {
          write('已退出当前交互会话。');
          return undefined;
        }
        if (!note) {
          write('无效输入：请输入解除阻塞说明，或输入 exit/quit 退出。');
          continue;
        }

        return resolveBlockedTask(task.id, { ...options, note });
      }
    }
    default:
      return undefined;
  }
}

function writeInteractiveUpdate(result: LeaderRunResult, write: (message: string) => void): void {
  write(formatResult(result));

  if (result.paused) {
    write(formatPausedStatus(result));
  }
}

function getDefaultPausedPrompt(state: LeaderRunResult['task']['state']): string {
  switch (state) {
    case 'clarifying':
      return '请补充说明';
    case 'awaiting_owner_decision':
      return '请输入 approve / reject / revise';
    case 'blocked':
      return '请提供解除阻塞说明';
    default:
      return '请输入后续操作';
  }
}

function getNextStepHint(state: LeaderRunResult['task']['state']): string {
  switch (state) {
    case 'clarifying':
      return '输入补充说明，或输入 exit/quit 退出';
    case 'awaiting_owner_decision':
      return '输入 approve / reject / revise，或输入 exit/quit 退出';
    case 'blocked':
      return '输入解除阻塞说明，或输入 exit/quit 退出';
    default:
      return '输入后续操作，或输入 exit/quit 退出';
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

function formatPausedStatus(result: LeaderRunResult): string {
  const { task } = result;
  return [
    'status=paused',
    `state=${task.state}`,
    `reason=${task.waitingSummary?.reason ?? '无'}`,
    `requestedInput=${task.waitingSummary?.requestedInput ?? getDefaultPausedPrompt(task.state)}`,
    `next=${getNextStepHint(task.state)}`
  ].join(' ');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const output = await runCli(process.argv.slice(2));
    if (output && process.argv[2] !== 'interactive') {
      console.log(output);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
