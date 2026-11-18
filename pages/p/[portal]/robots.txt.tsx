import env from '@/lib/env';
import type { GetServerSidePropsContext } from 'next';
import { getPublicPortal } from 'models/publicPortal';

// /p/[portal]/robots.txt
export async function getServerSideProps({
  params,
  res,
}: GetServerSidePropsContext) {
  const portal = await getPublicPortal(String(params?.portal ?? ''));

  if (!portal) {
    return { notFound: true };
  }

  const lines = portal.suspended
    ? ['User-agent: *', 'Disallow: /']
    : [
        'User-agent: *',
        'Allow: /',
        `Disallow: /p/${portal.team.slug}/apply/`,
        '',
        `Sitemap: ${env.appUrl}/p/${portal.team.slug}/sitemap.xml`,
      ];

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=600');
  res.write(lines.join('\n') + '\n');
  res.end();

  return { props: {} };
}

const Robots = () => null;

export default Robots;
