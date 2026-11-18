import { route } from '@/lib/apiRoute';
import { ApiError } from '@/lib/errors';
import { getPublicPortal } from 'models/publicPortal';

const colour = (c: string) => (/^#[0-9a-fA-F]{6}$/.test(c) ? c : '#3346D3');

// Per-portal web app manifest: installing a company's careers page gives the
// candidate an icon and a start page for that company.
export default route({
  GET: async (req, res) => {
    const slug = String(req.query.portal ?? '');
    const portal = await getPublicPortal(slug);

    if (!portal || portal.suspended) {
      throw new ApiError(404, 'Portal not found.');
    }

    const name = portal.profile?.companyName || portal.team.name;

    res.setHeader('Content-Type', 'application/manifest+json');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.status(200).send(
      JSON.stringify({
        name: `${name} Careers`,
        short_name: name.slice(0, 12),
        description: `Jobs at ${name}`,
        id: `/p/${portal.team.slug}`,
        start_url: `/p/${portal.team.slug}`,
        scope: `/p/${portal.team.slug}/`,
        display: 'standalone',
        background_color: '#F7F8FA',
        theme_color: colour(portal.branding.primaryColor),
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      })
    );
  },
});
