import env from './env';
import { ApiError } from './errors';
import { sendEmail } from './email/sendEmail';
import { textToHtml } from './notifications';

export const emailConfigured = () => !!env.smtp.host;

/** Sends a plain-text message as escaped HTML. Throws ApiError(503/502). */
export async function deliverEmail(args: {
  to: string;
  subject: string;
  body: string;
}) {
  if (!emailConfigured()) {
    throw new ApiError(
      503,
      'Email is not configured on this server (set SMTP_HOST).'
    );
  }

  try {
    await sendEmail({
      to: args.to,
      subject: args.subject,
      html: textToHtml(args.body),
      text: args.body,
    });
  } catch (error: any) {
    throw new ApiError(
      502,
      `The email could not be sent: ${error?.message ?? 'unknown error'}`
    );
  }
}
