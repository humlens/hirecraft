import { route } from '@/lib/apiRoute';
import { resolveVerifiedHost } from '@/lib/domains';

// Which portal serves this host? Used by middleware.ts for custom domains, and as
// the "ask" endpoint of an on-demand TLS proxy (Caddy): 200 only for verified hosts.
// Public on purpose: verified domains are public and only the slug is returned.
export default route({
  GET: async (req, res) => {
    const host = String(req.query.host ?? req.query.domain ?? '')
      .toLowerCase()
      .slice(0, 253);
    const hit = host ? await resolveVerifiedHost(host) : null;

    res.setHeader('Cache-Control', 'public, max-age=30');

    if (!hit) {
      res.status(404).json({ error: { message: 'Unknown domain.' } });

      return;
    }

    res.status(200).json({ data: { slug: hit.slug } });
  },
});
