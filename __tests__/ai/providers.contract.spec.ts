/**
 * @jest-environment node
 *
 * Contract tests for the AI adapters. Each vendor SDK talks to a local HTTP
 * server that answers in the vendor's wire format, so we verify the real
 * request the SDK builds (path, auth header, body) and how replies and errors
 * are handled. No API keys or network access are needed.
 */
import http from 'http';
import type { AddressInfo } from 'net';
import { z } from 'zod';
import { AnthropicProvider } from '../../lib/ai/providers/anthropic';
import { GeminiProvider } from '../../lib/ai/providers/gemini';
import { OpenAIProvider } from '../../lib/ai/providers/openai';
import { AIOutputError } from '../../lib/ai/types';

type Seen = {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: any;
};

let server: http.Server;
let base = '';
let seen: Seen[] = [];
let reply: (req: Seen) => { status?: number; body: unknown; delayMs?: number };

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];

    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString();
      const s: Seen = {
        method: req.method ?? '',
        url: req.url ?? '',
        headers: req.headers,
        body: raw ? JSON.parse(raw) : null,
      };

      seen.push(s);

      const r = reply(s);

      setTimeout(() => {
        res.writeHead(r.status ?? 200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(r.body));
      }, r.delayMs ?? 0);
    });
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((ok) => server.close(() => ok())));
beforeEach(() => {
  seen = [];
});

const schema = z.object({ title: z.string(), n: z.number() });
const json = JSON.stringify({ title: 'hello', n: 3 });
const vec = (n: number) => Array.from({ length: n }, (_, i) => i / n);

describe('OpenAI adapter', () => {
  const openaiReply = (content: string) => ({
    body: {
      id: 'chatcmpl-1',
      object: 'chat.completion',
      created: 1,
      model: 'gpt-test',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
    },
  });

  it('generateText: calls /chat/completions with bearer auth, model, system and user messages', async () => {
    reply = () => openaiReply('Hi there');
    const p = new OpenAIProvider({ apiKey: 'sk-test', baseURL: `${base}/v1` });
    const r = await p.generateText({
      model: 'gpt-test',
      system: 'Be brief',
      prompt: 'Say hi',
    });

    expect(r).toEqual({
      text: 'Hi there',
      model: 'gpt-test',
      usage: { inputTokens: 11, outputTokens: 7 },
    });
    expect(seen).toHaveLength(1);
    expect(seen[0].method).toBe('POST');
    expect(seen[0].url).toBe('/v1/chat/completions');
    expect(seen[0].headers.authorization).toBe('Bearer sk-test');
    expect(seen[0].body.model).toBe('gpt-test');
    expect(seen[0].body.messages).toEqual([
      { role: 'system', content: 'Be brief' },
      { role: 'user', content: 'Say hi' },
    ]);
  });

  it('generateObject: JSON mode, schema in the instructions, validated object', async () => {
    reply = () => openaiReply(json);
    const p = new OpenAIProvider({ apiKey: 'k', baseURL: `${base}/v1` });
    const r = await p.generateObject({
      model: 'm',
      system: 'S',
      prompt: 'P',
      schema,
    });

    expect(r.object).toEqual({ title: 'hello', n: 3 });
    expect(seen[0].body.response_format).toEqual({ type: 'json_object' });
    expect(seen[0].body.messages[0].content).toContain('JSON Schema');
    expect(seen[0].body.messages[0].content).toContain('"title"');
    expect(seen[0].body.temperature).toBe(0);
  });

  it('accepts JSON wrapped in a code fence', async () => {
    reply = () => openaiReply('```json\n' + json + '\n```');
    const p = new OpenAIProvider({ apiKey: 'k', baseURL: `${base}/v1` });

    expect(
      (await p.generateObject({ model: 'm', prompt: 'P', schema })).object.n
    ).toBe(3);
  });

  it('rejects non-JSON and schema-mismatching replies with AIOutputError', async () => {
    const p = new OpenAIProvider({ apiKey: 'k', baseURL: `${base}/v1` });

    reply = () => openaiReply('Sorry, I cannot do that');
    await expect(
      p.generateObject({ model: 'm', prompt: 'P', schema })
    ).rejects.toBeInstanceOf(AIOutputError);

    reply = () => openaiReply(JSON.stringify({ title: 5 }));
    const err = await p
      .generateObject({ model: 'm', prompt: 'P', schema })
      .catch((e) => e);

    expect(err).toBeInstanceOf(AIOutputError);
    expect(err.message).toContain('title');
  });

  it('embed: /embeddings with model, input and dimensions', async () => {
    reply = () => ({
      body: {
        object: 'list',
        model: 'emb-test',
        data: [
          { object: 'embedding', index: 0, embedding: vec(8) },
          { object: 'embedding', index: 1, embedding: vec(8) },
        ],
        usage: { prompt_tokens: 5, total_tokens: 5 },
      },
    });
    const p = new OpenAIProvider({ apiKey: 'k', baseURL: `${base}/v1` });
    const r = await p.embed({
      model: 'emb-test',
      texts: ['a', 'b'],
      dimensions: 8,
    });

    expect(r.vectors).toHaveLength(2);
    expect(r.vectors[0]).toHaveLength(8);
    expect(r.usage.inputTokens).toBe(5);
    expect(seen[0].url).toBe('/v1/embeddings');
    expect(seen[0].body).toMatchObject({
      model: 'emb-test',
      input: ['a', 'b'],
      dimensions: 8,
    });
  });

  it('maps HTTP errors to thrown errors (401 is not retried into success)', async () => {
    reply = () => ({
      status: 401,
      body: { error: { message: 'bad key', type: 'invalid_request_error' } },
    });
    const p = new OpenAIProvider({ apiKey: 'bad', baseURL: `${base}/v1` });

    await expect(p.generateText({ model: 'm', prompt: 'x' })).rejects.toThrow(
      /401|bad key/
    );
    expect(seen).toHaveLength(1);
  });

  it('times out slow servers', async () => {
    reply = () => ({ ...openaiReply('late'), delayMs: 600 });
    const p = new OpenAIProvider({
      apiKey: 'k',
      baseURL: `${base}/v1`,
      timeoutMs: 100,
    });

    await expect(p.generateText({ model: 'm', prompt: 'x' })).rejects.toThrow();
  });

  it('OpenAI-compatible mode can disable response_format and uses its own name', async () => {
    reply = () => openaiReply(json);
    const p = new OpenAIProvider({
      apiKey: 'none',
      baseURL: `${base}/v1`,
      name: 'openai_compatible',
      jsonMode: false,
    });

    expect(p.name).toBe('openai_compatible');
    expect(
      (await p.generateObject({ model: 'local', prompt: 'P', schema })).object
        .title
    ).toBe('hello');
    expect(seen[0].body.response_format).toBeUndefined();
  });
});

