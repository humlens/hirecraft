import { route } from '@/lib/apiRoute';
import { requireTenantContext } from '@/lib/tenant';
import { candidateIdSchema, noteSchema, validateWithSchema } from '@/lib/zod';
import { addNote } from 'models/talent';

export default route({
  POST: async (req, res) => {
    const ctx = await requireTenantContext(req, res, {
      permission: 'candidates.update',
    });
    const { candidateId } = validateWithSchema(candidateIdSchema, req.query);
    const { body } = validateWithSchema(noteSchema, req.body);
    const note = await addNote(ctx, candidateId, body);

    res.status(201).json({ data: { id: note.id } });
  },
});
