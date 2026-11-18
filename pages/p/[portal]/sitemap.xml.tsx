import env from '@/lib/env';
import type { GetServerSidePropsContext } from 'next';
import { getPublicPortal, listSitemapJobs } from 'models/publicPortal';

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// /p/[portal]/sitemap.xml
export async function getServerSideProps({
  params,
  res,
}: GetServerSidePropsContext) {
  const portal = await getPublicPortal(String(params?.portal ?? ''));

  if (!portal || portal.suspended) {
    return { notFound: true };
  }

  const base = `${env.appUrl}/p/${portal.team.slug}`;
  const jobs = await listSitemapJobs(portal.team.id);
  const urls = [
    { loc: base },
    { loc: `${base}/jobs` },
    { loc: `${base}/about` },
    { loc: `${base}/contact` },
    { loc: `${base}/privacy` },
    ...jobs.map((j) => ({
      loc: `${base}/jobs/${j.slug}`,
      lastmod: j.updatedAt.toISOString(),
    })),
  ];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    (u) =>
      `  <url><loc>${esc(u.loc)}</loc>${'lastmod' in u ? `<lastmod>${u.lastmod}</lastmod>` : ''}</url>`
  )
  .join('\n')}
</urlset>`;

  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader(
    'Cache-Control',
    'public, s-maxage=600, stale-while-revalidate=3600'
  );
  res.write(xml);
  res.end();

  return { props: {} };
}

const Sitemap = () => null;

export default Sitemap;
