/** Local Supabase sends its auth emails to Mailpit; the tests read the links from there. */
const MAILPIT = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";

interface Summary {
  ID: string;
  To: { Address: string }[];
  Subject: string;
  Created: string;
}

/** The newest email to this address, waiting for it to arrive. */
export async function latestEmail(to: string, timeoutMs = 20_000): Promise<{ subject: string; body: string }> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}&limit=20`);
    if (res.ok) {
      const { messages } = (await res.json()) as { messages: Summary[] };
      const newest = messages.sort((a, b) => Date.parse(b.Created) - Date.parse(a.Created))[0];
      if (newest) {
        const detail = await fetch(`${MAILPIT}/api/v1/message/${newest.ID}`);
        const message = (await detail.json()) as { Subject: string; Text?: string; HTML?: string };
        return { subject: message.Subject, body: `${message.Text ?? ""}\n${message.HTML ?? ""}` };
      }
    }
    if (Date.now() > until) throw new Error(`No email arrived for ${to} within ${timeoutMs}ms`);
    await new Promise((r) => setTimeout(r, 500));
  }
}

/** The first http(s) link in an email, with HTML entities undone. */
export function firstLink(body: string): string {
  const match = /https?:\/\/[^\s"'<>]+/.exec(body.replace(/&amp;/g, "&"));
  if (!match) throw new Error("No link found in the email");
  return match[0];
}

export async function clearInbox(to: string): Promise<void> {
  const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}&limit=50`);
  if (!res.ok) return;
  const { messages } = (await res.json()) as { messages: Summary[] };
  if (messages.length === 0) return;
  await fetch(`${MAILPIT}/api/v1/messages`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ IDs: messages.map((m) => m.ID) }),
  });
}
