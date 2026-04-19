import { MockLlmProvider } from './mock.js';
import { MiniMaxLlmProvider } from './minimax.js';
import { OpenAiLlmProvider } from './openai.js';
import {
  LlmConfigurationError,
  type LlmProvider,
  type LlmProviderConfig,
  type MiniMaxLlmConfig,
  type MockLlmConfig,
  type OpenAiLlmConfig
} from './types.js';

export * from './types.js';

export function createLlmProvider(config: LlmProviderConfig = {}): LlmProvider {
  const resolvedConfig = resolveProviderConfig(config);
  const providerName = resolvedConfig.provider ?? 'mock';

  if (providerName === 'mock') {
    return new MockLlmProvider();
  }

  if (providerName === 'openai') {
    return new OpenAiLlmProvider({ ...resolvedConfig, provider: 'openai' });
  }

  if (providerName === 'minimax') {
    return new MiniMaxLlmProvider({ ...resolvedConfig, provider: 'minimax' });
  }

  throw new LlmConfigurationError(`Unknown llm provider: ${providerName}`);
}

export function hasConfiguredLlmProvider(config: Pick<LlmProviderConfig, 'provider'> = {}): boolean {
  const runtimeProvider = config.provider;
  const envProvider = readEnv('DEVTEAM_LLM_PROVIDER');

  if (runtimeProvider && !normalizeProviderName(runtimeProvider)) {
    throw new LlmConfigurationError(`Unknown llm provider: ${runtimeProvider}`);
  }

  if (envProvider && !normalizeProviderName(envProvider)) {
    throw new LlmConfigurationError(`Unknown llm provider: ${envProvider}`);
  }

  return normalizeProviderName(runtimeProvider) !== undefined || normalizeProviderName(envProvider) !== undefined;
}

function resolveProviderConfig(config: LlmProviderConfig): LlmProviderConfig {
  const runtimeProvider = config.provider;
  const envProvider = readEnv('DEVTEAM_LLM_PROVIDER');

  if (runtimeProvider && !normalizeProviderName(runtimeProvider)) {
    throw new LlmConfigurationError(`Unknown llm provider: ${runtimeProvider}`);
  }

  if (envProvider && !normalizeProviderName(envProvider)) {
    throw new LlmConfigurationError(`Unknown llm provider: ${envProvider}`);
  }

  const provider = normalizeProviderName(runtimeProvider) ?? normalizeProviderName(envProvider) ?? 'mock';

  if (provider === 'openai') {
    const resolved: OpenAiLlmConfig = {
      ...config,
      provider: 'openai'
    };

    const model = config.model ?? readEnv('DEVTEAM_LLM_MODEL');
    const apiKey = ('apiKey' in config ? config.apiKey : undefined) ?? readEnv('OPENAI_API_KEY');

    if (model) {
      resolved.model = model;
    }
    if (apiKey) {
      resolved.apiKey = apiKey;
    }

    return resolved;
  }

  if (provider === 'minimax') {
    const resolved: MiniMaxLlmConfig = {
      ...config,
      provider: 'minimax'
    };

    const model = config.model ?? readEnv('DEVTEAM_LLM_MODEL');
    const apiKey = ('apiKey' in config ? config.apiKey : undefined) ?? readEnv('ANTHROPIC_API_KEY');
    const baseUrl = ('baseUrl' in config ? config.baseUrl : undefined) ?? readEnv('ANTHROPIC_BASE_URL');

    if (model) {
      resolved.model = model;
    }
    if (apiKey) {
      resolved.apiKey = apiKey;
    }
    if (baseUrl) {
      resolved.baseUrl = baseUrl;
    }

    return resolved;
  }

  const resolved: MockLlmConfig = {
    ...config,
    provider: 'mock'
  };

  return resolved;
}

function readEnv(
  name:
    | 'DEVTEAM_LLM_PROVIDER'
    | 'DEVTEAM_LLM_MODEL'
    | 'OPENAI_API_KEY'
    | 'ANTHROPIC_API_KEY'
    | 'ANTHROPIC_BASE_URL'
): string | undefined {
  const value = process.env[name];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function normalizeProviderName(
  value: string | undefined
): MockLlmConfig['provider'] | OpenAiLlmConfig['provider'] | MiniMaxLlmConfig['provider'] | undefined {
  return value === 'mock' || value === 'openai' || value === 'minimax' ? value : undefined;
}
