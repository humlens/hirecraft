import OpenAI from 'openai';
import { jsonInstructions, parseWithSchema } from '../json';
import type {
  AIProvider,
  EmbedOptions,
  EmbedResult,
  GenerateObjectOptions,
  GenerateOptions,
  ObjectResult,
  TextResult,
} from '../types';

export type OpenAIOptions = {
  apiKey: string;
  baseURL?: string;
  name?: string;
  /** Some OpenAI-compatible servers do not support response_format. */
  jsonMode?: boolean;
  timeoutMs?: number;
};

/** OpenAI, and any OpenAI-compatible server (vLLM, Ollama, Azure proxies, ...). */
export class OpenAIProvider implements AIProvider {
  readonly name: string;
  private client: OpenAI;
  private jsonMode: boolean;

  constructor(opts: OpenAIOptions) {
    this.name = opts.name ?? 'openai';
    this.jsonMode = opts.jsonMode ?? true;
    this.client = new OpenAI({
      apiKey: opts.apiKey,
      baseURL: opts.baseURL,
      maxRetries: 1,
      timeout: opts.timeoutMs ?? 60_000,
    });
  }

  private messages(o: GenerateOptions, extraSystem = '') {
    const system = [o.system, extraSystem].filter(Boolean).join('\n\n');

    return [
      ...(system ? [{ role: 'system' as const, content: system }] : []),
      { role: 'user' as const, content: o.prompt },
    ];
  }

  async generateText(o: GenerateOptions): Promise<TextResult> {
    const res = await this.client.chat.completions.create(
      {
        model: o.model,
        messages: this.messages(o),
        temperature: o.temperature ?? 0.2,
        ...(o.maxTokens ? { max_tokens: o.maxTokens } : {}),
      },
      { signal: o.signal }
    );

    return {
      text: res.choices[0]?.message?.content ?? '',
      model: res.model ?? o.model,
      usage: {
        inputTokens: res.usage?.prompt_tokens ?? 0,
        outputTokens: res.usage?.completion_tokens ?? 0,
      },
    };
  }

  async generateObject<T>(
    o: GenerateObjectOptions<T>
  ): Promise<ObjectResult<T>> {
    const res = await this.client.chat.completions.create(
      {
        model: o.model,
        messages: this.messages(o, jsonInstructions(o.schema, o.schemaName)),
        temperature: o.temperature ?? 0,
        ...(this.jsonMode
          ? { response_format: { type: 'json_object' as const } }
          : {}),
        ...(o.maxTokens ? { max_tokens: o.maxTokens } : {}),
      },
      { signal: o.signal }
    );
    const text = res.choices[0]?.message?.content ?? '';

    return {
      object: parseWithSchema(text, o.schema),
      text,
      model: res.model ?? o.model,
      usage: {
        inputTokens: res.usage?.prompt_tokens ?? 0,
        outputTokens: res.usage?.completion_tokens ?? 0,
      },
    };
  }

  async embed(o: EmbedOptions): Promise<EmbedResult> {
    const res = await this.client.embeddings.create({
      model: o.model,
      input: o.texts,
      // `dimensions` is honoured by text-embedding-3-*; compatible servers may ignore it
      dimensions: o.dimensions,
    });

    return {
      vectors: res.data.map((d) => d.embedding as number[]),
      model: res.model ?? o.model,
      usage: { inputTokens: res.usage?.prompt_tokens ?? 0, outputTokens: 0 },
    };
  }
}
