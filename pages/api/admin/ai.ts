import { z } from 'zod';
import { route } from '@/lib/apiRoute';
import { PROVIDER_NAMES } from '@/lib/ai/config';
import { encryptSecret, keyHint } from '@/lib/ai/crypto';
import { assertSafeBaseUrl } from 'models/ai/settings';
import { logPlatformAction, requirePlatformAdmin } from '@/lib/platformAdmin';
import { prisma } from '@/lib/prisma';
import { validateWithSchema } from '@/lib/zod';

const putSchema = z.object({
  provider: z.enum(['OPENAI', 'ANTHROPIC', 'GEMINI', 'OPENAI_COMPATIBLE']),
  baseUrl: z.string().trim().url().max(300).optional().or(z.literal('')),
  apiKey: z.string().trim().min(8).max(300).optional(),
  clearKey: z.boolean().optional(),
  modelByTier: z.record(z.string(), z.string().max(100)).optional(),
});

const view = (
  row: Awaited<ReturnType<typeof prisma.aIProviderConfig.findFirst>>
) => ({
  configured: !!row,
  provider: row?.provider ?? null,
  baseUrl: row?.baseUrl ?? null,
  hasKey: !!row?.encryptedApiKey,
  keyHint: row?.keyHint ?? null,
  modelByTier: (row?.modelByTier ?? {}) as Record<string, string>,
  providers: PROVIDER_NAMES,
});

// The platform-wide default AI provider (the row with no portal). Keys are write-only.
export default route({
  GET: async (req, res) => {
    await requirePlatformAdmin(req, res);
    res.status(200).json({
      data: view(
        await prisma.aIProviderConfig.findFirst({ where: { teamId: null } })
      ),
    });
  },
  PUT: async (req, res) => {
    const admin = await requirePlatformAdmin(req, res);
    const input = validateWithSchema(putSchema, req.body);

    if (input.baseUrl) {
      await assertSafeBaseUrl(input.baseUrl);
    }

    const existing = await prisma.aIProviderConfig.findFirst({
      where: { teamId: null },
    });
    const key = input.apiKey
      ? {
          encryptedApiKey: encryptSecret(input.apiKey),
          keyHint: keyHint(input.apiKey),
        }
      : input.clearKey
        ? { encryptedApiKey: null, keyHint: null }
        : {};
    const data = {
      provider: input.provider,
      baseUrl: input.baseUrl || null,
      modelByTier: input.modelByTier ?? {},
      ...key,
    };
    const row = existing
      ? await prisma.aIProviderConfig.update({
          where: { id: existing.id },
          data,
        })
      : await prisma.aIProviderConfig.create({
          data: { teamId: null, ...data },
        });

    await logPlatformAction(admin, 'ai.default.update', null, {
      provider: input.provider,
      keyChanged: !!input.apiKey || !!input.clearKey,
    });
    res.status(200).json({ data: view(row) });
  },
});
