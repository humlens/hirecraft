import type { ZodType } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { AIOutputError } from './types';

/** Extracts a JSON value from a model reply (handles ``` fences and stray text). */
export function parseJsonLoose(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const candidate = fenced ? fenced[1] : trimmed;

  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.search(/[{[]/);
    const end = Math.max(
      candidate.lastIndexOf('}'),
      candidate.lastIndexOf(']')
    );

    if (start >= 0 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1));
      } catch {
        // fall through
      }
    }

    throw new AIOutputError('The model did not return valid JSON.', text);
  }
}

/** Validates a model reply against a zod schema. */
export function parseWithSchema<T>(text: string, schema: ZodType<T>): T {
  const json = parseJsonLoose(text);
  const result = schema.safeParse(json);

  if (!result.success) {
    throw new AIOutputError(
      `The model reply does not match the expected shape: ${result.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('; ')}`,
      text
    );
  }

  return result.data;
}

/** Instructions appended to prompts so any vendor returns the right JSON. */
export function jsonInstructions(schema: ZodType, name = 'result') {
  const js = zodToJsonSchema(schema, { name, $refStrategy: 'none' }) as {
    definitions?: Record<string, unknown>;
  };
  const body = js.definitions?.[name] ?? js;

  return `Reply with ONLY one JSON object (no prose, no markdown fences) that matches this JSON Schema:\n${JSON.stringify(body)}`;
}
