#!/usr/bin/env node

import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

import { loadProjectEnv } from './env.js';
import { approveLeaderTask, rejectLeaderTask, requestChangesLeaderTask, resolveBlockedTask, resumeLeaderTask, runLeaderTask, type LeaderRunOptions } from './leader.js';
import type { LeaderRunResult } from './domain.js';
import type { ExecutorProgressEvent } from './executors/index.js';
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
      return formatResult(await runLeaderTask(input, { store, ...createCliLeaderOptions(args, io) }));
    }
    case 'resume': {
      const taskId = args[1];
      if (!taskId) {
        throw new Error('resume 需要 taskId');
      }
      const note = getOptionValue(args, '--note');
      return formatResult(await resumeLeaderTask(taskId, { store, ...createCliLeaderOptions(args, io), ...(note ? { note } : {}) }));
    }
    case 'approve': {
      const taskId = args[1];
      if (!taskId) {
        throw new Error('approve 需要 taskId');
      }
      return formatResult(await approveLeaderTask(taskId, { store, ...createCliLeaderOptions(args, io) }));
    }
    case 'reject': {
      const taskId = args[1];
      if (!taskId) {
        throw new Error('reject 需要 taskId');
      }
      const note = getOptionValue(args, '--note');
      return formatResult(await rejectLeaderTask(taskId, { store, ...createCliLeaderOptions(args, io), ...(note ? { note } : {}) }));
    }
    case 'revise': {
      const taskId = args[1];
      if (!taskId) {
        throw new Error('revise 需要 taskId');
      }
      const note = getOptionValue(args, '--note');
      return formatResult(await requestChangesLeaderTask(taskId, { store, ...createCliLeaderOptions(args, io), ...(note ? { note } : {}) }));
    }
    case 'resolve-block': {
      const taskId = args[1];
      if (!taskId) {
        throw new Error('resolve-block 需要 taskId');
      }
      const note = getOptionValue(args, '--note');
      return formatResult(await resolveBlockedTask(taskId, { store, ...createCliLeaderOptions(args, io), ...(note ? { note } : {}) }));
    }
    case 'interactive': {
      const transcript: string[] = [];
      const write = (message: string) => {
        transcript.push(message);
        io.write(message);
      };
      const options = { store, ...createCliLeaderOptions(args, { ...io, write }) };

      const input = await getInteractiveInput(args.slice(1), io, write);
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

async function getInteractiveInput(args: string[], io: CliIO, write: (message: string) => void): Promise<string | undefined> {
  const positionalInput = getPositionalText(args);
  if (positionalInput) {
    return positionalInput;
  }

  while (true) {
    const promptedInput = (await io.prompt('请输入需求（直接输入需求，exit/quit 退出）：'))?.trim();
    if (promptedInput === undefined || isExitInput(promptedInput)) {
      write('已退出当前交互会话。');
      return undefined;
    }
    if (!promptedInput) {
      write('无效输入：请输入需求，或输入 exit/quit 退出。');
      continue;
    }

    return promptedInput;
  }
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
  const promptText = getInteractivePausedPrompt(task.state, task.waitingSummary?.requestedInput);

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
  write(formatResult(result, { interactive: true }));
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

function getInteractivePausedPrompt(
  state: LeaderRunResult['task']['state'],
  requestedInput: string | undefined
): string {
  switch (state) {
    case 'clarifying':
      return `[clarifying] ${requestedInput ?? '请补充说明'}（直接输入内容，exit/quit 退出）：`;
    case 'awaiting_owner_decision':
      return '[awaiting_owner_decision] 请输入 approve / reject / revise（可直接输入，exit/quit 退出）：';
    case 'blocked':
      return `[blocked] ${requestedInput ?? '请提供解除阻塞说明'}（直接输入内容，exit/quit 退出）：`;
    default:
      return `${requestedInput ?? getDefaultPausedPrompt(state)}：`;
  }
}

function parseLeaderOptions(args: string[]): LeaderRunOptions {
  const executor = getOptionValue(args, '--executor');

  const options: LeaderRunOptions = {};

  if (executor) {
    options.executor = executor;
  }

  return options;
}

function createCliLeaderOptions(args: string[], io: Pick<CliIO, 'write'>): LeaderRunOptions {
  return {
    ...parseLeaderOptions(args),
    onProgress(event) {
      io.write(formatProgressEvent(event));
    }
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

function formatResult(result: LeaderRunResult, options: { interactive?: boolean } = {}): string {
  const { task } = result;
  const lines = [
    `=== Task ${task.id} ===`,
    `State: ${task.state}${result.paused ? ' (paused)' : ''}`,
    `Summary: ${task.deliveryReport?.summary ?? task.validation?.summary ?? '无'}`
  ];

  if (!result.paused) {
    return lines.join('\n');
  }

  lines.push('');
  lines.push(`Reason: ${task.waitingSummary?.reason ?? '无'}`);
  lines.push(`Need: ${task.waitingSummary?.requestedInput ?? getDefaultPausedPrompt(task.state)}`);
  lines.push(`Next: ${getNextStepHint(task.state)}`);

  if (options.interactive) {
    lines.push('Interactive: 可直接在当前会话输入，无需复制 Continue with 里的命令。');
  }

  const commands = getContinuationCommands(task.id, task.state);
  if (commands.length > 0) {
    lines.push('Continue with:');
    lines.push(...commands.map((command) => `  ${command}`));
  }

  return lines.join('\n');
}

function formatProgressEvent(event: ExecutorProgressEvent): string {
  return `[progress][${event.phase}][${event.executor}][${event.kind}] ${sanitizeProgressMessage(event.message)}`;
}

function sanitizeProgressMessage(message: string): string {
  return message.replace(/\s+/gu, ' ').trim();
}

function getContinuationCommands(taskId: string, state: LeaderRunResult['task']['state']): string[] {
  switch (state) {
    case 'clarifying':
      return [`npm run dev -- resume ${taskId} --note "补充说明"`];
    case 'awaiting_owner_decision':
      return [
        `npm run dev -- approve ${taskId}`,
        `npm run dev -- reject ${taskId} --note "驳回原因"`,
        `npm run dev -- revise ${taskId} --note "修改意见"`
      ];
    case 'blocked':
      return [`npm run dev -- resolve-block ${taskId} --note "解除阻塞说明"`];
    default:
      return [];
  }
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
