import { route } from '@/lib/apiRoute';
import { requireTenantContext } from '@/lib/tenant';
import {
  messageIdSchema,
  updateMessageSchema,
  validateWithSchema,
} from '@/lib/zod';
import { updateDraft } from 'models/message';

export default route({
  PUT: async (req, res) => {
    const ctx = await requireTenantContext(req, res, {
      permission: 'messages.send',
    });
    const { messageId } = validateWithSchema(messageIdSchema, req.query);
    const input = validateWithSchema(updateMessageSchema, req.body);

    res.status(200).json({ data: await updateDraft(ctx, messageId, input) });
  },
});
