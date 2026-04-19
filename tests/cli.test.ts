import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { runCli } from '../src/cli.js';
import { InMemoryTaskStore } from '../src/storage.js';

const ENV_KEYS = ['DEVTEAM_LLM_PROVIDER', 'DEVTEAM_LLM_MODEL', 'OPENAI_API_KEY'] as const;
const tempDirs: string[] = [];

afterEach(() => {
  vi.unstubAllGlobals();

  for (const key of ENV_KEYS) {
    delete process.env[key];
  }

  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('cli', () => {
  it('interactive 命令可启动并输出首轮结果', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'devteam-os-cli-interactive-'));
    tempDirs.push(cwd);
    const store = new InMemoryTaskStore();
    const writes: string[] = [];
    const prompt = vi.fn<() => Promise<string | undefined>>();

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

    expect(prompt).toHaveBeenCalledOnce();
    expect(prompt).toHaveBeenCalledWith('老板确认范围、优先级或方向：');
    expect(writes).toHaveLength(3);
    expect(writes[0]).toMatch(/^taskId=\S+ state=awaiting_owner_decision paused=yes summary=.+$/u);
    expect(writes[1]).toContain('state=awaiting_owner_decision');
    expect(writes[1]).toContain('reason=');
    expect(writes[1]).toContain('requestedInput=');
    expect(writes[2]).toContain('退出当前交互会话');
    expect(output).toBe(writes.join('\n'));
  });

  it('interactive 无初始需求时会通过注入 prompt 读取用户输入', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'devteam-os-cli-interactive-prompt-'));
    tempDirs.push(cwd);
    const store = new InMemoryTaskStore();
    const writes: string[] = [];
    const prompt = vi
      .fn<() => Promise<string | undefined>>()
      .mockResolvedValueOnce('请设计一个需要老板拍板范围的本地原型增强')
      .mockResolvedValueOnce('exit');

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
    expect(prompt).toHaveBeenNthCalledWith(1, '请输入需求：');
    expect(prompt).toHaveBeenNthCalledWith(2, '老板确认范围、优先级或方向：');
    expect(writes).toHaveLength(3);
    expect(writes[0]).toContain('state=awaiting_owner_decision');
    expect(writes[1]).toContain('requestedInput=');
    expect(writes[2]).toContain('退出当前交互会话');
    expect(output).toBe(writes.join('\n'));
  });

  it('interactive 在 clarifying 场景下会在同一会话内补充说明并推进到 done', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'devteam-os-cli-clarifying-'));
    tempDirs.push(cwd);
    const store = new InMemoryTaskStore();
    const writes: string[] = [];
    const prompt = vi.fn<() => Promise<string | undefined>>().mockResolvedValue('请实现一个本地 CLI 原型并输出测试结果');

    const output = await runCli(['interactive', '太短了'], {
      store,
      cwd,
      io: {
        prompt,
        write(message) {
          writes.push(message);
        }
      }
    });

    expect(prompt).toHaveBeenCalledOnce();
    expect(prompt).toHaveBeenCalledWith('请补充更清晰的目标、范围或约束：');
    expect(writes).toHaveLength(3);
    expect(writes[0]).toContain('state=clarifying');
    expect(writes[0]).toContain('paused=yes');
    expect(writes[1]).toContain('requestedInput=');
    expect(writes[2]).toContain('state=done');
    expect(writes[2]).toContain('paused=no');
    expect(output).toBe(writes.join('\n'));
  }, 15000);

  it('interactive 在 clarifying 场景下遇到空输入时会提示重试，补充说明后继续', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'devteam-os-cli-clarifying-retry-'));
    tempDirs.push(cwd);
    const store = new InMemoryTaskStore();
    const writes: string[] = [];
    const prompt = vi
      .fn<() => Promise<string | undefined>>()
      .mockResolvedValueOnce('   ')
      .mockResolvedValueOnce('请实现一个本地 CLI 原型并输出测试结果');

    const output = await runCli(['interactive', '太短了'], {
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
    expect(prompt).toHaveBeenNthCalledWith(1, '请补充更清晰的目标、范围或约束：');
    expect(prompt).toHaveBeenNthCalledWith(2, '请补充更清晰的目标、范围或约束：');
    expect(writes.some((message) => message.includes('无效输入：请输入补充说明'))).toBe(true);
    expect(writes.at(-1)).toContain('state=done');
    expect(output).toBe(writes.join('\n'));
  });

  it('interactive 在 awaiting_owner_decision 场景下会提示批准并在同一会话内推进到 done', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'devteam-os-cli-awaiting-owner-'));
    tempDirs.push(cwd);
    const store = new InMemoryTaskStore();
    const writes: string[] = [];
    const prompt = vi.fn<() => Promise<string | undefined>>().mockResolvedValue('approve');

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

    expect(prompt).toHaveBeenCalledOnce();
    expect(prompt).toHaveBeenCalledWith('老板确认范围、优先级或方向：');
    expect(writes).toHaveLength(3);
    expect(writes[0]).toContain('state=awaiting_owner_decision');
    expect(writes[0]).toContain('paused=yes');
    expect(writes[1]).toContain('requestedInput=');
    expect(writes[2]).toContain('state=done');
    expect(writes[2]).toContain('paused=no');
    expect(output).toBe(writes.join('\n'));
  }, 15000);

  it('interactive 在 awaiting_owner_decision 场景下输入 reject 会进入 blocked 等待新方向', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'devteam-os-cli-awaiting-owner-reject-'));
    tempDirs.push(cwd);
    const store = new InMemoryTaskStore();
    const writes: string[] = [];
    const prompt = vi
      .fn<() => Promise<string | undefined>>()
      .mockResolvedValueOnce('reject 请缩小范围后再继续')
      .mockResolvedValueOnce('exit');

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
    expect(writes.some((message) => message.includes('state=blocked'))).toBe(true);
    expect(writes.some((message) => message.includes('requestedInput=请补充新的方向、范围或约束后再恢复推进'))).toBe(true);
    expect(output).toBe(writes.join('\n'));
  });

  it('interactive 在 awaiting_owner_decision 场景下输入 revise 会回到 planning 后继续完成', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'devteam-os-cli-awaiting-owner-revise-'));
    tempDirs.push(cwd);
    const store = new InMemoryTaskStore();
    const writes: string[] = [];
    const prompt = vi.fn<() => Promise<string | undefined>>().mockResolvedValue('revise 请缩小范围并补充新的验收标准');

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

    expect(prompt).toHaveBeenCalledOnce();
    expect(writes.at(-1)).toContain('state=done');
    expect(output).toBe(writes.join('\n'));
  }, 15000);

  it('interactive 在 blocked 场景下会提示解除说明并在同一会话内推进到 done', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'devteam-os-cli-blocked-'));
    tempDirs.push(cwd);
    const store = new InMemoryTaskStore();
    const writes: string[] = [];
    const prompt = vi.fn<() => Promise<string | undefined>>().mockResolvedValue('依赖与信息已补齐，请继续推进本地 CLI 原型实现');

    const output = await runCli(['interactive', '请实现一个本地 CLI 原型，但当前有阻塞需要先等待'], {
      store,
      cwd,
      io: {
        prompt,
        write(message) {
          writes.push(message);
        }
      }
    });

    expect(prompt).toHaveBeenCalledOnce();
    expect(prompt).toHaveBeenCalledWith('补充缺失依赖、信息或资源后再恢复：');
    expect(writes).toHaveLength(3);
    expect(writes[0]).toContain('state=blocked');
    expect(writes[0]).toContain('paused=yes');
    expect(writes[1]).toContain('requestedInput=');
    expect(writes[2]).toContain('state=done');
    expect(writes[2]).toContain('paused=no');
    expect(output).toBe(writes.join('\n'));
  });

  it('interactive 在 blocked 场景下遇到空输入时会提示重试，补充说明后继续', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'devteam-os-cli-blocked-retry-'));
    tempDirs.push(cwd);
    const store = new InMemoryTaskStore();
    const writes: string[] = [];
    const prompt = vi
      .fn<() => Promise<string | undefined>>()
      .mockResolvedValueOnce('   ')
      .mockResolvedValueOnce('依赖与信息已补齐，请继续推进本地 CLI 原型实现');

    const output = await runCli(['interactive', '请实现一个本地 CLI 原型，但当前有阻塞需要先等待'], {
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
    expect(prompt).toHaveBeenNthCalledWith(1, '补充缺失依赖、信息或资源后再恢复：');
    expect(prompt).toHaveBeenNthCalledWith(2, '补充缺失依赖、信息或资源后再恢复：');
    expect(writes.some((message) => message.includes('无效输入：请输入解除阻塞说明'))).toBe(true);
    expect(writes.at(-1)).toContain('state=done');
    expect(output).toBe(writes.join('\n'));
  });

  it('interactive 在 awaiting_owner_decision 下输入无效值时会提示重试，approve 后继续', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'devteam-os-cli-awaiting-owner-retry-'));
    tempDirs.push(cwd);
    const store = new InMemoryTaskStore();
    const writes: string[] = [];
    const prompt = vi
      .fn<() => Promise<string | undefined>>()
      .mockResolvedValueOnce('maybe')
      .mockResolvedValueOnce('approve');

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
    expect(prompt).toHaveBeenNthCalledWith(1, '老板确认范围、优先级或方向：');
    expect(prompt).toHaveBeenNthCalledWith(2, '老板确认范围、优先级或方向：');
    expect(writes.some((message) => message.includes('无效输入'))).toBe(true);
    expect(writes.at(-1)).toContain('state=done');
    expect(output).toBe(writes.join('\n'));
  }, 15000);

  it('interactive 输入 exit 或 quit 时会正常结束会话且不崩溃', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'devteam-os-cli-exit-'));
    tempDirs.push(cwd);
    const store = new InMemoryTaskStore();
    const writes: string[] = [];
    const prompt = vi.fn<() => Promise<string | undefined>>().mockResolvedValue('exit');

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

    expect(prompt).toHaveBeenCalledOnce();
    expect(writes[0]).toContain('state=awaiting_owner_decision');
    expect(writes.some((message) => message.includes('退出当前交互会话'))).toBe(true);
    expect(output).toBe(writes.join('\n'));
  });

  it('在 deps.cwd 下自动加载 .env 并让 provider 配置生效', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'devteam-os-cli-env-'));
    tempDirs.push(cwd);
    writeFileSync(
      join(cwd, '.env'),
      ['DEVTEAM_LLM_PROVIDER=openai', 'DEVTEAM_LLM_MODEL=gpt-4o-mini', 'OPENAI_API_KEY=test-key'].join('\n'),
      'utf8'
    );

    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(createOpenAiResponse('PM env summary', 'PM env artifact'))
      .mockResolvedValueOnce(createOpenAiResponse('Architect env summary', 'Architect env artifact'));

    vi.stubGlobal('fetch', fetchImpl);

    const store = new InMemoryTaskStore();
    const output = await runCli(['start', '请设计一个需要老板拍板范围的本地原型增强'], {
      store,
      cwd
    });

    const taskId = output.match(/taskId=([^\s]+)/)?.[1];
    expect(taskId).toBeTruthy();
    expect(fetchImpl).toHaveBeenCalled();
    expect(store.get(taskId!)?.agentRuns.map((run) => run.summary)).toContain('PM env summary');
  });

  it('支持 start 后 approve 且输出格式兼容', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'devteam-os-cli-approve-'));
    tempDirs.push(cwd);
    const store = new InMemoryTaskStore();
    const startOutput = await runCli(['start', '请设计一个需要老板拍板范围的本地原型增强', '--verify=typecheck'], {
      store,
      cwd
    });

    expect(startOutput).toContain('state=awaiting_owner_decision');
    expect(startOutput).toMatch(/^taskId=\S+ state=awaiting_owner_decision paused=yes summary=.+$/u);

    const taskId = startOutput.match(/taskId=([^\s]+)/)?.[1];
    expect(taskId).toBeTruthy();

    const approveOutput = await runCli(['approve', taskId!], { store, cwd });
    expect(approveOutput).toContain('state=done');
    expect(approveOutput).toContain('paused=no');
    expect(approveOutput).toMatch(/^taskId=\S+ state=done paused=no summary=.+$/u);
  }, 15000);

  it('支持 start 后 reject 且输出格式兼容', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'devteam-os-cli-reject-'));
    tempDirs.push(cwd);
    const store = new InMemoryTaskStore();
    const startOutput = await runCli(['start', '请设计一个需要老板拍板范围的本地原型增强'], {
      store,
      cwd
    });

    const taskId = startOutput.match(/taskId=([^\s]+)/)?.[1];
    expect(taskId).toBeTruthy();

    const rejectOutput = await runCli(['reject', taskId!, '--note', '请缩小范围，重新规划'], { store, cwd });
    expect(rejectOutput).toContain('state=blocked');
    expect(rejectOutput).toContain('paused=yes');
    expect(rejectOutput).toMatch(/^taskId=\S+ state=blocked paused=yes summary=.+$/u);
  });

  it('支持 start 后 revise 且输出格式兼容', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'devteam-os-cli-revise-'));
    tempDirs.push(cwd);
    const store = new InMemoryTaskStore();
    const startOutput = await runCli(['start', '请设计一个需要老板拍板范围的本地原型增强'], {
      store,
      cwd
    });

    const taskId = startOutput.match(/taskId=([^\s]+)/)?.[1];
    expect(taskId).toBeTruthy();

    const reviseOutput = await runCli(['revise', taskId!, '--note', '请缩小范围，并补充新的验收标准'], { store, cwd });
    expect(reviseOutput).toContain('state=done');
    expect(reviseOutput).toContain('paused=no');
    expect(reviseOutput).toMatch(/^taskId=\S+ state=done paused=no summary=.+$/u);
  });

  it('支持离散 resume 命令恢复 clarifying 任务并输出兼容格式', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'devteam-os-cli-resume-'));
    tempDirs.push(cwd);
    const store = new InMemoryTaskStore();

    const startOutput = await runCli(['start', '太短了'], {
      store,
      cwd
    });

    expect(startOutput).toContain('state=clarifying');
    const taskId = startOutput.match(/taskId=([^\s]+)/)?.[1];
    expect(taskId).toBeTruthy();

    const resumeOutput = await runCli(['resume', taskId!, '--note', '请实现一个本地 CLI 原型并输出测试结果'], {
      store,
      cwd
    });

    expect(resumeOutput).toContain('state=done');
    expect(resumeOutput).toContain('paused=no');
    expect(resumeOutput).toMatch(/^taskId=\S+ state=done paused=no summary=.+$/u);
  });

  it('支持离散 resolve-block 命令恢复 blocked 任务并输出兼容格式', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'devteam-os-cli-resolve-block-'));
    tempDirs.push(cwd);
    const store = new InMemoryTaskStore();

    const startOutput = await runCli(['start', '请实现一个本地 CLI 原型，但当前有阻塞需要先等待'], {
      store,
      cwd
    });

    expect(startOutput).toContain('state=blocked');
    const taskId = startOutput.match(/taskId=([^\s]+)/)?.[1];
    expect(taskId).toBeTruthy();

    const resolveOutput = await runCli(['resolve-block', taskId!, '--note', '依赖与信息已补齐，请继续推进本地 CLI 原型实现'], {
      store,
      cwd
    });

    expect(resolveOutput).toContain('state=done');
    expect(resolveOutput).toContain('paused=no');
    expect(resolveOutput).toMatch(/^taskId=\S+ state=done paused=no summary=.+$/u);
  });

  it('deps.cwd 下无 .env 时保持当前默认行为', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'devteam-os-cli-no-env-'));
    tempDirs.push(cwd);
    const fetchImpl = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchImpl);

    const store = new InMemoryTaskStore();
    const output = await runCli(['start', '请设计一个需要老板拍板范围的本地原型增强'], {
      store,
      cwd
    });

    expect(output).toContain('state=awaiting_owner_decision');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

function createOpenAiResponse(summary: string, artifactContent: string): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        summary,
        confidence: 0.9,
        riskLevel: 'low',
        risks: [],
        needsOwnerDecision: false,
        nextAction: 'continue',
        artifactContent
      }) } }]
    }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  );
}
