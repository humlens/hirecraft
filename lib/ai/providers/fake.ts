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

    return cannedReply(call);
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

/**
 * Plausible answers for local development and browser tests (no handler set):
 * each feature gets a small valid reply derived from its prompt.
 */
function cannedReply(call: FakeCall): unknown {
  const sys = call.system ?? '';
  const skills = (call.prompt.match(/Skills?:\s*(.+)/i)?.[1] ?? '')
    .split(/[,;]/)
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 12);

  if (sys.includes('recruiting copilot')) {
    return { type: 'final', answer: 'Here is what I found in your records.' };
  }

  if (sys.includes('natural-language talent search')) {
    return {
      skills: [],
      keywords: call.prompt
        .replace(/[<>/a-z]*data>/gi, ' ')
        .split(/\s+/)
        .filter((w) => w.length > 3)
        .slice(0, 4),
      location: null,
      minYears: null,
      maxYears: null,
      workMode: null,
    };
  }

  if (sys.includes('write clear, inclusive')) {
    return {
      overview: 'Join our team and help us build great products.',
      responsibilities: [
        'Design and ship features',
        'Collaborate with the team',
      ],
      requirements: ['Relevant experience', 'Clear communication'],
      niceToHave: [],
      benefits: [],
    };
  }

  if (sys.includes('assess how well an anonymised candidate')) {
    return {
      technicalDepth: { score: 70, rationale: 'Relevant experience shown.' },
      evidence: [],
      explanation: 'Reasonable fit based on the listed skills.',
      suggestedQuestions: ['Tell us about a project you are proud of.'],
    };
  }

  if (sys.includes('structured interview questions')) {
    return {
      competencies: [
        {
          name: 'Technical skills',
          questions: [
            {
              question: 'Walk us through a hard problem you solved.',
              whatToLookFor: 'Clear reasoning',
            },
          ],
        },
      ],
      evaluationTemplate: [],
    };
  }

  if (sys.includes('draft short, polite')) {
    return {
      subject: 'An update on your application',
      body: 'Hi {candidate_name},\n\nThank you for your patience. We will be in touch soon.',
    };
  }

  if (sys.includes('summarise interviewers')) {
    return {
      summary: 'Feedback summary.',
      strengths: [],
      concerns: [],
      consensus: 'See individual scorecards.',
    };
  }

  // resume parsing
  return {
    skills: skills.map((value) => ({ value, confidence: 0.9 })),
  };
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
