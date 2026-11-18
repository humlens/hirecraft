import Anthropic from '@anthropic-ai/sdk';
import { ApiError } from '../../errors';
import { jsonInstructions, parseWithSchema } from '../json';
import type {
  AIProvider,
  EmbedResult,
  GenerateObjectOptions,
  GenerateOptions,
  ObjectResult,
  TextResult,
} from '../types';

export type AnthropicOptions = {
  apiKey: string;
  baseURL?: string;
  timeoutMs?: number;
};

export class AnthropicProvider implements AIProvider {
  readonly name = 'anthropic';
  private client: Anthropic;

  constructor(opts: AnthropicOptions) {
    this.client = new Anthropic({
      apiKey: opts.apiKey,
      baseURL: opts.baseURL,
      maxRetries: 1,
      timeout: opts.timeoutMs ?? 60_000,
    });
  }

  private async complete(o: GenerateOptions, extraSystem = '') {
    const system = [o.system, extraSystem].filter(Boolean).join('\n\n');
    const res = await this.client.messages.create(
      {
        model: o.model,
        max_tokens: o.maxTokens ?? 4096,
        // no `temperature`: current Claude models do not accept sampling parameters
        ...(system ? { system } : {}),
        messages: [{ role: 'user', content: o.prompt }],
      },
      { signal: o.signal }
    );
    const text = res.content
      .map((b) => (b.type === 'text' ? b.text : ''))
      .join('');

    return {
      text,
      model: res.model ?? o.model,
      usage: {
        inputTokens: res.usage?.input_tokens ?? 0,
        outputTokens: res.usage?.output_tokens ?? 0,
      },
    };
  }

  generateText(o: GenerateOptions): Promise<TextResult> {
    return this.complete(o);
  }

  async generateObject<T>(
    o: GenerateObjectOptions<T>
  ): Promise<ObjectResult<T>> {
    const r = await this.complete(o, jsonInstructions(o.schema, o.schemaName));

    return { ...r, object: parseWithSchema(r.text, o.schema) };
  }

  async embed(): Promise<EmbedResult> {
    throw new ApiError(
      501,
      'Anthropic has no embeddings API. Configure an embedding provider (OpenAI, Gemini or compatible).'
    );
  }
}
