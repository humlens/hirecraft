import type { GetServerSidePropsContext } from 'next';
import { serverSideTranslations } from 'next-i18next/serverSideTranslations';
import env from '@/lib/env';
import { getPublicPortal, type PublicPortal } from 'models/publicPortal';

/** Dates -> strings so objects can cross the getServerSideProps boundary. */
export const serialize = <T>(value: T): T => JSON.parse(JSON.stringify(value));

export type PortalPageProps = {
  appUrl: string;
  portal: Pick<PublicPortal, 'suspended' | 'profile' | 'branding'> & {
    slug: string;
    name: string;
  };
};

/**
 * Shared getServerSideProps plumbing for public portal pages:
 * 404 for unknown portals, a 403 notice for suspended ones, translations.
 * `load` runs only for active portals and returns the page's own props.
 */
export async function getPortalProps<P extends object>(
  ctx: GetServerSidePropsContext,
  load?: (portal: PublicPortal) => Promise<P | 'notFound'>
) {
  const portal = await getPublicPortal(String(ctx.params?.portal ?? ''));

  if (!portal) {
    return { notFound: true as const };
  }

  let extra: P | Record<string, never> = {};

  if (portal.suspended) {
    ctx.res.statusCode = 403;
  } else if (load) {
    const result = await load(portal);

    if (result === 'notFound') {
      return { notFound: true as const };
    }

    extra = result;
  }

  return {
    props: serialize({
      ...(ctx.locale
        ? await serverSideTranslations(ctx.locale, ['common'])
        : {}),
      appUrl: env.appUrl,
      portal: {
        slug: portal.team.slug,
        name: portal.profile?.companyName ?? portal.team.name,
        suspended: portal.suspended,
        profile: portal.suspended ? null : portal.profile,
        branding: portal.branding,
      },
      ...extra,
    }),
  };
}
