import { route } from '@/lib/apiRoute';
import { requireTenantContext } from '@/lib/tenant';
import {
  messageActionSchema,
  messageIdSchema,
  validateWithSchema,
} from '@/lib/zod';
import { approveDraft, discardDraft, sendDraft } from 'models/message';
import { sendAudit } from '@/lib/retraced';

// approve -> send are separate steps: only an APPROVED message can be sent.
export default route({
  POST: async (req, res) => {
    const ctx = await requireTenantContext(req, res, {
      permission: 'messages.send',
    });
    const { messageId } = validateWithSchema(messageIdSchema, req.query);
    const { action } = validateWithSchema(messageActionSchema, req.body);

    const data =
      action === 'approve'
        ? await approveDraft(ctx, messageId)
        : action === 'discard'
          ? await discardDraft(ctx, messageId)
          : await sendDraft(ctx, messageId);

    sendAudit({
      action: (action === 'send'
        ? 'message.send'
        : action === 'approve'
          ? 'message.approve'
          : 'message.discard') as never,
      crud: 'u',
      user: ctx.user as never,
      team: ctx.team,
    });

    res.status(200).json({ data });
  },
});
