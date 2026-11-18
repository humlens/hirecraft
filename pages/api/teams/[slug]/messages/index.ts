import { route, queryWithout } from '@/lib/apiRoute';
import { requireTenantContext } from '@/lib/tenant';
import {
  createMessageSchema,
  listMessagesSchema,
  validateWithSchema,
} from '@/lib/zod';
import { createDraft, listDrafts } from 'models/message';

export default route({
  GET: async (req, res) => {
    const ctx = await requireTenantContext(req, res, {
      permission: 'messages.send',
    });
    const f = validateWithSchema(listMessagesSchema, queryWithout(req, 'slug'));

    res.status(200).json({ data: await listDrafts(ctx, f) });
  },
  POST: async (req, res) => {
    const ctx = await requireTenantContext(req, res, {
      permission: 'messages.send',
    });
    const input = validateWithSchema(createMessageSchema, req.body);

    res.status(201).json({ data: await createDraft(ctx, input) });
  },
});
