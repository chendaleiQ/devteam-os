import {
  LlmConfigurationError,
  LlmSchemaError,
  LlmTransientError,
  type LlmGenerateRequest,
  type LlmGenerateResponse,
  type LlmLogEntry,
  type LlmProvider,
  type OpenAiLlmConfig
} from './types.js';

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RETRIES = 1;
const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

export class OpenAiLlmProvider implements LlmProvider {
  readonly name = 'openai' as const;

  private readonly apiKey: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly logger?: OpenAiLlmConfig['logger'];

  constructor(config: OpenAiLlmConfig) {
    if (!config.apiKey) {
      throw new LlmConfigurationError('OpenAI provider requires apiKey');
    }
    if (!config.model) {
      throw new LlmConfigurationError('OpenAI provider requires model');
    }
    if (typeof fetch !== 'function' && !config.fetch) {
      throw new LlmConfigurationError('OpenAI provider requires fetch support');
    }

    this.apiKey = config.apiKey;
    this.model = config.model;
    this.timeoutMs = normalizePositiveInt(config.timeoutMs, DEFAULT_TIMEOUT_MS);
    this.maxRetries = normalizeNonNegativeInt(config.maxRetries, DEFAULT_MAX_RETRIES);
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
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
          const llmError = normalizeOpenAiError(error);
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
      throw normalizeOpenAiError(error);
    }
  }

  private async fetchCompletion(request: LlmGenerateRequest): Promise<LlmGenerateResponse> {
    const response = await this.fetchWithTimeout(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: this.model,
        messages: buildMessages(request)
      })
    });

    if (!response.ok) {
      const errorSummary = await readErrorSummary(response);
      if (response.status >= 500 || response.status === 429) {
        throw new LlmTransientError(errorSummary);
      }
      throw new LlmConfigurationError(errorSummary);
    }

    const payload: unknown = await response.json();
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
        throw new LlmTransientError(error instanceof Error ? error.message : 'OpenAI request failed');
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

function buildMessages(request: LlmGenerateRequest) {
  return [
    ...(request.system ? [{ role: 'system', content: request.system }] : []),
    { role: 'user', content: request.prompt }
  ];
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

  return `OpenAI request failed with status ${response.status}`;
}

function readAssistantText(payload: unknown): string {
  if (!isRecord(payload) || !Array.isArray(payload.choices)) {
    throw new LlmSchemaError('OpenAI response missing choices');
  }

  const firstChoice = payload.choices[0];
  if (!isRecord(firstChoice) || !isRecord(firstChoice.message) || typeof firstChoice.message.content !== 'string') {
    throw new LlmSchemaError('OpenAI response missing assistant content');
  }

  return firstChoice.message.content;
}

function normalizeOpenAiError(error: unknown): Error {
  if (error instanceof LlmConfigurationError || error instanceof LlmTransientError || error instanceof LlmSchemaError) {
    return error;
  }

  if (error instanceof Error) {
    return new LlmTransientError(error.message);
  }

  return new LlmTransientError('Unknown OpenAI error');
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

function sanitizeSecrets(input: string, secrets: string[]): string {
  return secrets.reduce((text, secret) => (secret ? text.split(secret).join('[redacted]') : text), input);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}
