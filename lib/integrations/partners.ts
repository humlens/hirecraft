import { createHmac } from 'crypto';
import { ApiError } from '../errors';
import type { Fetch } from './oauth';

/**
 * Provider interfaces for assessment and background-check partners. We never
 * assume an API we are not authorised to use: the generic adapter just sends a
 * signed JSON request to a URL the portal configured, and the partner's own
 * contract decides what happens next.
 */
export type PartnerRequest = {
  kind: 'assessment' | 'background_check';
  applicationId: string;
  candidate: { name: string; email: string };
  job: { title: string };
  /** background checks are only sent when the recruiter confirmed the candidate's consent */
  consentConfirmed: boolean;
};

export type PartnerResult = { externalId: string | null; status: 'REQUESTED' };

export interface PartnerProvider {
  request(input: PartnerRequest): Promise<PartnerResult>;
}

export const signBody = (secret: string, body: string) =>
  `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;

export const webhookPartner = (
  cfg: { url: string; secret: string },
  f: Fetch = fetch
): PartnerProvider => ({
  async request(input) {
    if (input.kind === 'background_check' && !input.consentConfirmed) {
      throw new ApiError(
        422,
        'Candidate consent must be confirmed before a background check is requested.'
      );
    }

    const body = JSON.stringify({
      type: input.kind,
      applicationId: input.applicationId,
      candidate: input.candidate,
      job: input.job,
      consentConfirmed: input.consentConfirmed,
      requestedAt: new Date().toISOString(),
    });
    const r = await f(cfg.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Hirecraft-Signature': signBody(cfg.secret, body),
      },
      body,
      redirect: 'error',
    });

    if (!r.ok) {
      throw new ApiError(
        502,
        `The partner rejected the request (${r.status}).`
      );
    }

    const j = (await r.json().catch(() => ({}))) as { id?: string };

    return { externalId: j.id ?? null, status: 'REQUESTED' };
  },
});
