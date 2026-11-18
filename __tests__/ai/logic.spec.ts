/**
 * @jest-environment node
 */
import { decryptSecret, encryptSecret, keyHint } from '../../lib/ai/crypto';
import { hashEmbedding } from '../../lib/ai/providers/fake';
import { parseJsonLoose, jsonInstructions } from '../../lib/ai/json';
import {
  containsProtectedAttribute,
  redactForLog,
  scrubProtectedText,
} from '../../lib/ai/redact';
import { resetTokenBuckets, takeToken } from '../../lib/rateLimit';
import { anonymisedProfileText } from '../../lib/ai/embeddings';
import { assertSafeBaseUrl } from '../../models/ai/settings';
import { rrf } from '../../models/ai/search';
import {
  scoreMatch,
  textHasSkill,
  verifyEvidence,
  normSkill,
} from '../../models/ai/match';
import {
  experienceYears,
  parseResumeDate,
  planFields,
  localContact,
  resumeTextForModel,
} from '../../models/ai/resumeParse';
import { parsedResumeSchema } from '../../lib/ai/features';
import { z } from 'zod';

const d = (s: string) => new Date(`${s}T00:00:00Z`);

describe('secret encryption (AES-256-GCM)', () => {
  beforeAll(() => {
    process.env.AI_KEYS_ENCRYPTION_SECRET = 'unit-test-secret-0123456789';
  });

  it('round-trips and never stores plaintext', () => {
    const enc = encryptSecret('sk-live-abcdef123456');

    expect(enc.startsWith('v1:')).toBe(true);
    expect(enc).not.toContain('sk-live');
    expect(decryptSecret(enc)).toBe('sk-live-abcdef123456');
    expect(encryptSecret('sk-live-abcdef123456')).not.toBe(enc); // random IV
    expect(keyHint('sk-live-abcdef123456')).toBe('...3456');
  });

  it('detects tampering and a wrong secret', () => {
    const enc = encryptSecret('key-12345678');
    const parts = enc.split(':');
    const flipped = [
      ...parts.slice(0, 3),
      Buffer.from(
        'AAAA' + Buffer.from(parts[3], 'base64').toString('base64')
      ).toString('base64'),
    ].join(':');

    expect(() => decryptSecret(flipped)).toThrow();
    expect(() => decryptSecret('v2:a:b:c')).toThrow();
    process.env.AI_KEYS_ENCRYPTION_SECRET = 'a-different-secret-9876543210';
    expect(() => decryptSecret(enc)).toThrow();
    process.env.AI_KEYS_ENCRYPTION_SECRET = 'unit-test-secret-0123456789';
  });

  it('refuses to work without a configured secret', () => {
    const keep = process.env.AI_KEYS_ENCRYPTION_SECRET;

    delete process.env.AI_KEYS_ENCRYPTION_SECRET;
    expect(() => encryptSecret('x-12345678')).toThrow(
      /AI_KEYS_ENCRYPTION_SECRET/
    );
    process.env.AI_KEYS_ENCRYPTION_SECRET = keep;
  });
});

