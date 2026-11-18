import type { NextApiRequest, NextApiResponse } from 'next';
import { sendVerificationEmail } from '@/lib/email/sendVerificationEmail';
import env from '@/lib/env';
import { clientIp, enforceRateLimit } from '@/lib/rateLimit';
import { validateRecaptcha } from '@/lib/recaptcha';
import { candidateRegisterSchema, validateWithSchema } from '@/lib/zod';
import { handleError, methodNotAllowed } from '@/lib/candidateAuth';
import { registerCandidate } from 'models/candidate';
import { createVerificationToken } from 'models/verificationToken';
import { recordMetric } from '@/lib/metrics';

// Job seeker sign-up. Unlike team sign-up, any email is accepted and no team
// is created.
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  try {
    if (req.method !== 'POST') {
      return methodNotAllowed(req, res, 'POST');
    }

    enforceRateLimit(`register:${clientIp(req)}`, 10, 60 * 60);

    await validateRecaptcha(req.body?.recaptchaToken);

    const input = validateWithSchema(candidateRegisterSchema, req.body);
    const user = await registerCandidate(input);

    if (env.confirmEmail && !user.emailVerified) {
      const verificationToken = await createVerificationToken({
        identifier: user.email,
        expires: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });

      await sendVerificationEmail({ user, verificationToken });
    }

    recordMetric('candidate.registered');

    res.status(201).json({
      data: { confirmEmail: env.confirmEmail && !user.emailVerified },
    });
  } catch (error) {
    handleError(res, error);
  }
}