describe('Anthropic adapter', () => {
  const claudeReply = (text: string) => ({
    body: {
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      model: 'claude-test',
      content: [{ type: 'text', text }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 21, output_tokens: 9 },
    },
  });

  it('generateText: /v1/messages with x-api-key, version header, system and max_tokens', async () => {
    reply = () => claudeReply('Hello');
    const p = new AnthropicProvider({ apiKey: 'sk-ant-test', baseURL: base });
    const r = await p.generateText({
      model: 'claude-test',
      system: 'Sys',
      prompt: 'Hi',
    });

    expect(r).toEqual({
      text: 'Hello',
      model: 'claude-test',
      usage: { inputTokens: 21, outputTokens: 9 },
    });
    expect(seen[0].url).toBe('/v1/messages');
    expect(seen[0].headers.authorization).toBe('Bearer sk-ant-test');
    expect(seen[0].headers['anthropic-version']).toBeTruthy();
    expect(seen[0].body).toMatchObject({
      model: 'claude-test',
      system: 'Sys',
      messages: [{ role: 'user', content: 'Hi' }],
    });
    expect(seen[0].body.max_tokens).toBeGreaterThan(0);
    expect(seen[0].body).not.toHaveProperty('temperature'); // current Claude models reject sampling parameters
  });

  it('generateObject: schema instructions in the system prompt, parsed object', async () => {
    reply = () => claudeReply(json);
    const p = new AnthropicProvider({ apiKey: 'k', baseURL: base });
    const r = await p.generateObject({
      model: 'm',
      system: 'Sys',
      prompt: 'P',
      schema,
    });

    expect(r.object).toEqual({ title: 'hello', n: 3 });
    expect(seen[0].body.system).toContain('Sys');
    expect(seen[0].body.system).toContain('JSON Schema');
  });

  it('concatenates several text blocks and ignores non-text blocks', async () => {
    reply = () => ({
      body: {
        id: 'm',
        type: 'message',
        role: 'assistant',
        model: 'c',
        content: [
          { type: 'text', text: '{"title":"a",' },
          { type: 'text', text: '"n":1}' },
        ],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    });
    const p = new AnthropicProvider({ apiKey: 'k', baseURL: base });

    expect(
      (await p.generateObject({ model: 'm', prompt: 'P', schema })).object
    ).toEqual({ title: 'a', n: 1 });
  });

  it('rejects invalid output and reports that embeddings are unsupported (501)', async () => {
    reply = () => claudeReply('no json here');
    const p = new AnthropicProvider({ apiKey: 'k', baseURL: base });

    await expect(
      p.generateObject({ model: 'm', prompt: 'P', schema })
    ).rejects.toBeInstanceOf(AIOutputError);
    await expect(p.embed()).rejects.toMatchObject({ status: 501 });
  });

  it('surfaces API errors', async () => {
    reply = () => ({
      status: 401,
      body: {
        type: 'error',
        error: { type: 'authentication_error', message: 'invalid x-api-key' },
      },
    });
    const p = new AnthropicProvider({ apiKey: 'bad', baseURL: base });

    await expect(p.generateText({ model: 'm', prompt: 'x' })).rejects.toThrow(
      /401|invalid x-api-key/
    );
  });
});

describe('Gemini adapter', () => {
  // The Gemini SDK looks up undici's global dispatcher, which jest's sandbox hides.
  beforeAll(() => {
    const sym = Symbol.for('undici.globalDispatcher.1');

    if (!(globalThis as any)[sym]) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      (globalThis as any)[sym] = require('undici').getGlobalDispatcher();
    }
  });

  const geminiReply = (text: string) => ({
    body: {
      candidates: [
        {
          content: { role: 'model', parts: [{ text }] },
          finishReason: 'STOP',
          index: 0,
        },
      ],
      usageMetadata: {
        promptTokenCount: 13,
        candidatesTokenCount: 6,
        totalTokenCount: 19,
      },
      modelVersion: 'gemini-test-001',
    },
  });

  it('generateText: :generateContent with api key header and system instruction', async () => {
    reply = () => geminiReply('Hello');
    const p = new GeminiProvider({ apiKey: 'g-key', baseURL: base });
    const r = await p.generateText({
      model: 'gemini-test',
      system: 'Sys',
      prompt: 'Hi',
    });

    expect(r.text).toBe('Hello');
    expect(r.usage).toEqual({ inputTokens: 13, outputTokens: 6 });
    expect(seen[0].url).toContain('/models/gemini-test:generateContent');
    expect(seen[0].headers['x-goog-api-key']).toBe('g-key');
    expect(JSON.stringify(seen[0].body)).toContain('Sys');
    expect(JSON.stringify(seen[0].body)).toContain('Hi');
  });

  it('generateObject: requests application/json and validates', async () => {
    reply = () => geminiReply(json);
    const p = new GeminiProvider({ apiKey: 'k', baseURL: base });
    const r = await p.generateObject({ model: 'm', prompt: 'P', schema });

    expect(r.object).toEqual({ title: 'hello', n: 3 });
    expect(seen[0].body.generationConfig.responseMimeType).toBe(
      'application/json'
    );
    expect(seen[0].body.generationConfig.temperature).toBe(0);
  });

  it('embed: requests the configured dimensionality', async () => {
    reply = (r) =>
      r.url.includes('batchEmbed')
        ? { body: { embeddings: [{ values: vec(8) }, { values: vec(8) }] } }
        : { body: { embedding: { values: vec(8) } } };
    const p = new GeminiProvider({ apiKey: 'k', baseURL: base });
    const r = await p.embed({
      model: 'text-embedding-test',
      texts: ['a', 'b'],
      dimensions: 8,
    });

    expect(r.vectors).toHaveLength(2);
    expect(r.vectors[0]).toHaveLength(8);
    expect(JSON.stringify(seen[0].body)).toContain('"outputDimensionality":8');
  });

  it('rejects invalid output and surfaces API errors', async () => {
    const p = new GeminiProvider({ apiKey: 'k', baseURL: base });

    reply = () => geminiReply('plain text');
    await expect(
      p.generateObject({ model: 'm', prompt: 'P', schema })
    ).rejects.toBeInstanceOf(AIOutputError);

    reply = () => ({
      status: 403,
      body: {
        error: {
          code: 403,
          message: 'API key not valid',
          status: 'PERMISSION_DENIED',
        },
      },
    });
    await expect(p.generateText({ model: 'm', prompt: 'x' })).rejects.toThrow(
      /403|API key not valid/
    );
  });
});
