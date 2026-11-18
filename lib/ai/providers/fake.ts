import { createHash } from 'crypto';
import { jsonInstructions, parseWithSchema } from '../json';
import {
  EMBEDDING_DIMENSIONS,
  type AIProvider,
  type EmbedOptions,
  type EmbedResult,
  type GenerateObjectOptions,
  type GenerateOptions,
  type ObjectResult,
  type TextResult,
} from '../types';

export type FakeCall = {
  kind: 'text' | 'object' | 'embed';
  model: string;
  system?: string;
  prompt: string;
  texts?: string[];
};

/**
 * Deterministic provider for tests and local development (no network, no key).
 * Replies come from a queue (`script`) or a `handler`; embeddings are a hashed
 * bag-of-words so similar texts are close. Every call is recorded in `calls`.
 */
export class FakeProvider implements AIProvider {
  readonly name = 'fake';
  calls: FakeCall[] = [];
  private queue: unknown[] = [];
  handler: ((call: FakeCall) => unknown) | null = null;
  failNext = 0;
  invalidNext = 0;
  failEmbed = false;

  reset() {
    this.calls = [];
    this.queue = [];
    this.handler = null;
    this.failNext = 0;
    this.invalidNext = 0;
    this.failEmbed = false;
  }

  /** Queue replies, used in order by generateObject / generateText. */
  script(...replies: unknown[]) {
    this.queue.push(...replies);
  }

  private next(call: FakeCall) {
    if (this.failNext > 0) {
      this.failNext--;
      throw new Error('fake provider: simulated outage');
    }

    if (this.queue.length) {
      return this.queue.shift();
    }

    if (this.handler) {
      return this.handler(call);
    }

    return {};
  }

  async generateText(o: GenerateOptions): Promise<TextResult> {
    const call: FakeCall = {
      kind: 'text',
      model: o.model,
      system: o.system,
      prompt: o.prompt,
    };

    this.calls.push(call);

    const r = this.next(call);

    return {
      text: typeof r === 'string' ? r : JSON.stringify(r),
      model: o.model,
      usage: { inputTokens: Math.ceil(o.prompt.length / 4), outputTokens: 10 },
    };
  }

  async generateObject<T>(
    o: GenerateObjectOptions<T>
  ): Promise<ObjectResult<T>> {
    const call: FakeCall = {
      kind: 'object',
      model: o.model,
      system: [o.system, jsonInstructions(o.schema, o.schemaName)]
        .filter(Boolean)
        .join('\n\n'),
      prompt: o.prompt,
    };

    this.calls.push(call);

    if (this.invalidNext > 0) {
      this.invalidNext--;

      return {
        object: parseWithSchema('not json at all', o.schema),
        text: '',
        model: o.model,
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    }

    const r = this.next(call);
    const text = typeof r === 'string' ? r : JSON.stringify(r);

    return {
      object: parseWithSchema(text, o.schema),
      text,
      model: o.model,
      usage: {
        inputTokens: Math.ceil(o.prompt.length / 4),
        outputTokens: Math.ceil(text.length / 4),
      },
    };
  }

  async embed(o: EmbedOptions): Promise<EmbedResult> {
    this.calls.push({
      kind: 'embed',
      model: o.model,
      prompt: '',
      texts: o.texts,
    });

    if (this.failEmbed) {
      throw new Error('fake provider: embeddings are down');
    }

    return {
      vectors: o.texts.map((t) =>
        hashEmbedding(t, o.dimensions || EMBEDDING_DIMENSIONS)
      ),
      model: o.model,
      usage: { inputTokens: o.texts.join(' ').length / 4, outputTokens: 0 },
    };
  }
}

/** Hashed bag-of-words embedding, L2-normalised. */
export function hashEmbedding(text: string, dims = EMBEDDING_DIMENSIONS) {
  const v = new Array<number>(dims).fill(0);

  for (const w of text.toLowerCase().match(/[a-z0-9+#.]+/g) ?? []) {
    const h = createHash('sha1').update(w).digest();
    const idx = h.readUInt16BE(0) % dims;

    v[idx] += h[2] % 2 === 0 ? 1 : -1;
  }

  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;

  return v.map((x) => x / norm);
}

/** Shared instance so tests can script it. */
export const fakeProvider = new FakeProvider();
