import "server-only";
import nodemailer, { type Transporter } from "nodemailer";

/**
 * Transactional mail, via SES over SMTP.
 *
 * SMTP rather than the SES API because the cluster already has SES SMTP
 * credentials in 1Password and an established external-secrets pattern for
 * them (see prod/fancy-waitlist). Using the API instead would mean minting IAM
 * keys for no gain.
 *
 * NOTHING user-supplied may reach a header. Recipient, subject and from are
 * built from data the stitcher owns or from our own constants; a customer's
 * note and contact details go in the BODY only. Nodemailer before 10.x had
 * several CRLF header-injection advisories, which is why the version floor
 * matters as much as the discipline does.
 */

export interface MailAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
}

export interface OutgoingMail {
  to: string;
  subject: string;
  text: string;
  attachments?: MailAttachment[];
}

let transport: Transporter | null = null;

function config() {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.ORDER_FROM_EMAIL;
  if (!host || !user || !pass || !from) return null;
  return { host, user, pass, from, port: Number(process.env.SMTP_PORT ?? 587) };
}

/** Whether mail can be sent at all. Lets callers fail loudly and early. */
export function isMailEnabled(): boolean {
  return config() !== null;
}

function getTransport(): { t: Transporter; from: string } {
  const c = config();
  if (!c) {
    throw new Error(
      "Mail is not configured (SMTP_HOST, SMTP_USER, SMTP_PASS, ORDER_FROM_EMAIL)",
    );
  }
  if (!transport) {
    transport = nodemailer.createTransport({
      host: c.host,
      port: c.port,
      // STARTTLS on 587. requireTLS means a server that will not upgrade is a
      // failure rather than a silent downgrade to plaintext auth.
      secure: c.port === 465,
      requireTLS: c.port !== 465,
      auth: { user: c.user, pass: c.pass },
    });
  }
  return { t: transport, from: c.from };
}

/**
 * Send, and let failures propagate.
 *
 * Deliberately not swallowed: with no database row behind it, a silently
 * dropped send is an order that never existed, and the customer would be shown
 * a reference for something that never arrived. The caller is expected to turn
 * this into an error the customer can act on.
 */
export async function sendMail(mail: OutgoingMail): Promise<string> {
  const { t, from } = getTransport();
  const info = await t.sendMail({
    from,
    to: mail.to,
    subject: mail.subject,
    text: mail.text,
    attachments: mail.attachments,
  });
  return info.messageId;
}