describe('protected attributes are stripped before text reaches a model', () => {
  const text = [
    'Senior engineer with 8 years of Node.js experience.',
    'He is a 34 years old married man living with his wife.',
    'Date of birth: 12 May 1990.',
    'She is a practising Hindu and attends the temple.',
    'Gender: Female. Photo attached.',
    'Candidate uses a wheelchair and has a disability certificate.',
    'Belongs to the Brahmin caste, Indian nationality.',
    'Led a team of 6 and shipped payments to production.',
  ].join('\n');

  it('removes every protected statement and keeps the professional content', () => {
    const out = scrubProtectedText(text);

    for (const forbidden of [
      /\b34\b/,
      /married/i,
      /wife/i,
      /birth/i,
      /hindu/i,
      /temple/i,
      /gender/i,
      /female/i,
      /photo/i,
      /wheelchair/i,
      /disabilit/i,
      /brahmin/i,
      /caste/i,
      /nationality/i,
      /\bman\b/i,
    ]) {
      expect(out).not.toMatch(forbidden);
    }

    expect(out).toContain('8 years of Node.js experience');
    expect(out).toContain('Led a team of 6');
  });

  it('neutralises gendered pronouns and titles', () => {
    const out = scrubProtectedText(
      'Mr. Rao built the API. He improved his team and she thanked him.'
    );

    expect(out).not.toMatch(/\b(he|she|his|her|him|mr)\b/i);
    expect(out).toContain('they');
  });

  it('handles empty input and detects attributes', () => {
    expect(scrubProtectedText(null)).toBe('');
    expect(scrubProtectedText('')).toBe('');
    expect(containsProtectedAttribute('Age: 41')).toBe(true);
    expect(containsProtectedAttribute('Built a payments platform')).toBe(false);
    expect(containsProtectedAttribute('Manager of 4 engineers')).toBe(false); // "man" inside a word is fine
  });

  it('the anonymised profile text has no name, contact data, institution or protected statements', () => {
    const t = anonymisedProfileText({
      headline: 'Backend engineer, 29 years old',
      summary: 'Loves distributed systems. Married with two kids.',
      location: 'Pune',
      skills: [{ skill: 'Node.js' }, { skill: 'PostgreSQL' }],
      experiences: [
        {
          title: 'Engineer',
          company: 'Acme',
          startDate: d('2018-01-01'),
          endDate: null,
          current: true,
          description: 'He built the billing service.',
        },
      ],
      educations: [{ degree: 'B.Tech', field: 'Computer Science' }],
      certifications: [{ name: 'AWS Developer' }],
    });

    expect(t).toContain('Node.js');
    expect(t).toContain('Pune');
    expect(t).toContain('billing service');
    expect(t).not.toMatch(/29|married|kids|\bhe\b/i);
    expect(t).not.toMatch(/@|\+?\d{8,}/);
  });

  it('redactForLog removes emails, phone numbers and URLs', () => {
    const out = redactForLog(
      'Mail a.b@corp.com or call +91 98765 43210 see https://x.io/p?q=1'
    );

    expect(out).toBe('Mail [email] or call [number] see [url]');
    expect(redactForLog('x'.repeat(100), 10)).toHaveLength(10);
  });

  it('resume text for the model has no email / phone / url and no protected lines', () => {
    const resume =
      'Priya Sharma\npriya@mail.com | +91 98765 43210 | https://linkedin.com/in/priya\nDOB: 01/01/1990\nSkills: Node.js, SQL';
    const out = resumeTextForModel(resume);

    expect(out).not.toMatch(/@|98765|linkedin|DOB/i);
    expect(out).toContain('Skills: Node.js, SQL');
    expect(localContact(resume)).toEqual({
      email: 'priya@mail.com',
      phone: '+91 98765 43210',
    });
  });
});

