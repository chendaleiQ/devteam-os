import {
  LlmConfigurationError,
  LlmSchemaError,
  LlmTransientError,
  type LlmGenerateRequest,
  type LlmGenerateResponse,
  type LlmLogEntry,
  type LlmProvider,
  type MiniMaxLlmConfig
} from './types.js';

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 1;
const DEFAULT_BASE_URL = 'https://api.minimaxi.com/anthropic';
const DEFAULT_MAX_TOKENS = 4096;
const ANTHROPIC_VERSION = '2023-06-01';

export class MiniMaxLlmProvider implements LlmProvider {
  readonly name = 'minimax' as const;

  private readonly apiKey: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly logger?: MiniMaxLlmConfig['logger'];

  constructor(config: MiniMaxLlmConfig) {
    if (!config.apiKey) {
      throw new LlmConfigurationError('MiniMax provider requires apiKey');
    }
    if (!config.model) {
      throw new LlmConfigurationError('MiniMax provider requires model');
    }
    if (typeof fetch !== 'function' && !config.fetch) {
      throw new LlmConfigurationError('MiniMax provider requires fetch support');
    }

    this.apiKey = config.apiKey;
    this.model = config.model;
    this.timeoutMs = normalizePositiveInt(config.timeoutMs, DEFAULT_TIMEOUT_MS);
    this.maxRetries = normalizeNonNegativeInt(config.maxRetries, DEFAULT_MAX_RETRIES);
    this.baseUrl = normalizeBaseUrl(config.baseUrl ?? DEFAULT_BASE_URL);
    this.fetchImpl = config.fetch ?? fetch;
    this.logger = config.logger;
  }

  async generate(request: LlmGenerateRequest): Promise<LlmGenerateResponse> {
    const startedAt = Date.now();
    let attempts = 0;

    try {
      while (true) {
        attempts += 1;

        try {
          const response = await this.fetchCompletion(request);
          this.log({
            provider: this.name,
            model: this.model,
            durationMs: Date.now() - startedAt,
            status: 'success',
            attempts
          });
          return response;
        } catch (error) {
          const llmError = normalizeMiniMaxError(error);
          if (!(llmError instanceof LlmTransientError) || attempts > this.maxRetries) {
            this.log({
              provider: this.name,
              model: this.model,
              durationMs: Date.now() - startedAt,
              status: 'failure',
              errorSummary: sanitizeSecrets(llmError.message, [this.apiKey]),
              attempts
            });
            throw llmError;
          }
        }
      }
    } catch (error) {
      throw normalizeMiniMaxError(error);
    }
  }

  private async fetchCompletion(request: LlmGenerateRequest): Promise<LlmGenerateResponse> {
    const response = await this.fetchWithTimeout(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': ANTHROPIC_VERSION
      },
      body: JSON.stringify(buildRequestBody(this.model, request))
    });

    if (!response.ok) {
      const errorSummary = await readErrorSummary(response);
      if (response.status >= 500 || response.status === 429) {
        throw new LlmTransientError(errorSummary);
      }
      throw new LlmConfigurationError(errorSummary);
    }

    const payload = await parseJson(response);
    const text = readAssistantText(payload);

    return {
      provider: this.name,
      model: this.model,
      text
    };
  }

  private async fetchWithTimeout(input: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      return await this.fetchImpl(input, { ...init, signal: controller.signal });
    } catch (error) {
      if (isAbortError(error) || error instanceof TypeError) {
        throw new LlmTransientError(error instanceof Error ? error.message : 'MiniMax request failed');
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private log(entry: LlmLogEntry): void {
    this.logger?.(entry);
  }
}

async function parseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch (error) {
    throw new LlmSchemaError(error instanceof Error ? error.message : 'MiniMax response was not valid JSON');
  }
}

function buildRequestBody(model: string, request: LlmGenerateRequest) {
  return {
    model,
    max_tokens: DEFAULT_MAX_TOKENS,
    ...(request.system ? { system: request.system } : {}),
    messages: [{ role: 'user', content: request.prompt }]
  };
}

async function readErrorSummary(response: Response): Promise<string> {
  try {
    const payload: unknown = await response.json();
    if (isRecord(payload)) {
      const error = payload.error;
      if (isRecord(error) && typeof error.message === 'string') {
        return error.message;
      }
    }
  } catch {
    // ignore parse failure
  }

  return `MiniMax request failed with status ${response.status}`;
}

function readAssistantText(payload: unknown): string {
  if (!isRecord(payload) || !Array.isArray(payload.content)) {
    throw new LlmSchemaError('MiniMax response missing content');
  }

  const textBlocks: string[] = [];

  for (const block of payload.content) {
    if (isRecord(block) && block.type === 'text' && typeof block.text === 'string') {
      textBlocks.push(block.text);
    }
  }

  if (textBlocks.length > 0) {
    return textBlocks.join('');
  }

  throw new LlmSchemaError('MiniMax response missing text content');
}

function normalizeMiniMaxError(error: unknown): Error {
  if (error instanceof LlmConfigurationError || error instanceof LlmTransientError || error instanceof LlmSchemaError) {
    return error;
  }

  if (error instanceof Error) {
    return new LlmTransientError(error.message);
  }

  return new LlmTransientError('Unknown MiniMax error');
}

function normalizePositiveInt(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }

  return Math.floor(value);
}

function normalizeNonNegativeInt(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return fallback;
  }

  return Math.floor(value);
}

function normalizeBaseUrl(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

function sanitizeSecrets(input: string, secrets: string[]): string {
  return secrets.reduce((text, secret) => (secret ? text.split(secret).join('[redacted]') : text), input);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}
