import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { runCli } from '../src/cli.js';
import { InMemoryTaskStore } from '../src/storage.js';

const tempDirs: string[] = [];

afterEach(() => {
  vi.unstubAllGlobals();

  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('cli interaction', () => {
  it('start 对需要澄清的任务会输出可继续操作的块状信息', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'devteam-os-cli-clarifying-'));
    tempDirs.push(cwd);
    const store = new InMemoryTaskStore();

    const output = await runCli(['start', '做一下'], { store, cwd });
    const taskId = output.match(/=== Task (task_[^\s]+) ===/)?.[1];

    expect(taskId).toBeTruthy();
    expect(output).toContain(`=== Task ${taskId} ===`);
    expect(output).toContain('State: clarifying (paused)');
    expect(output).toContain('Summary: 等待澄清，尚未进入交付阶段');
    expect(output).toContain('Need: 请补充更清晰的目标、范围或约束');
    expect(output).toContain(`npm run dev -- resume ${taskId} --note "补充说明"`);
  });

  it('interactive 无初始需求时会对空输入重试，并在 quit 时明确退出', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'devteam-os-cli-initial-prompt-'));
    tempDirs.push(cwd);
    const store = new InMemoryTaskStore();
    const writes: string[] = [];
    const prompts: string[] = [];
    const answers = ['   ', 'quit'];
    const prompt = vi.fn<(message: string) => Promise<string | undefined>>().mockImplementation(async (message) => {
      prompts.push(message);
      return answers.shift();
    });

    const output = await runCli(['interactive'], {
      store,
      cwd,
      io: {
        prompt,
        write(message) {
          writes.push(message);
        }
      }
    });

    expect(prompt).toHaveBeenCalledTimes(2);
    expect(prompts[0]).toBe('请输入需求（直接输入需求，exit/quit 退出）：');
    expect(prompts[1]).toBe('请输入需求（直接输入需求，exit/quit 退出）：');
    expect(writes).toEqual([
      '无效输入：请输入需求，或输入 exit/quit 退出。',
      '已退出当前交互会话。'
    ]);
    expect(output).toBe(writes.join('\n'));
  });

  it('interactive 在 clarifying 场景下会给出状态化提示，并对空输入重试', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'devteam-os-cli-interactive-exit-'));
    tempDirs.push(cwd);
    const store = new InMemoryTaskStore();
    const writes: string[] = [];
    const prompts: string[] = [];
    const answers = ['   ', 'exit'];
    const prompt = vi.fn<(message: string) => Promise<string | undefined>>().mockImplementation(async (message) => {
      prompts.push(message);
      return answers.shift();
    });

    const output = await runCli(['interactive', '做一下'], {
      store,
      cwd,
      io: {
        prompt,
        write(message) {
          writes.push(message);
        }
      }
    });

    expect(prompt).toHaveBeenCalledTimes(2);
    expect(prompts[0]).toBe('[clarifying] 请补充更清晰的目标、范围或约束（直接输入内容，exit/quit 退出）：');
    expect(prompts[1]).toBe('[clarifying] 请补充更清晰的目标、范围或约束（直接输入内容，exit/quit 退出）：');
    expect(writes[0]).toContain('State: clarifying (paused)');
    expect(writes[0]).toContain('Interactive: 可直接在当前会话输入，无需复制 Continue with 里的命令。');
    expect(writes).toContain('无效输入：请输入补充说明，或输入 exit/quit 退出。');
    expect(writes.at(-1)).toBe('已退出当前交互会话。');
    expect(output).toBe(writes.join('\n'));
  });

  it('interactive 在 awaiting_owner_decision 场景下会提示可用决策命令', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'devteam-os-cli-awaiting-owner-'));
    tempDirs.push(cwd);
    const store = new InMemoryTaskStore();
    const writes: string[] = [];
    const prompts: string[] = [];
    const answers = ['随便', 'quit'];
    const prompt = vi.fn<(message: string) => Promise<string | undefined>>().mockImplementation(async (message) => {
      prompts.push(message);
      return answers.shift();
    });

    const output = await runCli(['interactive', '请设计一个需要老板拍板范围的本地原型增强'], {
      store,
      cwd,
      io: {
        prompt,
        write(message) {
          writes.push(message);
        }
      }
    });

    expect(prompt).toHaveBeenCalledTimes(2);
    expect(prompts[0]).toBe('[awaiting_owner_decision] 请输入 approve / reject / revise（可直接输入，exit/quit 退出）：');
    expect(writes[0]).toContain('State: awaiting_owner_decision (paused)');
    expect(writes).toContain('无效输入：请输入 approve / reject / revise，或输入 exit/quit 退出。');
    expect(writes.at(-1)).toBe('已退出当前交互会话。');
    expect(output).toBe(writes.join('\n'));
  });
});
