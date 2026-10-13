import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { api } from "@/lib/api";
import { TERMS_COMPANY, TERMS_SECTIONS, withArriveEarly, type TermsBlock } from "@/lib/terms";
import type { PublicConfig } from "@/lib/types";

export const metadata: Metadata = { title: "Terms & Conditions — Racegrounds" };

/** The owner's terms and conditions (D102), with the venue's own arrive-early minutes in them. */
export default async function TermsPage() {
  await connection();
  // The launch value if the API is away (D85).
  let arriveEarly = 15;
  try {
    arriveEarly = (await api<PublicConfig>("/public/config")).arriveEarlyMinutes;
  } catch {
    // keep the launch value
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="display text-4xl">Terms &amp; Conditions</h1>
      <p className="mt-2 text-sm text-ink-500">
        Operated by {TERMS_COMPANY.name} · ABN {TERMS_COMPANY.abn}
      </p>
      <p className="mt-4 text-sm text-ink-600">
        Cancellations and refunds are summed up on our{" "}
        <Link href="/refund-policy" className="underline">
          cancellation policy
        </Link>{" "}
        page.
      </p>

      <nav aria-label="Contents" className="mt-8 rounded-xl border border-line bg-paper/60 p-5">
        <p className="kicker">Contents</p>
        <ol className="mt-3 grid gap-x-6 gap-y-1.5 text-sm text-ink-600 sm:grid-cols-2">
          {TERMS_SECTIONS.map((s) => (
            <li key={s.number}>
              <a href={`#section-${s.number}`} className="hover:text-ink-950">
                {s.number}. {s.title}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <div className="mt-10 space-y-10">
        {TERMS_SECTIONS.map((s, i) => (
          <section key={s.number} id={`section-${s.number}`} aria-labelledby={`section-${s.number}-title`} className="scroll-mt-28">
            {s.group && s.group !== TERMS_SECTIONS[i - 1]?.group ? (
              <h2 className="display mb-8 border-t border-line pt-10 text-2xl text-flag">{s.group}</h2>
            ) : null}
            <h2 id={`section-${s.number}-title`} className="display text-xl">
              {s.number}. {s.title}
            </h2>
            <div className="mt-3 space-y-3 text-sm leading-relaxed text-ink-600">
              {s.blocks.map((block, b) => (
                <Block key={b} block={block} arriveEarly={arriveEarly} />
              ))}
            </div>
          </section>
        ))}
      </div>

      <p className="mt-12 border-t border-line pt-6 text-sm text-ink-500">
        End of Terms &amp; Conditions · {TERMS_COMPANY.name} · ABN {TERMS_COMPANY.abn}
      </p>
    </div>
  );
}

function Block({ block, arriveEarly }: { block: TermsBlock; arriveEarly: number }) {
  switch (block.kind) {
    case "heading":
      return <h3 className="display pt-2 text-base text-ink-950">{block.text}</h3>;
    case "important":
      return <p className="rounded-lg border border-flag/50 bg-flag/10 px-4 py-3 font-semibold text-ink-950">{block.text}</p>;
    case "list":
      return (
        <ul className="list-disc space-y-1.5 pl-5">
          {block.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      );
    case "p": {
      const text = withArriveEarly(block.text, arriveEarly);
      const email = /^Email: (\S+@\S+)$/.exec(text);
      if (email) {
        return (
          <p>
            Email:{" "}
            <a href={`mailto:${email[1]}`} className="underline">
              {email[1]}
            </a>
          </p>
        );
      }
      return <p>{text}</p>;
    }
  }
}
