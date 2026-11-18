import dns from 'dns';
import { randomBytes } from 'crypto';
import env from './env';
import { ApiError } from './errors';
import { prisma, unguardedPrisma } from './prisma';

/** Normalises and validates a custom hostname (no URL, IP, port or reserved name). */
export function normalizeHostname(input: string) {
  let h = input.trim().toLowerCase();

  h = h
    .replace(/^[a-z]+:\/\//, '')
    .split('/')[0]
    .split('?')[0]
    .split('#')[0];

  if (h.includes('@')) h = h.split('@').pop() as string;
  if (/:\d+$/.test(h)) {
    throw new ApiError(422, 'Enter a domain name without a port.');
  }

  h = h.replace(/\.$/, '');

  const label = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;
  const parts = h.split('.');
  const appHost = (() => {
    try {
      return new URL(env.appUrl).hostname.toLowerCase();
    } catch {
      return '';
    }
  })();
  const base = env.customDomains.baseDomain;

  if (
    h.length < 4 ||
    h.length > 253 ||
    parts.length < 2 ||
    !parts.every((p) => label.test(p)) ||
    !/^([a-z]{2,63}|xn--[a-z0-9-]{1,59})$/.test(parts[parts.length - 1]) ||
    /^\d+(\.\d+){3}$/.test(h)
  ) {
    throw new ApiError(
      422,
      'Enter a valid domain name, for example careers.example.com.'
    );
  }

  if (
    [
      'local',
      'localhost',
      'internal',
      'invalid',
      'lan',
      'home',
      'corp',
    ].includes(parts[parts.length - 1]) ||
    h === appHost ||
    (!!base && (h === base || h.endsWith(`.${base}`)))
  ) {
    throw new ApiError(422, 'This domain cannot be used.');
  }

  return h;
}

export const newVerificationToken = () => randomBytes(16).toString('hex');

export const verificationRecords = (hostname: string, token: string) => ({
  cname: env.customDomains.cnameTarget
    ? { name: hostname, value: env.customDomains.cnameTarget }
    : null,
  txt: { name: `_verify.${hostname}`, value: `hc-verify=${token}` },
});

export type Resolver = {
  resolveTxt: (name: string) => Promise<string[][]>;
  resolveCname: (name: string) => Promise<string[]>;
  resolve4: (name: string) => Promise<string[]>;
};

let resolver: Resolver = dns.promises as unknown as Resolver;

/** Tests inject a fake DNS. */
export const setResolver = (r: Resolver | null) => {
  resolver = r ?? (dns.promises as unknown as Resolver);
};

const safe = async <T>(fn: () => Promise<T>, empty: T) => {
  try {
    return await fn();
  } catch {
    return empty;
  }
};

/**
 * Ownership is proven by the TXT record. When a CNAME target is configured the
 * hostname must also point at it (CNAME, or an A record equal to the target's).
 */
export async function checkDns(hostname: string, token: string) {
  const { txt, cname } = verificationRecords(hostname, token);
  const txtRows = await safe(
    () => resolver.resolveTxt(txt.name),
    [] as string[][]
  );
  const txtOk = txtRows.some((r) => r.join('') === txt.value);

  if (!txtOk) {
    return {
      ok: false,
      txtOk,
      cnameOk: false,
      error: `TXT record ${txt.name} = ${txt.value} was not found yet.`,
    };
  }

  if (!cname) {
    return { ok: true, txtOk, cnameOk: true, error: null };
  }

  const names = await safe(
    () => resolver.resolveCname(hostname),
    [] as string[]
  );
  let cnameOk = names.some(
    (n) => n.toLowerCase().replace(/\.$/, '') === cname.value
  );

  if (!cnameOk) {
    const [mine, target] = await Promise.all([
      safe(() => resolver.resolve4(hostname), [] as string[]),
      safe(() => resolver.resolve4(cname.value), [] as string[]),
    ]);

    cnameOk = mine.length > 0 && mine.some((ip) => target.includes(ip));
  }

  return {
    ok: cnameOk,
    txtOk,
    cnameOk,
    error: cnameOk ? null : `${hostname} does not point to ${cname.value} yet.`,
  };
}

/** The portal that owns a verified hostname (null if none or unverified). */
export async function resolveVerifiedHost(hostname: string) {
  const row = await unguardedPrisma.portalDomain.findFirst({
    where: { hostname: hostname.toLowerCase(), verifiedAt: { not: null } },
    select: { team: { select: { slug: true, status: true } } },
  });

  return row
    ? { slug: row.team.slug, suspended: row.team.status === 'SUSPENDED' }
    : null;
}

/**
 * Daily check that verified domains still point at us. Two failures in a row
 * release the hostname, so a domain that was dropped cannot block its next owner.
 */
export async function recheckDomains(now = new Date()) {
  const rows = await unguardedPrisma.portalDomain.findMany({
    where: { verifiedAt: { not: null } },
    take: 500,
  });
  let released = 0;

  for (const d of rows) {
    const r = await checkDns(d.hostname, d.verificationToken);

    if (r.ok) {
      await prisma.portalDomain.update({
        where: { id: d.id, teamId: d.teamId },
        data: { lastCheckedAt: now, lastError: null },
      });
    } else if (d.lastError) {
      await prisma.portalDomain.update({
        where: { id: d.id, teamId: d.teamId },
        data: {
          verifiedAt: null,
          certificateStatus: 'PENDING',
          lastCheckedAt: now,
          lastError: r.error,
        },
      });
      released++;
    } else {
      await prisma.portalDomain.update({
        where: { id: d.id, teamId: d.teamId },
        data: { lastCheckedAt: now, lastError: r.error },
      });
    }
  }

  return { checked: rows.length, released };
}
