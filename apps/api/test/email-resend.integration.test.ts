/**
 * The Resend transport: what it sends, what it records, and what happens when sending fails.
 * Resend itself is stubbed — the point is our behaviour around it, against the real email_log.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createEmailSender, createResendEmail, type EmailMessage } from "../src/services/email.js";
import { loadEnv } from "../src/env.js";
import { cleanupTestData, testContext, type TestContext } from "./helpers.js";

let ctx: TestContext;
const run = randomUUID().slice(0, 8);
const entityIds: string[] = [];

/** A message with its own entity id, so each test is independent of the others. */
function message(overrides: Partial<EmailMessage> = {}): EmailMessage {
  const entityId = `resend-${run}-${entityIds.length}`;
  entityIds.push(entityId);
  return {
    template: "booking_confirmed",
    to: "guest@raceground.test",
    subject: "Raceground booking ABC234 confirmed",
    text: "Hi there,\n\nYour booking is confirmed.",
    entity: "bookings",
    entityId,
    ...overrides,
  };
}

/** A stub of Resend that records what it was asked to send. */
function stubResend(reply: { status?: number; body?: unknown } = {}) {
  const calls: { url: string; body: any; headers: Record<string, string> }[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      body: JSON.parse(String(init?.body ?? "{}")),
      headers: init?.headers as Record<string, string>,
    });
    return new Response(JSON.stringify(reply.body ?? { id: `resend-id-${calls.length}` }), {
      status: reply.status ?? 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

const logRow = async (entityId: string) =>
  (await ctx.db.from("email_log").select("status, provider_id, error, to_address, template").eq("entity_id", entityId).maybeSingle()).data;

beforeAll(() => {
  ctx = testContext();
});

afterAll(async () => {
  if (entityIds.length) await ctx.db.from("email_log").delete().in("entity_id", entityIds);
  await cleanupTestData(ctx);
});

describe("sending through Resend", () => {
  it("sends the message and records the provider's id", async () => {
    const stub = stubResend();
    const email = createResendEmail(ctx.db, "Raceground <bookings@raceground.test>", "re_test_key", stub.fetchImpl);
    const msg = message();

    expect(await email.send(msg)).toEqual({ sent: true, duplicate: false });

    expect(stub.calls).toHaveLength(1);
    expect(stub.calls[0]!.url).toBe("https://api.resend.com/emails");
    expect(stub.calls[0]!.headers.Authorization).toBe("Bearer re_test_key");
    expect(stub.calls[0]!.body).toMatchObject({
      from: "Raceground <bookings@raceground.test>",
      to: ["guest@raceground.test"],
      subject: "Raceground booking ABC234 confirmed",
      text: msg.text,
    });
    expect(await logRow(msg.entityId)).toMatchObject({ status: "sent", provider_id: "resend-id-1", template: "booking_confirmed" });
  });

  it("sends a calendar invite as a base64 attachment", async () => {
    const stub = stubResend();
    const email = createResendEmail(ctx.db, "Raceground <bookings@raceground.test>", "re_test_key", stub.fetchImpl);
    const ics = "BEGIN:VCALENDAR\r\nEND:VCALENDAR";

    await email.send(message({ attachments: [{ filename: "raceground-ABC234.ics", contentType: "text/calendar; charset=utf-8", content: ics }] }));

    const [attachment] = stub.calls[0]!.body.attachments;
    expect(attachment.filename).toBe("raceground-ABC234.ics");
    expect(attachment.content_type).toContain("text/calendar");
    expect(Buffer.from(attachment.content, "base64").toString("utf8")).toBe(ics);
  });

  it("never sends the same message twice", async () => {
    const stub = stubResend();
    const email = createResendEmail(ctx.db, "from@raceground.test", "re_test_key", stub.fetchImpl);
    const msg = message();

    expect(await email.send(msg)).toEqual({ sent: true, duplicate: false });
    expect(await email.send(msg)).toEqual({ sent: false, duplicate: true });
    expect(stub.calls).toHaveLength(1);
  });

  it("records a failure and still allows a later retry, without throwing", async () => {
    const failing = stubResend({ status: 422, body: { message: "The sending domain is not verified" } });
    const email = createResendEmail(ctx.db, "from@raceground.test", "re_test_key", failing.fetchImpl);
    const msg = message();

    // A refund or a confirmed booking must not fail because an email did.
    expect(await email.send(msg)).toEqual({ sent: false, duplicate: false });
    expect(await logRow(msg.entityId)).toMatchObject({ status: "failed", error: "The sending domain is not verified" });

    // The unique index ignores failed rows, so the same message can be sent again later.
    const working = stubResend();
    const retry = createResendEmail(ctx.db, "from@raceground.test", "re_test_key", working.fetchImpl);
    expect(await retry.send(msg)).toEqual({ sent: true, duplicate: false });
    expect(working.calls).toHaveLength(1);
  });

  it("treats an answer without an id as a failure", async () => {
    const stub = stubResend({ status: 200, body: { note: "no id here" } });
    const email = createResendEmail(ctx.db, "from@raceground.test", "re_test_key", stub.fetchImpl);
    const msg = message();

    expect(await email.send(msg)).toEqual({ sent: false, duplicate: false });
    expect(await logRow(msg.entityId)).toMatchObject({ status: "failed" });
  });
});

describe("choosing the transport", () => {
  const base = {
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "s".repeat(40),
    OPERATOR_TOKEN_SECRET: "o".repeat(40),
    QR_TOKEN_SECRET: "q".repeat(40),
  };

  it("uses the console by default", async () => {
    const email = createEmailSender(ctx.db, loadEnv(base));
    const msg = message();
    await email.send(msg);
    expect(await logRow(msg.entityId)).toMatchObject({ status: "sent", provider_id: "console" });
  });

  it("sends through Resend when the settings say so", async () => {
    const stub = stubResend();
    const email = createEmailSender(ctx.db, loadEnv({ ...base, EMAIL_TRANSPORT: "resend", RESEND_API_KEY: "re_chosen_key" }), stub.fetchImpl);
    const msg = message();

    await email.send(msg);
    expect(stub.calls).toHaveLength(1);
    expect(stub.calls[0]!.headers.Authorization).toBe("Bearer re_chosen_key");
    expect(await logRow(msg.entityId)).toMatchObject({ status: "sent" });
  });

  it("refuses to start with EMAIL_TRANSPORT=resend and no key", () => {
    expect(() => loadEnv({ ...base, EMAIL_TRANSPORT: "resend" })).toThrow(/RESEND_API_KEY/);
    expect(() => loadEnv({ ...base, EMAIL_TRANSPORT: "resend", RESEND_API_KEY: "re_a_key" })).not.toThrow();
  });

  it("refuses a key that isn't a Resend key", () => {
    expect(() => loadEnv({ ...base, EMAIL_TRANSPORT: "resend", RESEND_API_KEY: "not-a-resend-key" })).toThrow(/re_/);
  });
});
