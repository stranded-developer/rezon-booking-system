import type { Db } from "@raceground/db";

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
