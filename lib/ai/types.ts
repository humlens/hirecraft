import type { ZodType } from 'zod';

export type Tier = 'fast' | 'standard';

export type Usage = { inputTokens: number; outputTokens: number };

export type TextResult = { text: string; usage: Usage; model: string };
export type ObjectResult<T> = {
  object: T;
  text: string;
  usage: Usage;
  model: string;
};
export type EmbedResult = { vectors: number[][]; usage: Usage; model: string };

export type GenerateOptions = {
  model: string;
  system?: string;
  prompt: string;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
};

export type GenerateObjectOptions<T> = GenerateOptions & {
  schema: ZodType<T>;
  /** Short name of the expected object, used in the instructions. */
  schemaName?: string;
};

export type EmbedOptions = {
  model: string;
  texts: string[];
  dimensions: number;
};

/** The single abstraction every adapter implements. */
export interface AIProvider {
  readonly name: string;
  generateText(opts: GenerateOptions): Promise<TextResult>;
  generateObject<T>(opts: GenerateObjectOptions<T>): Promise<ObjectResult<T>>;
  embed(opts: EmbedOptions): Promise<EmbedResult>;
}

/** Thrown when a model reply cannot be turned into the requested object. */
export class AIOutputError extends Error {
  constructor(
    message: string,
    public readonly raw: string
  ) {
    super(message);
  }
}

export const EMBEDDING_DIMENSIONS = 1536;
