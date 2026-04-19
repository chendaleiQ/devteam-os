import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  LlmConfigurationError,
  LlmSchemaError,
  LlmTransientError,
  createLlmProvider
} from '../src/llm/index.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('llm provider configuration', () => {
  it('默认 provider = mock', async () => {
    const provider = createLlmProvider();

    expect(provider.name).toBe('mock');
    await expect(provider.generate({ prompt: 'hello' })).resolves.toMatchObject({
      provider: 'mock',
      model: 'mock-deterministic-v1',
      text: '[mock:mock-deterministic-v1] hello'
    });
  });

  it('mock provider 可返回受控角色协议 JSON', async () => {
    const provider = createLlmProvider({ provider: 'mock' });

    const response = await provider.generate({
      system: 'You are the pm role in a controlled delivery workflow. Return only a JSON object.',
      prompt: JSON.stringify({
        role: 'pm',
        taskId: 'task_test',
        taskSummary: '请评估预算冲突下的本地原型方案并给出执行路径',
        currentStatus: 'planning',
        contextSummary: '初始规划阶段',
        requestedOutcome: '给出下一步执行建议',
        riskSignals: [{ level: 'medium', description: '外部依赖尚未确认' }],
        artifacts: []
      })
    });

    expect(response).toMatchObject({
      provider: 'mock',
      model: 'mock-deterministic-v1'
    });
    expect(JSON.parse(response.text)).toMatchObject({
      summary: 'PM 识别到优先级冲突，建议先老板拍板',
      riskLevel: 'high',
      needsOwnerDecision: true,
      nextAction: 'request_owner_decision'
    });
  });

  it('未知 provider 报错', () => {
    expect(() => createLlmProvider({ provider: 'unknown' as never })).toThrow(LlmConfigurationError);
  });

  it('openai 缺 key/model 报错', () => {
    expect(() => createLlmProvider({ provider: 'openai', model: 'gpt-4o-mini' })).toThrow(LlmConfigurationError);
    expect(() => createLlmProvider({ provider: 'openai', apiKey: 'secret-key' })).toThrow(LlmConfigurationError);
  });

  it('provider=minimax 可创建 MiniMax provider', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>;
      const body = JSON.parse(String(init?.body)) as {
        model: string;
        max_tokens: number;
        system?: string;
        messages: Array<{ role: string; content: string }>;
      };

      expect(String(input)).toBe('https://api.minimaxi.com/anthropic/v1/messages');
      expect(headers['content-type']).toBe('application/json');
      expect(headers['x-api-key']).toBe('minimax-secret-key');
      expect(headers['anthropic-version']).toBe('2023-06-01');
      expect(body).toMatchObject({
        model: 'MiniMax-M2.7',
        max_tokens: 4096,
        messages: [{ role: 'user', content: 'hello' }]
      });

      return new Response(
        JSON.stringify({
          content: [
            { type: 'thinking', thinking: 'internal' },
            { type: 'text', text: 'from-' },
            { type: 'text', text: 'minimax' }
          ]
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    });

    const provider = createLlmProvider({
      provider: 'minimax',
      model: 'MiniMax-M2.7',
      apiKey: 'minimax-secret-key',
      fetch: fetchImpl,
      maxRetries: 0
    });

    expect(provider.name).toBe('minimax');
    await expect(provider.generate({ prompt: 'hello' })).resolves.toMatchObject({
      provider: 'minimax',
      model: 'MiniMax-M2.7',
      text: 'from-minimax'
    });
  });

  it('MiniMax 默认 max_tokens 提高到 4096，避免结构化输出被截断', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { max_tokens: number };

      expect(body.max_tokens).toBe(4096);

      return new Response(JSON.stringify({ content: [{ type: 'text', text: 'ok' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    });

    const provider = createLlmProvider({
      provider: 'minimax',
      model: 'MiniMax-M2.7',
      apiKey: 'minimax-secret-key',
      fetch: fetchImpl,
      maxRetries: 0
    });

    await expect(provider.generate({ prompt: 'hello' })).resolves.toMatchObject({
      provider: 'minimax',
      model: 'MiniMax-M2.7',
      text: 'ok'
    });
  });

  it('env-only provider=minimax + ANTHROPIC_* 可创建 MiniMax provider', async () => {
    vi.stubEnv('DEVTEAM_LLM_PROVIDER', 'minimax');
    vi.stubEnv('DEVTEAM_LLM_MODEL', 'MiniMax-M2.7');
    vi.stubEnv('ANTHROPIC_API_KEY', 'env-minimax-secret');
    vi.stubEnv('ANTHROPIC_BASE_URL', 'https://minimax.example.com/anthropic');

    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('https://minimax.example.com/anthropic/v1/messages');
      expect((init?.headers as Record<string, string>)['x-api-key']).toBe('env-minimax-secret');

      return new Response(JSON.stringify({ content: [{ type: 'text', text: 'from-env-minimax' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    });

    const provider = createLlmProvider({ fetch: fetchImpl, maxRetries: 0 });

    expect(provider.name).toBe('minimax');
    await expect(provider.generate({ prompt: 'hello' })).resolves.toMatchObject({
      provider: 'minimax',
      model: 'MiniMax-M2.7',
      text: 'from-env-minimax'
    });
  });

  it('runtime config 仍可覆盖 minimax env', async () => {
    vi.stubEnv('DEVTEAM_LLM_PROVIDER', 'minimax');
    vi.stubEnv('DEVTEAM_LLM_MODEL', 'env-minimax-model');
    vi.stubEnv('ANTHROPIC_API_KEY', 'env-minimax-secret');
    vi.stubEnv('ANTHROPIC_BASE_URL', 'https://env-minimax.example.com/anthropic');

    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { model: string };

      expect(String(input)).toBe('https://runtime-minimax.example.com/anthropic/v1/messages');
      expect(body.model).toBe('runtime-minimax-model');
      expect((init?.headers as Record<string, string>)['x-api-key']).toBe('runtime-minimax-secret');

      return new Response(JSON.stringify({ content: [{ type: 'text', text: 'runtime-minimax-win' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    });

    const provider = createLlmProvider({
      provider: 'minimax',
      model: 'runtime-minimax-model',
      apiKey: 'runtime-minimax-secret',
      baseUrl: 'https://runtime-minimax.example.com/anthropic',
      fetch: fetchImpl,
      maxRetries: 0
    });

    expect(provider.name).toBe('minimax');
    await expect(provider.generate({ prompt: 'hello' })).resolves.toMatchObject({
      provider: 'minimax',
      model: 'runtime-minimax-model',
      text: 'runtime-minimax-win'
    });
  });

  it('provider=minimax 缺 ANTHROPIC_API_KEY / model 报配置错误', () => {
    expect(() => createLlmProvider({ provider: 'minimax', model: 'MiniMax-M2.7' })).toThrow(LlmConfigurationError);
    expect(() => createLlmProvider({ provider: 'minimax', apiKey: 'minimax-secret-key' })).toThrow(LlmConfigurationError);
  });

  it('旧 MINIMAX_* 不再作为 env 主路径口径', () => {
    vi.stubEnv('DEVTEAM_LLM_PROVIDER', 'minimax');
    vi.stubEnv('DEVTEAM_LLM_MODEL', 'MiniMax-M2.7');
    vi.stubEnv('MINIMAX_API_KEY', 'legacy-minimax-secret');
    vi.stubEnv('MINIMAX_BASE_URL', 'https://legacy-minimax.example.com/v1');

    expect(() => createLlmProvider()).toThrowError(new LlmConfigurationError('MiniMax provider requires apiKey'));
  });

  it('env 可作为默认配置源生效', async () => {
    vi.stubEnv('DEVTEAM_LLM_PROVIDER', 'openai');
    vi.stubEnv('DEVTEAM_LLM_MODEL', 'gpt-4o-mini');
    vi.stubEnv('OPENAI_API_KEY', 'env-secret-key');

    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'resp_env',
          choices: [{ message: { content: 'from-env' } }]
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );

    const provider = createLlmProvider({ fetch: fetchImpl, maxRetries: 0 });

    expect(provider.name).toBe('openai');
    await expect(provider.generate({ prompt: 'hello' })).resolves.toMatchObject({
      provider: 'openai',
      model: 'gpt-4o-mini',
      text: 'from-env'
    });
  });

  it('runtime config 会覆盖 env', async () => {
    vi.stubEnv('DEVTEAM_LLM_PROVIDER', 'mock');
    vi.stubEnv('DEVTEAM_LLM_MODEL', 'env-model');
    vi.stubEnv('OPENAI_API_KEY', 'env-secret-key');

    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { model: string };

      expect(body.model).toBe('runtime-model');
      expect((init?.headers as Record<string, string>).authorization).toBe('Bearer runtime-secret-key');

      return new Response(
        JSON.stringify({
          id: 'resp_runtime',
          choices: [{ message: { content: 'runtime-win' } }]
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    });

    const provider = createLlmProvider({
      provider: 'openai',
      model: 'runtime-model',
      apiKey: 'runtime-secret-key',
      fetch: fetchImpl,
      maxRetries: 0
    });

    expect(provider.name).toBe('openai');
    await expect(provider.generate({ prompt: 'hello' })).resolves.toMatchObject({
      provider: 'openai',
      model: 'runtime-model',
      text: 'runtime-win'
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('llm provider retry behavior', () => {
  it('瞬时网络错误才允许有限重试', async () => {
    const fetchImpl: typeof fetch = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('temporary network error'))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'resp_1',
            choices: [{ message: { content: 'ok' } }]
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      );

    const provider = createLlmProvider({
      provider: 'openai',
      apiKey: 'secret-key',
      model: 'gpt-4o-mini',
      maxRetries: 1,
      fetch: fetchImpl
    });

    await expect(provider.generate({ prompt: 'hello' })).resolves.toMatchObject({
      provider: 'openai',
      model: 'gpt-4o-mini',
      text: 'ok'
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('配置错误/结构错误不重试', async () => {
    const configFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'bad request' } }), {
        status: 400,
        headers: { 'content-type': 'application/json' }
      })
    );
    const configErrorProvider = createLlmProvider({
      provider: 'openai',
      apiKey: 'secret-key',
      model: 'gpt-4o-mini',
      maxRetries: 3,
      fetch: configFetch
    });

    await expect(configErrorProvider.generate({ prompt: 'hello' })).rejects.toBeInstanceOf(LlmConfigurationError);
    expect(configFetch).toHaveBeenCalledTimes(1);

    const schemaFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: {} }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    );
    const schemaErrorProvider = createLlmProvider({
      provider: 'openai',
      apiKey: 'secret-key',
      model: 'gpt-4o-mini',
      maxRetries: 3,
      fetch: schemaFetch
    });

    await expect(schemaErrorProvider.generate({ prompt: 'hello' })).rejects.toBeInstanceOf(LlmSchemaError);
    expect(schemaFetch).toHaveBeenCalledTimes(1);
  });

  it('瞬时网络错误才允许有限重试（minimax）', async () => {
    const transientFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: 'upstream busy' } }), {
          status: 503,
          headers: { 'content-type': 'application/json' }
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ content: [{ type: 'thinking', thinking: '...' }, { type: 'text', text: 'minimax-ok' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      );

    const provider = createLlmProvider({
      provider: 'minimax',
      apiKey: 'minimax-secret-key',
      model: 'MiniMax-M2.7',
      maxRetries: 1,
      fetch: transientFetch
    });

    await expect(provider.generate({ prompt: 'hello' })).resolves.toMatchObject({
      provider: 'minimax',
      model: 'MiniMax-M2.7',
      text: 'minimax-ok'
    });
    expect(transientFetch).toHaveBeenCalledTimes(2);
  });

  it('429 会触发有限重试（minimax）', async () => {
    const transientFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: 'rate limited' } }), {
          status: 429,
          headers: { 'content-type': 'application/json' }
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ content: [{ type: 'text', text: 'retry-after-429' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      );

    const provider = createLlmProvider({
      provider: 'minimax',
      apiKey: 'minimax-secret-key',
      model: 'MiniMax-M2.7',
      maxRetries: 1,
      fetch: transientFetch
    });

    await expect(provider.generate({ prompt: 'hello' })).resolves.toMatchObject({
      provider: 'minimax',
      model: 'MiniMax-M2.7',
      text: 'retry-after-429'
    });
    expect(transientFetch).toHaveBeenCalledTimes(2);
  });

  it('配置错误/结构错误不重试（minimax）', async () => {
    const configFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'invalid api key' } }), {
        status: 400,
        headers: { 'content-type': 'application/json' }
      })
    );
    const configErrorProvider = createLlmProvider({
      provider: 'minimax',
      apiKey: 'minimax-secret-key',
      model: 'MiniMax-M2.7',
      maxRetries: 3,
      fetch: configFetch
    });

    await expect(configErrorProvider.generate({ prompt: 'hello' })).rejects.toBeInstanceOf(LlmConfigurationError);
    expect(configFetch).toHaveBeenCalledTimes(1);

    const schemaFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ content: [{ type: 'thinking', thinking: 'wrong-shape' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    );
    const schemaErrorProvider = createLlmProvider({
      provider: 'minimax',
      apiKey: 'minimax-secret-key',
      model: 'MiniMax-M2.7',
      maxRetries: 3,
      fetch: schemaFetch
    });

    await expect(schemaErrorProvider.generate({ prompt: 'hello' })).rejects.toBeInstanceOf(LlmSchemaError);
    expect(schemaFetch).toHaveBeenCalledTimes(1);
  });
});

describe('llm provider logging', () => {
  it('logging 不泄露 secret', async () => {
    const logs: string[] = [];
    const secret = 'secret-key';
    const provider = createLlmProvider({
      provider: 'openai',
      apiKey: secret,
      model: 'gpt-4o-mini',
      maxRetries: 0,
      fetch: vi.fn().mockRejectedValue(new LlmTransientError(`upstream rejected ${secret}`)),
      logger(entry) {
        logs.push(JSON.stringify(entry));
      }
    });

    await expect(provider.generate({ prompt: 'hello' })).rejects.toBeInstanceOf(LlmTransientError);
    expect(logs).not.toHaveLength(0);
    expect(logs.join('\n')).not.toContain(secret);
    expect(logs.join('\n')).toContain('openai');
    expect(logs.join('\n')).toContain('gpt-4o-mini');
    expect(logs.join('\n')).toContain('failure');
  });

  it('logging 不泄露 minimax secret', async () => {
    const logs: string[] = [];
    const secret = 'minimax-secret-key';
    const provider = createLlmProvider({
      provider: 'minimax',
      apiKey: secret,
      model: 'MiniMax-M2.7',
      maxRetries: 0,
      fetch: vi.fn().mockRejectedValue(new LlmTransientError(`upstream rejected ${secret}`)),
      logger(entry) {
        logs.push(JSON.stringify(entry));
      }
    });

    await expect(provider.generate({ prompt: 'hello' })).rejects.toBeInstanceOf(LlmTransientError);
    expect(logs).not.toHaveLength(0);
    expect(logs.join('\n')).not.toContain(secret);
    expect(logs.join('\n')).toContain('minimax');
    expect(logs.join('\n')).toContain('MiniMax-M2.7');
    expect(logs.join('\n')).toContain('failure');
  });
});

describe('llm provider timeout behavior', () => {
  it('MiniMax 默认 timeout 延长到 30s，避免 10s 即 aborted', async () => {
    vi.useFakeTimers();

    try {
      let settled = false;
      const fetchImpl = vi.fn().mockImplementation(
        (_input: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              reject(new DOMException('request timed out', 'AbortError'));
            });
          })
      );

      const provider = createLlmProvider({
        provider: 'minimax',
        apiKey: 'minimax-secret-key',
        model: 'MiniMax-M2.7',
        maxRetries: 0,
        fetch: fetchImpl
      });
      const pending = provider.generate({ prompt: 'hello' });
      pending.then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
        }
      );
      pending.catch(() => undefined);

      await vi.advanceTimersByTimeAsync(10_000);
      await Promise.resolve();
      expect(settled).toBe(false);

      await vi.advanceTimersByTimeAsync(19_999);
      await Promise.resolve();
      expect(settled).toBe(false);

      await vi.advanceTimersByTimeAsync(1);
      await expect(pending).rejects.toBeInstanceOf(LlmTransientError);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('在 timeout 内完成时正常返回', async () => {
    const provider = createLlmProvider({
      provider: 'openai',
      apiKey: 'secret-key',
      model: 'gpt-4o-mini',
      timeoutMs: 50,
      maxRetries: 0,
      fetch: vi.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(() => {
              resolve(
                new Response(
                  JSON.stringify({
                    id: 'resp_fast',
                    choices: [{ message: { content: 'fast-enough' } }]
                  }),
                  { status: 200, headers: { 'content-type': 'application/json' } }
                )
              );
            }, 5);
          })
      )
    });

    await expect(provider.generate({ prompt: 'hello' })).resolves.toMatchObject({
      provider: 'openai',
      model: 'gpt-4o-mini',
      text: 'fast-enough'
    });
  });

  it('timeout 会触发可见失败且不静默 fallback', async () => {
    const fetchImpl = vi.fn().mockImplementation(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('request timed out', 'AbortError'));
          });
        })
    );

    const provider = createLlmProvider({
      provider: 'openai',
      apiKey: 'secret-key',
      model: 'gpt-4o-mini',
      timeoutMs: 5,
      maxRetries: 0,
      fetch: fetchImpl
    });

    expect(provider.name).toBe('openai');
    await expect(provider.generate({ prompt: 'hello' })).rejects.toBeInstanceOf(LlmTransientError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('timeout 会触发 minimax 可见失败且不静默 fallback', async () => {
    const fetchImpl = vi.fn().mockImplementation(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('request timed out', 'AbortError'));
          });
        })
    );

    const provider = createLlmProvider({
      provider: 'minimax',
      apiKey: 'minimax-secret-key',
      model: 'MiniMax-M2.7',
      timeoutMs: 5,
      maxRetries: 0,
      fetch: fetchImpl
    });

    expect(provider.name).toBe('minimax');
    await expect(provider.generate({ prompt: 'hello' })).rejects.toBeInstanceOf(LlmTransientError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('malformed minimax 响应报 LlmSchemaError', async () => {
    const provider = createLlmProvider({
      provider: 'minimax',
      apiKey: 'minimax-secret-key',
      model: 'MiniMax-M2.7',
      maxRetries: 0,
      fetch: vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ content: [{ type: 'text', text: 123 }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      )
    });

    await expect(provider.generate({ prompt: 'hello' })).rejects.toBeInstanceOf(LlmSchemaError);
  });
});
