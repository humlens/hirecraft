import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl as presign } from '@aws-sdk/s3-request-presigner';
import { createHmac, timingSafeEqual } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import env from './env';

/**
 * Object storage behind one interface.
 *
 * Keys must start with `tenants/{teamId}/` or `candidates/{userId}/`.
 * Objects are private; they are only ever served through short-lived signed
 * URLs, after the caller has passed a permission check.
 *
 * Drivers: S3-compatible (S3_BUCKET set) or local disk (dev/test).
 */

const KEY_PATTERN = /^(tenants|candidates)\/[A-Za-z0-9-]+\/[A-Za-z0-9._/-]+$/;

export const DEFAULT_URL_TTL_SECONDS = 60;

export const assertValidKey = (key: string) => {
  if (!KEY_PATTERN.test(key) || key.includes('..')) {
    throw new Error(`Invalid storage key: ${key}`);
  }
};

let s3: S3Client | undefined;

const s3Enabled = () => !!env.storage.s3.bucket;

const getS3 = () => {
  if (!s3) {
    const c = env.storage.s3;

    s3 = new S3Client({
      region: c.region,
      endpoint: c.endpoint,
      forcePathStyle: c.forcePathStyle,
      credentials: {
        accessKeyId: c.accessKeyId,
        secretAccessKey: c.secretAccessKey,
      },
    });
  }

  return s3;
};

const localPath = (key: string) => {
  const root = path.resolve(env.storage.localDir);
  const full = path.resolve(root, key);

  if (!full.startsWith(root + path.sep)) {
    throw new Error('Invalid storage key');
  }

  return full;
};

const sign = (key: string, expires: number, disposition: string) =>
  createHmac('sha256', env.storage.signingSecret)
    .update(`${key}\n${expires}\n${disposition}`)
    .digest('hex');

export async function putObject(
  key: string,
  body: Buffer,
  contentType: string
) {
  assertValidKey(key);

  if (s3Enabled()) {
    await getS3().send(
      new PutObjectCommand({
        Bucket: env.storage.s3.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        ServerSideEncryption: undefined,
      })
    );

    return;
  }

  const file = localPath(key);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, body, { mode: 0o600 });
  await fs.writeFile(`${file}.meta`, JSON.stringify({ contentType }), {
    mode: 0o600,
  });
}

export async function deleteObject(key: string) {
  assertValidKey(key);

  if (s3Enabled()) {
    await getS3().send(
      new DeleteObjectCommand({ Bucket: env.storage.s3.bucket, Key: key })
    );

    return;
  }

  await fs.rm(localPath(key), { force: true });
  await fs.rm(`${localPath(key)}.meta`, { force: true });
}

/** Short-lived download URL. Local driver URLs are HMAC-signed. */
export async function getSignedUrl(
  key: string,
  opts: { ttlSeconds?: number; fileName?: string } = {}
) {
  assertValidKey(key);

  const ttl = opts.ttlSeconds ?? DEFAULT_URL_TTL_SECONDS;
  const disposition = `attachment; filename="${(opts.fileName ?? 'download')
    .replace(/[^\w.\- ]/g, '_')
    .slice(0, 120)}"`;

  if (s3Enabled()) {
    return presign(
      getS3(),
      new GetObjectCommand({
        Bucket: env.storage.s3.bucket,
        Key: key,
        ResponseContentDisposition: disposition,
      }),
      { expiresIn: ttl }
    );
  }

  const expires = Math.floor(Date.now() / 1000) + ttl;
  const q = new URLSearchParams({
    key,
    expires: String(expires),
    disposition,
    sig: sign(key, expires, disposition),
  });

  return `${env.appUrl}/api/storage/local?${q.toString()}`;
}

/** Local driver only: validates a signed URL and returns the file. */
export async function readLocalSigned(params: {
  key: string;
  expires: string;
  disposition: string;
  sig: string;
}) {
  const expires = Number(params.expires);

  if (!Number.isFinite(expires) || expires < Date.now() / 1000) {
    return { ok: false as const, status: 403, reason: 'expired' };
  }

  assertValidKey(params.key);

  const expected = Buffer.from(sign(params.key, expires, params.disposition));
  const given = Buffer.from(params.sig);

  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    return { ok: false as const, status: 403, reason: 'bad-signature' };
  }

  try {
    const file = localPath(params.key);
    const body = await fs.readFile(file);
    const meta = JSON.parse(await fs.readFile(`${file}.meta`, 'utf8'));

    return {
      ok: true as const,
      body,
      contentType: meta.contentType as string,
      disposition: params.disposition,
    };
  } catch {
    return { ok: false as const, status: 404, reason: 'not-found' };
  }
}
