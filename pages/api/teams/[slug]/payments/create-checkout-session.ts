import { NextApiRequest, NextApiResponse } from 'next';

import { getSession } from '@/lib/session';
import { throwIfNoTeamAccess } from 'models/team';
import { stripe, getStripeCustomerId } from '@/lib/stripe';
import env from '@/lib/env';
import { ApiError } from '@/lib/errors';
import { prisma } from '@/lib/prisma';
import {
  checkDowngrade,
  getPlanState,
  LIMIT_LABELS,
  PLAN_LABELS,
  PLANS,
} from '@/lib/entitlements';
import { planOfPrice } from 'models/billingPlan';
import { checkoutSessionSchema, validateWithSchema } from '@/lib/zod';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  try {
    switch (req.method) {
      case 'POST':
        await handlePOST(req, res);
        break;
      default:
        res.setHeader('Allow', 'POST');
        res.status(405).json({
          error: { message: `Method ${req.method} Not Allowed` },
        });
    }
  } catch (error: any) {
    const message = error.message || 'Something went wrong';
    const status = error.status || 500;

    res.status(status).json({ error: { message, ...(error.details ?? {}) } });
  }
}

const handlePOST = async (req: NextApiRequest, res: NextApiResponse) => {
  const { price, quantity } = validateWithSchema(
    checkoutSessionSchema,
    req.body
  );

  const teamMember = await throwIfNoTeamAccess(req, res);

  // a plan below the current one is refused while usage exceeds its limits
  const target = await prisma.price.findUnique({ where: { id: price } });
  const targetPlan = planOfPrice(target?.metadata);

  if (targetPlan) {
    const current = await getPlanState(teamMember.teamId);

    if (PLANS.indexOf(targetPlan) < PLANS.indexOf(current.plan)) {
      const check = await checkDowngrade(teamMember.teamId, targetPlan);

      if (!check.allowed) {
        throw new ApiError(
          409,
          `You cannot move to ${PLAN_LABELS[targetPlan]} yet: ${check.blockers
            .map(
              (b) =>
                `${b.used} ${LIMIT_LABELS[b.limit]} in use, ${b.allowed} allowed`
            )
            .join('; ')}. Close or remove some first.`,
          { code: 'downgrade_blocked', blockers: check.blockers }
        );
      }
    }
  }

  const session = await getSession(req, res);
  const customer = await getStripeCustomerId(teamMember, session);

  const checkoutSession = await stripe.checkout.sessions.create({
    customer,
    mode: 'subscription',
    line_items: [
      {
        price,
        quantity,
      },
    ],

    // {CHECKOUT_SESSION_ID} is a string literal; do not change it!
    // the actual Session ID is returned in the query parameter when your customer
    // is redirected to the success page.

    success_url: `${env.appUrl}/teams/${teamMember.team.slug}/billing`,
    cancel_url: `${env.appUrl}/teams/${teamMember.team.slug}/billing`,
  });

  res.json({ data: checkoutSession });
};
