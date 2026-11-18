import { GoogleGenAI } from '@google/genai';
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

export type GeminiOptions = {
  apiKey: string;
  baseURL?: string;
  timeoutMs?: number;
};

export class GeminiProvider implements AIProvider {
  readonly name = 'gemini';
  private ai: GoogleGenAI;

  constructor(opts: GeminiOptions) {
    this.ai = new GoogleGenAI({
      apiKey: opts.apiKey,
      httpOptions: {
        ...(opts.baseURL ? { baseUrl: opts.baseURL } : {}),
        timeout: opts.timeoutMs ?? 60_000,
      },
    });
  }

  private async complete(o: GenerateOptions, json: boolean, extraSystem = '') {
    const system = [o.system, extraSystem].filter(Boolean).join('\n\n');
    const res = await this.ai.models.generateContent({
      model: o.model,
      contents: o.prompt,
      config: {
        ...(system ? { systemInstruction: system } : {}),
        temperature: o.temperature ?? (json ? 0 : 0.2),
        ...(o.maxTokens ? { maxOutputTokens: o.maxTokens } : {}),
        ...(json ? { responseMimeType: 'application/json' } : {}),
        abortSignal: o.signal,
      },
    });

    return {
      text: res.text ?? '',
      model: res.modelVersion ?? o.model,
      usage: {
        inputTokens: res.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: res.usageMetadata?.candidatesTokenCount ?? 0,
      },
    };
  }

  generateText(o: GenerateOptions): Promise<TextResult> {
    return this.complete(o, false);
  }

  async generateObject<T>(
    o: GenerateObjectOptions<T>
  ): Promise<ObjectResult<T>> {
    const r = await this.complete(
      o,
      true,
      jsonInstructions(o.schema, o.schemaName)
    );

    return { ...r, object: parseWithSchema(r.text, o.schema) };
  }

  async embed(o: EmbedOptions): Promise<EmbedResult> {
    const res = await this.ai.models.embedContent({
      model: o.model,
      contents: o.texts,
      config: { outputDimensionality: o.dimensions },
    });

    return {
      vectors: (res.embeddings ?? []).map((e) => e.values ?? []),
      model: o.model,
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  }
}
