export type LlmProviderName = 'mock' | 'openai' | 'minimax';

export interface LlmGenerateRequest {
  prompt: string;
  system?: string;
}

export interface LlmGenerateResponse {
  provider: LlmProviderName;
  model: string;
  text: string;
}

export interface LlmLogEntry {
  provider: LlmProviderName;
  model: string;
  durationMs: number;
  status: 'success' | 'failure';
  errorSummary?: string;
  attempts: number;
}

export type LlmLogger = (entry: LlmLogEntry) => void;

export interface LlmProvider {
  readonly name: LlmProviderName;
  generate(request: LlmGenerateRequest): Promise<LlmGenerateResponse>;
}

export interface BaseLlmConfig {
  provider?: string;
  model?: string;
  timeoutMs?: number;
  maxRetries?: number;
  logger?: LlmLogger;
}

export interface MockLlmConfig extends BaseLlmConfig {
  provider?: 'mock';
}

export interface OpenAiLlmConfig extends BaseLlmConfig {
  provider: 'openai';
  apiKey?: string;
  baseUrl?: string;
  fetch?: typeof fetch;
}

export interface MiniMaxLlmConfig extends BaseLlmConfig {
  provider: 'minimax';
  apiKey?: string;
  baseUrl?: string;
  fetch?: typeof fetch;
}

export type LlmProviderConfig = MockLlmConfig | OpenAiLlmConfig | MiniMaxLlmConfig;

export class LlmError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class LlmConfigurationError extends LlmError {}

export class LlmTransientError extends LlmError {}

export class LlmSchemaError extends LlmError {}