describe('JSON handling', () => {
  it('parses plain, fenced and noisy replies', () => {
    expect(parseJsonLoose('{"a":1}')).toEqual({ a: 1 });
    expect(parseJsonLoose('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(
      parseJsonLoose('Sure! Here you go: {"a":[1,2]} Hope it helps')
    ).toEqual({ a: [1, 2] });
    expect(() => parseJsonLoose('no json')).toThrow();
    expect(() => parseJsonLoose('{"a":')).toThrow();
  });

  it('describes the schema for the model', () => {
    const t = jsonInstructions(
      z.object({ title: z.string(), n: z.number().int() }),
      'thing'
    );

    expect(t).toContain('ONLY one JSON object');
    expect(t).toContain('"title"');
    expect(t).toContain('"integer"');
  });
});

describe('experience is computed from explicit dates only', () => {
  it('merges overlapping roles, counts gaps as gaps and treats current roles as ongoing', () => {
    const now = d('2026-01-01');
    const years = experienceYears(
      [
        { start: d('2018-01-01'), end: d('2020-01-01'), current: false },
        { start: d('2019-06-01'), end: d('2021-06-01'), current: false }, // overlaps: counted once
        { start: d('2023-01-01'), end: null, current: true }, // current -> until now (3y)
        { start: null, end: d('2010-01-01'), current: false }, // no start date: ignored
      ],
      now
    );

    expect(years).toBe(6.4); // 2018-01..2021-06 (41 months) + 2023-01..2026-01 (36 months)
  });

  it('ignores impossible intervals and returns 0 for nothing', () => {
    expect(experienceYears([])).toBe(0);
    expect(
      experienceYears([
        { start: d('2020-01-01'), end: d('2019-01-01'), current: false },
      ])
    ).toBe(0);
  });

  it('parses dates as written and rejects nonsense', () => {
    expect(parseResumeDate('2019-03')?.toISOString()).toBe(
      '2019-03-01T00:00:00.000Z'
    );
    expect(parseResumeDate('2019')?.toISOString()).toBe(
      '2019-01-01T00:00:00.000Z'
    );
    expect(parseResumeDate('2019', true)?.toISOString()).toBe(
      '2019-12-01T00:00:00.000Z'
    );
    expect(parseResumeDate('Mar 2019')?.getUTCFullYear()).toBe(2019);
    expect(parseResumeDate('1899')).toBeNull();
    expect(parseResumeDate('2019-13')).toBeNull();
    expect(parseResumeDate('present')).toBeNull();
    expect(parseResumeDate(null)).toBeNull();
    expect(parseResumeDate('2999')).toBeNull();
  });
});

describe('resume field planning (golden)', () => {
  const resumeText =
    'Experience\nAcme Corp, Senior Engineer, 2019-03 to present\nBeta Ltd, Engineer, 2016-01 to 2019-02\nSkills: Node.js, PostgreSQL, Docker';

  it('applies confident verifiable fields and holds the rest for the candidate to confirm', () => {
    const parsed = parsedResumeSchema.parse({
      headline: { value: 'Senior Backend Engineer', confidence: 0.95 },
      summary: { value: 'Maybe a leader?', confidence: 0.4 },
      skills: [
        { value: 'Node.js', confidence: 0.99 },
        { value: 'PostgreSQL', confidence: 0.9 },
        { value: 'Kubernetes', confidence: 0.5 },
      ],
      experiences: [
        {
          company: 'Acme Corp',
          title: 'Senior Engineer',
          startDate: '2019-03',
          current: true,
          confidence: 0.95,
        },
        {
          company: 'Beta Ltd',
          title: 'Engineer',
          startDate: '2016-01',
          endDate: '2019-02',
          current: false,
          confidence: 0.9,
        },
        {
          company: 'Ghost Inc',
          title: 'Intern',
          startDate: '2011-05',
          endDate: '2011-08',
          current: false,
          confidence: 0.95,
        }, // year not in the resume
        {
          company: 'Gamma',
          title: 'Consultant',
          current: false,
          confidence: 0.95,
        }, // no explicit start date
      ],
      educations: [{ institution: 'IIT', degree: 'B.Tech', confidence: 0.8 }],
    });
    const { apply, pending } = planFields(parsed, resumeText);

    expect(apply.headline).toBe('Senior Backend Engineer');
    expect(apply.summary).toBeNull();
    expect(apply.skills).toEqual(['Node.js', 'PostgreSQL']);
    expect(apply.experiences.map((e) => e.company)).toEqual([
      'Acme Corp',
      'Beta Ltd',
    ]);
    expect(apply.educations).toHaveLength(1);

    expect(pending.map((p) => p.field).sort()).toEqual([
      'experience',
      'experience',
      'skill',
      'summary',
    ]);
    const ghost = pending.find((p) => (p.value as any).company === 'Ghost Inc');

    expect(ghost?.note).toMatch(/not found in the resume/i);
    expect(ghost?.confidence).toBeLessThanOrEqual(0.5);
    expect(
      pending.find((p) => (p.value as any).company === 'Gamma')?.note
    ).toMatch(/No explicit start date/);
  });

  it('a number the model volunteers cannot become the experience figure', () => {
    // the schema has no total-experience field at all; extra keys are dropped
    const parsed = parsedResumeSchema.parse({
      skills: [],
      totalExperienceYears: 25,
      experiences: [
        {
          company: 'A',
          title: 'B',
          startDate: '2024-01',
          endDate: '2024-07',
          current: false,
          confidence: 0.9,
          yearsOfExperience: 40,
        },
      ],
    });

    expect((parsed as any).totalExperienceYears).toBeUndefined();
    expect((parsed.experiences[0] as any).yearsOfExperience).toBeUndefined();
    expect(
      experienceYears(
        parsed.experiences.map((e) => ({
          start: parseResumeDate(e.startDate),
          end: parseResumeDate(e.endDate, true),
          current: e.current,
        })),
        d('2026-01-01')
      )
    ).toBeCloseTo(0.5, 1);
  });
});

describe('match scoring (golden)', () => {
  const job = {
    experienceMin: 4,
    experienceMax: 8,
    workMode: 'ONSITE',
    education: 'Bachelor of Engineering',
    locations: [{ city: 'Pune', region: 'Maharashtra', country: 'India' }],
  };
  const base = {
    required: ['Node.js', 'PostgreSQL', 'AWS'],
    optional: ['Kubernetes', 'Redis'],
    job,
  };

  it('strong candidate -> 96', () => {
    const r = scoreMatch({
      ...base,
      candidateSkills: ['Node', 'PostgreSQL', 'AWS', 'Kubernetes'],
      candidateText: 'Built APIs',
      years: 6,
      depth: 80,
      candidate: {
        location: 'Pune',
        preferredLocations: [],
        educations: [
          { degree: 'Bachelor of Engineering', field: 'Computer Science' },
        ],
        certifications: [{ name: 'AWS Certified Developer' }],
      },
    });

    expect(r.score).toBe(96);
    expect(r.missingRequired).toEqual([]);
    expect(r.matchedOptional).toEqual(['Kubernetes']);
    expect(
      Object.fromEntries(r.components.map((c) => [c.key, c.score]))
    ).toEqual({
      skills: 100,
      depth: 80,
      years: 100,
      location: 100,
      education: 100,
      certifications: 100,
    });
  });

  it('partial candidate -> 57 with the missing skill listed and certifications left out', () => {
    const r = scoreMatch({
      ...base,
      candidateSkills: ['Node.js', 'PostgreSQL'],
      candidateText: 'Backend work',
      years: 2,
      depth: 60,
      candidate: {
        location: 'Mumbai',
        preferredLocations: [],
        educations: [{ degree: 'Diploma', field: 'IT' }],
        certifications: [],
      },
    });

    expect(r.score).toBe(57);
    expect(r.missingRequired).toEqual(['AWS']);
    expect(r.components.find((c) => c.key === 'certifications')).toMatchObject({
      applicable: false,
      score: null,
    });
    expect(r.components.find((c) => c.key === 'years')?.score).toBe(50);
    expect(r.components.find((c) => c.key === 'location')?.score).toBe(40);
    expect(r.components.find((c) => c.key === 'education')?.score).toBe(30);
  });

  it('weights are renormalised over the applicable components (remote, no experience / education rules, no depth)', () => {
    const r = scoreMatch({
      required: ['Go', 'Kubernetes'],
      optional: [],
      candidateSkills: ['golang', 'k8s'],
      candidateText: '',
      years: 1,
      depth: null,
      job: {
        experienceMin: null,
        experienceMax: null,
        workMode: 'REMOTE',
        education: null,
        locations: [],
      },
      candidate: {
        location: null,
        preferredLocations: [],
        educations: [],
        certifications: [],
      },
    });

    expect(r.score).toBe(100); // (0.4*100 + 0.1*100) / 0.5
    expect(
      r.components
        .filter((c) => c.applicable)
        .map((c) => c.key)
        .sort()
    ).toEqual(['location', 'skills']);
  });

  it('an empty candidate scores low but never throws', () => {
    const r = scoreMatch({
      ...base,
      candidateSkills: [],
      candidateText: '',
      years: 0,
      depth: 10,
      candidate: {
        location: null,
        preferredLocations: [],
        educations: [],
        certifications: [],
      },
    });

    expect(r.score).toBeLessThan(30);
    expect(r.matchedRequired).toEqual([]);
  });

  it('matches skills as whole words and through aliases ("aws" is not in "laws")', () => {
    expect(textHasSkill('Experienced with AWS Lambda', 'AWS')).toBe(true);
    expect(textHasSkill('Studied employment laws', 'AWS')).toBe(false);
    expect(textHasSkill('Wrote services in NodeJS', 'Node.js')).toBe(true);
    expect(textHasSkill('Used k8s daily', 'Kubernetes')).toBe(true);
    expect(textHasSkill('Google Cloud', 'Go')).toBe(false);
    expect(textHasSkill('Built it in C++ and C#', 'C++')).toBe(true);
    expect(normSkill('Node.js')).toBe(normSkill('nodejs'));
  });

  it('keeps only evidence quotes that really occur in the candidate text', () => {
    const text =
      'Led the migration of the billing   service to PostgreSQL\nand cut p99 latency by 40%.';
    const r = verifyEvidence(
      [
        {
          claim: 'migration',
          quote: 'Led the migration of the billing service to PostgreSQL',
        }, // whitespace differences are fine
        { claim: 'latency', quote: 'cut p99 latency by 40%' },
        { claim: 'invented', quote: 'Won the national hackathon in 2019' },
        { claim: 'too short', quote: 'Led' },
      ],
      text
    );

    expect(r.kept.map((e) => e.claim)).toEqual(['migration', 'latency']);
    expect(r.dropped).toBe(2);
  });
});

describe('reciprocal rank fusion', () => {
  it('ranks items that appear high in several lists first', () => {
    const s = rrf([
      ['a', 'b', 'c'],
      ['b', 'a', 'd'],
      ['b', 'e'],
    ]);
    const order = Array.from(s.entries())
      .sort((x, y) => y[1] - x[1])
      .map(([id]) => id);

    expect(order[0]).toBe('b');
    expect(order.slice(0, 2)).toEqual(['b', 'a']);
    expect(s.get('b')!).toBeGreaterThan(s.get('c')!);
    expect(rrf([]).size).toBe(0);
  });
});

describe('fake embeddings', () => {
  const cos = (a: number[], b: number[]) =>
    a.reduce((s, x, i) => s + x * b[i], 0);

  it('are 1536-dimensional, normalised and similar for similar texts', () => {
    const a = hashEmbedding('senior node.js backend engineer postgresql aws');
    const b = hashEmbedding('backend engineer node.js postgresql');
    const c = hashEmbedding('pastry chef croissant bakery');

    expect(a).toHaveLength(1536);
    expect(Math.round(cos(a, a) * 1000) / 1000).toBe(1);
    expect(cos(a, b)).toBeGreaterThan(cos(a, c));
    expect(hashEmbedding('same')).toEqual(hashEmbedding('same'));
  });
});

describe('token bucket (in memory)', () => {
  beforeEach(() => resetTokenBuckets());

  it('allows a burst of N then refuses, and refills over time', async () => {
    const t0 = 1_000_000;
    const results: boolean[] = [];

    for (let i = 0; i < 6; i++) results.push(await takeToken('k', 5, t0));

    expect(results).toEqual([true, true, true, true, true, false]);
    expect(await takeToken('k', 5, t0 + 12_000)).toBe(true); // 5/min = 1 token per 12 s
    expect(await takeToken('k', 5, t0 + 12_000)).toBe(false);
    expect(await takeToken('other', 5, t0)).toBe(true); // separate bucket
  });
});

describe('base URL safety (SSRF)', () => {
  const keep = process.env.AI_ALLOW_PRIVATE_BASE_URLS;

  beforeEach(() => {
    delete process.env.AI_ALLOW_PRIVATE_BASE_URLS;
  });
  afterAll(() => {
    process.env.AI_ALLOW_PRIVATE_BASE_URLS = keep;
  });

  it.each([
    ['not a url'],
    ['http://api.example.com/v1'],
    ['https://user:pw@api.example.com/v1'],
    ['https://127.0.0.1/v1'],
    ['https://10.0.0.5/v1'],
    ['https://192.168.1.10/v1'],
    ['https://172.16.0.1/v1'],
    ['https://169.254.169.254/latest/meta-data'],
    ['https://100.64.0.1/v1'],
    ['https://[::1]/v1'],
    ['https://[fd00::1]/v1'],
    ['https://[::ffff:10.0.0.1]/v1'],
    ['https://localhost/v1'],
  ])('rejects %s', async (url) => {
    await expect(assertSafeBaseUrl(url)).rejects.toMatchObject({ status: 422 });
  });

  it('accepts a public https address and honours the dev override', async () => {
    await expect(
      assertSafeBaseUrl('https://93.184.216.34/v1')
    ).resolves.toBeUndefined();
    process.env.AI_ALLOW_PRIVATE_BASE_URLS = 'true';
    await expect(
      assertSafeBaseUrl('http://127.0.0.1:9999/v1')
    ).resolves.toBeUndefined();
  });
});
