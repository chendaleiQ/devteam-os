import { describe, expect, it } from 'vitest';

import { runCli } from '../src/cli.js';
import { InMemoryTaskStore } from '../src/storage.js';

describe('cli', () => {
  it('支持 start 后 approve 且输出格式兼容', async () => {
    const store = new InMemoryTaskStore();
    const startOutput = await runCli(['start', '请设计一个需要老板拍板范围的本地原型增强', '--verify=typecheck'], {
      store
    });

    expect(startOutput).toContain('state=awaiting_owner_decision');
    expect(startOutput).toMatch(/^taskId=\S+ state=awaiting_owner_decision paused=yes summary=.+$/u);

    const taskId = startOutput.match(/taskId=([^\s]+)/)?.[1];
    expect(taskId).toBeTruthy();

    const approveOutput = await runCli(['approve', taskId!], { store });
    expect(approveOutput).toContain('state=done');
    expect(approveOutput).toContain('paused=no');
    expect(approveOutput).toMatch(/^taskId=\S+ state=done paused=no summary=.+$/u);
  });
});
