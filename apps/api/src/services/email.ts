import type { Db } from "@raceground/db";
import type { Env } from "../env.js";

export type EmailTemplate =
  | "membership_welcome"
  | "membership_payment_failed"
  | "membership_ended"
  | "membership_price_change"
  | "booking_confirmed"
  | "booking_cancelled"
  | "booking_payment_refunded"
  | "booking_reminder";

export interface EmailAttachment {
  filename: string;
  contentType: string;
  content: string;
}

export interface EmailMessage {
  template: EmailTemplate;
  to: string;
  subject: string;
  text: string;
  /** For the email log and de-duplication, e.g. ("members", memberId + ":" + invoiceId). */
  entity: string;
  entityId: string;
  attachments?: EmailAttachment[];
}

export interface EmailSender {
  send(message: EmailMessage): Promise<{ sent: boolean; duplicate: boolean }>;
  /** Messages sent in this process (console transport); handy for tests. */
  outbox: EmailMessage[];
}

/**
 * Development transport: records every email in email_log (at most once per template + entity)
 * and prints it. A Resend transport replaces the print when the owner sets up email.
 */
export function createConsoleEmail(db: Db, from: string, log: (line: string) => void = console.log): EmailSender {
  const outbox: EmailMessage[] = [];
  return {
    outbox,
    async send(message) {
      const { error } = await db.from("email_log").insert({
        to_address: message.to,
        template: message.template,
        entity: message.entity,
        entity_id: message.entityId,
        status: "sent",
        provider_id: "console",
      });
      if (error) {
        if (error.code === "23505") return { sent: false, duplicate: true };
        throw new Error(`email_log insert failed: ${error.message}`);
      }
      outbox.push(message);
      log(`\n── email (${message.template}) ──\nFrom: ${from}\nTo: ${message.to}\nSubject: ${message.subject}\n\n${message.text}${(message.attachments ?? []).map((a) => `\n[attachment: ${a.filename}, ${a.contentType}]`).join("")}\n──────────────`);
      return { sent: true, duplicate: false };
    },
  };
}

const RESEND_URL = "https://api.resend.com/emails";
const SEND_TIMEOUT_MS = 10_000;

/**
 * Sends through Resend, and records every attempt in email_log.
 *
 * The log row is written first, so the same message is never sent twice (the unique index covers
 * template + entity). A failed attempt is marked "failed", which the index ignores, so a retry is
 * still possible later.
 *
 * Sending never throws: an email is not worth failing a payment, a refund or a cancellation over.
 * Failures are recorded and logged instead.
 */
export function createResendEmail(db: Db, from: string, apiKey: string, fetchImpl: typeof fetch = fetch): EmailSender {
  const outbox: EmailMessage[] = [];
  return {
    outbox,
    async send(message) {
      const { data: row, error } = await db
        .from("email_log")
        .insert({
          to_address: message.to,
          template: message.template,
          entity: message.entity,
          entity_id: message.entityId,
          status: "queued",
        })
        .select("id")
        .single();
      if (error) {
        if (error.code === "23505") return { sent: false, duplicate: true };
        throw new Error(`email_log insert failed: ${error.message}`);
      }

      try {
        const res = await fetchImpl(RESEND_URL, {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from,
            to: [message.to],
            subject: message.subject,
            text: message.text,
            ...(message.attachments?.length
              ? {
                  attachments: message.attachments.map((a) => ({
                    filename: a.filename,
                    content: Buffer.from(a.content, "utf8").toString("base64"),
                    content_type: a.contentType,
                  })),
                }
              : {}),
          }),
          signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
        });
        const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string; name?: string };
        if (!res.ok || !body.id) {
          throw new Error(body.message ?? `Resend answered ${res.status}`);
        }
        await db.from("email_log").update({ status: "sent", provider_id: body.id }).eq("id", row.id);
        outbox.push(message);
        return { sent: true, duplicate: false };
      } catch (err) {
        const reason = err instanceof Error ? err.message : "Unknown error";
        console.error(`Email not sent (${message.template} to ${message.to}): ${reason}`);
        await db.from("email_log").update({ status: "failed", error: reason.slice(0, 500) }).eq("id", row.id);
        return { sent: false, duplicate: false };
      }
    },
  };
}

/** The transport the settings ask for. */
export function createEmailSender(db: Db, env: Env, fetchImpl: typeof fetch = fetch): EmailSender {
  return env.EMAIL_TRANSPORT === "resend"
    ? createResendEmail(db, env.EMAIL_FROM, env.RESEND_API_KEY!, fetchImpl)
    : createConsoleEmail(db, env.EMAIL_FROM);
}
