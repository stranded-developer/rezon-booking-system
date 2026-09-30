"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAccount } from "@/components/account-provider";
import { MonthCalendar } from "@/components/book/month-calendar";
import { SearchSelect } from "@/components/search-select";
import { SessionRules } from "@/components/session-rules";
import { Badge, Button, ButtonLink, Field, Input, Notice, Row, Select, Spinner } from "@/components/ui";
import { ApiRequestError, errorMessage } from "@/lib/api";
import { formatCents, formatMinutes, formatRate, formatVenueDate, formatWallTime } from "@/lib/format";
import type { Availability, Experience, Game, HoldResult, PublicConfig, Quote, QuoteResponse, ReferralCheck, ResourceType, Slot } from "@/lib/types";

const STEP_MINUTES = 15;
const ANY_RESOURCE = "any";
const QUICK_MINUTES = [30, 60, 90, 120];

/** What is being booked: a named package at a flat price, or a length of time at an hourly rate. */
export type BookTarget = { kind: "experience"; experience: Experience } | { kind: "hourly"; type: ResourceType };

export const targetName = (t: BookTarget) => (t.kind === "experience" ? t.experience.name : t.type.name);
const targetKey = (t: BookTarget) => (t.kind === "experience" ? `exp:${t.experience.key}` : `type:${t.type.key}`);

type Step = "date" | "details" | "pay";
const STEPS: { id: Step; label: string }[] = [
  { id: "date", label: "Date" },
  { id: "details", label: "Details" },
  { id: "pay", label: "Pay" },
];

interface Customer {
  name: string;
  email: string;
  phone: string;
}

/** What they'd like to drive (D80). Only sent when the box is ticked and a game is chosen. */
interface SimPick {
  on: boolean;
  gameId: string | null;
  trackId: string | null;
  carId: string | null;
}

/**
 * The booking panel (D71): Date → Details → Pay, over the page, as the reference does.
 *
 * Every rule underneath is the one that was already there — the same availability, the same quote,
 * the same hold, the same Stripe Checkout. What changed is the shape of the conversation.
 */
export function BookingPanel({
  config,
  target,
  resumeAt = null,
  onClose,
}: {
  config: PublicConfig;
  target: BookTarget;
  /** The day and time picked before the customer went to log in; the panel reopens on Details (D79). */
  resumeAt?: { date: string; time: string } | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const { session, account, request } = useAccount();
  /** An active membership prices the booking; a lapsed one books as a guest (the API says so). */
  const member = account?.member?.eligible ? account.member : null;

  /** `target` is a fresh object each render; this string is what actually identifies it. */
  const tKey = targetKey(target);

  const [step, setStep] = useState<Step>(resumeAt ? "details" : "date");
  /** Checked once, against the first times looked up for that day. */
  const resumeRef = useRef(resumeAt);
  const [date, setDate] = useState<string | null>(resumeAt?.date ?? null);

  /** Availability and its errors are keyed by what and which day, so the screen always matches. */
  const [availabilityState, setAvailabilityState] = useState<{ key: string; data: Availability } | null>(null);
  const [slotsError, setSlotsError] = useState<{ key: string; message: string } | null>(null);
  /** Bumped to look the times up again after someone else takes a slot. */
  const [reloadSlots, setReloadSlots] = useState(0);

  const [selection, setSelection] = useState<{ key: string; time: string } | null>(resumeAt ? { key: `${tKey}|${resumeAt.date}`, time: resumeAt.time } : null);
  const [durationChoice, setDurationChoice] = useState<number | null>(null);
  const [resourceId, setResourceId] = useState<string>(ANY_RESOURCE);
  const [freeMinutesChoice, setFreeMinutesChoice] = useState<number | null>(null);
  const [claimedPromoIds, setClaimedPromoIds] = useState<string[]>([]);

  const [customer, setCustomer] = useState<Customer>({ name: "", email: "", phone: "" });
  const [simPick, setSimPick] = useState<SimPick>({ on: false, gameId: null, trackId: null, carId: null });
  /** "No, continue as a guest": kept here so going back to Details doesn't ask again. */
  const [guest, setGuest] = useState(false);
  const [referralInput, setReferralInput] = useState("");
  const [referral, setReferral] = useState<{ code: string; label: string } | null>(null);
  const [referralError, setReferralError] = useState<string | null>(null);
  const [checkingReferral, setCheckingReferral] = useState(false);

  const [quoteState, setQuoteState] = useState<{ key: string; quote: Quote } | null>(null);
  const [quoteError, setQuoteError] = useState<{ key: string; message: string } | null>(null);
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const [priceChanged, setPriceChanged] = useState<{ key: string; totalCents: number } | null>(null);
  const [memberNotice, setMemberNotice] = useState<string | null>(null);

  const sessionMinutes = config.sessionMinutes;
  const isExperience = target.kind === "experience";
  /** Games are offered for whatever is being booked — the simulators, at launch. */
  const typeId = target.kind === "experience" ? target.experience.resourceTypeId : target.type.id;
  const games = useMemo(() => (config.games ?? []).filter((g) => g.resourceTypeId === typeId), [config.games, typeId]);
  const pickedGame = simPick.on ? (games.find((g) => g.id === simPick.gameId) ?? null) : null;
  const setupLabel = pickedGame
    ? [pickedGame.name, pickedGame.tracks.find((t) => t.id === simPick.trackId)?.name, pickedGame.cars.find((c) => c.id === simPick.carId)?.name].filter(Boolean).join(" · ")
    : null;

  // Escape closes the panel, like any dialog.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // ── Availability ──────────────────────────────────────────────────────────
  const dayKey = `${tKey}|${date}`;

  useEffect(() => {
    if (!date) return;
    const key = `${tKey}|${date}`;
    const query = target.kind === "experience" ? `experience=${encodeURIComponent(target.experience.key)}` : `type=${encodeURIComponent(target.type.key)}`;
    const controller = new AbortController();
    request<Availability>(`/public/availability?${query}&date=${date}`, { signal: controller.signal })
      .then((data) => {
        setAvailabilityState({ key, data });
        // A time picked before logging in may have gone in the meantime: back to the times, saying so.
        const resumed = resumeRef.current;
        if (resumed && key === `${tKey}|${resumed.date}`) {
          resumeRef.current = null;
          if (!data.slots.some((s) => s.time === resumed.time && s.availableResources > 0)) {
            setSelection(null);
            setStep("date");
            setPayError(`${formatWallTime(resumed.time)} has just been taken. Please pick another time.`);
          }
        }
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setSlotsError({ key, message: errorMessage(err) });
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tKey, date, reloadSlots, request]);

  const availability = availabilityState?.key === dayKey ? availabilityState.data : null;
  const dayError = slotsError?.key === dayKey ? slotsError.message : null;
  const loadingSlots = date !== null && !availability && !dayError;
  const startTime = selection?.key === dayKey ? selection.time : null;
  const slot: Slot | null = availability?.slots.find((s) => s.time === startTime) ?? null;

  /** Log in, then come straight back to this booking at this day and time (D79). */
  const loginHref = useMemo(() => {
    const what = target.kind === "experience" ? `experience=${encodeURIComponent(target.experience.key)}` : `type=${encodeURIComponent(target.type.key)}`;
    const when = date && startTime ? `&date=${date}&time=${startTime}` : "";
    return `/login?next=${encodeURIComponent(`/book?${what}${when}`)}`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tKey, date, startTime]);

  /** An experience runs for its own length; anything else starts at a session and steps by 15. */
  const durations = useMemo(() => {
    if (!slot || isExperience) return [];
    const max = resourceId === ANY_RESOURCE ? slot.maxMinutes : (slot.resourceMaxMinutes[resourceId] ?? 0);
    const lengths: number[] = [];
    for (let m = sessionMinutes; m <= max; m += STEP_MINUTES) lengths.push(m);
    return lengths;
  }, [slot, resourceId, sessionMinutes, isExperience]);

  const durationMinutes = isExperience
    ? target.experience.minutes
    : durationChoice !== null && durations.includes(durationChoice)
      ? durationChoice
      : (durations.find((m) => m >= 60) ?? durations[durations.length - 1] ?? 0);

  const freeResources = useMemo(() => {
    if (!slot || !availability) return [];
    return availability.resources.filter((r) => (slot.resourceMaxMinutes[r.id] ?? 0) >= durationMinutes);
  }, [slot, availability, durationMinutes]);

  // ── Quote ─────────────────────────────────────────────────────────────────
  const maxFreeMinutes = member ? Math.min(member.balanceMinutes, durationMinutes) : 0;
  /** Free play is spent the way the time is sold: whole sessions on an experience (D65). */
  const freeMinuteChoices = useMemo(() => {
    const choices = [0];
    const step = isExperience ? sessionMinutes : STEP_MINUTES;
    for (let m = sessionMinutes; m <= maxFreeMinutes; m += step) choices.push(m);
    return choices;
  }, [sessionMinutes, maxFreeMinutes, isExperience]);
  const freeMinutes = Math.min(freeMinutesChoice ?? 0, maxFreeMinutes);

  const quoteRequest = useMemo(() => {
    if (!date || !startTime || !durationMinutes) return null;
    return {
      ...(target.kind === "experience" ? { experienceKey: target.experience.key } : { resourceTypeId: target.type.id, durationMinutes }),
      date,
      startTime,
      ...(referral && !member ? { referralCode: referral.code } : {}),
      ...(freeMinutes > 0 ? { freeMinutes } : {}),
      ...(claimedPromoIds.length > 0 ? { claimedPromoIds } : {}),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tKey, date, startTime, durationMinutes, referral, member, freeMinutes, claimedPromoIds]);

  const quoteKey = quoteRequest ? JSON.stringify(quoteRequest) : null;
  useEffect(() => {
    if (!quoteKey) return;
    const controller = new AbortController();
    request<QuoteResponse>("/public/quote", { body: JSON.parse(quoteKey) as unknown, signal: controller.signal })
      .then((r) => {
        setQuoteState({ key: quoteKey, quote: r.quote });
        setMemberNotice(r.memberNotice?.message ?? null);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setQuoteError({ key: quoteKey, message: errorMessage(err) });
      });
    return () => controller.abort();
  }, [quoteKey, request]);

  const quote = quoteKey && quoteState?.key === quoteKey ? quoteState.quote : null;
  const currentQuoteError = quoteKey && quoteError?.key === quoteKey ? quoteError.message : null;
  const quoting = quoteKey !== null && quote === null && currentQuoteError === null;
  const changedTotal = quoteKey && priceChanged?.key === quoteKey ? priceChanged.totalCents : null;

  // ── Referral code ─────────────────────────────────────────────────────────
  async function applyReferral() {
    const code = referralInput.trim().toUpperCase();
    if (!code) return;
    setCheckingReferral(true);
    setReferralError(null);
    try {
      const r = await request<ReferralCheck>("/public/referral/check", { body: { code } });
      if (!r.valid) {
        setReferral(null);
        setReferralError(r.reason === "used_up" ? "That code has already been fully used." : "We don't recognise that code.");
        return;
      }
      const label = r.type === "percent" ? `${(r.value ?? 0) / 100}% off` : `${formatCents(r.value ?? 0)} off`;
      setReferral({ code: r.code ?? code, label });
    } catch (err) {
      setReferralError(errorMessage(err));
    } finally {
      setCheckingReferral(false);
    }
  }

  // ── Pay ───────────────────────────────────────────────────────────────────
  const accountContact = account ? account.customer.email !== null || account.customer.phone !== null : false;
  const contactGiven = session ? accountContact || member !== null : customer.name.trim() !== "" && (customer.email.trim() !== "" || customer.phone.trim() !== "");
  const canPay = quote !== null && contactGiven && acceptTerms && !paying;

  async function pay() {
    if (!quote || !quoteRequest) return;
    setPaying(true);
    setPayError(null);
    try {
      const result = await request<HoldResult>("/bookings/hold", {
        body: {
          ...quoteRequest,
          ...(resourceId === ANY_RESOURCE ? {} : { resourceId }),
          ...(pickedGame
            ? {
                simSetup: {
                  gameId: pickedGame.id,
                  ...(simPick.trackId ? { trackId: simPick.trackId } : {}),
                  ...(simPick.carId ? { carId: simPick.carId } : {}),
                },
              }
            : {}),
          ...(session
            ? {}
            : {
                customer: {
                  name: customer.name.trim(),
                  ...(customer.email.trim() ? { email: customer.email.trim() } : {}),
                  ...(customer.phone.trim() ? { phone: customer.phone.trim() } : {}),
                },
              }),
          expectedTotalCents: quote.totalCents,
          acceptTerms: true,
        },
      });
      if (result.status === "pending_payment") {
        window.location.assign(result.checkoutUrl);
        return;
      }
      router.push(`/booking/${result.ref}?token=${encodeURIComponent(result.token)}`);
    } catch (err) {
      setPaying(false);
      if (err instanceof ApiRequestError && err.code === "quote_changed") {
        const details = err.details as { quote?: Quote } | undefined;
        if (details?.quote && quoteKey) {
          setQuoteState({ key: quoteKey, quote: details.quote });
          setPriceChanged({ key: quoteKey, totalCents: details.quote.totalCents });
          setPayError(null);
          return;
        }
      }
      if (err instanceof ApiRequestError && err.code === "slot_taken") {
        setSelection(null);
        setStep("date");
        setPayError("Someone just took that time. Please pick another one.");
        setAvailabilityState(null);
        setReloadSlots((n) => n + 1);
        return;
      }
      setPayError(errorMessage(err));
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  const closedWeekdays = config.openingHours.filter((h) => h.closed).map((h) => h.dayOfWeek);
  const canLeaveDate = startTime !== null;
  const canLeaveDetails = canLeaveDate && contactGiven;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-night/85 p-0 backdrop-blur-sm sm:p-6" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="booking-panel-title"
        className="animate-pop flex min-h-dvh w-full flex-col overflow-hidden border-line bg-deep sm:min-h-0 sm:max-w-4xl sm:rounded-2xl sm:border sm:shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Title bar */}
        <div className="flex items-center justify-between gap-3 border-b border-line bg-night/60 px-4 py-3">
          <h2 id="booking-panel-title" className="display truncate text-lg">
            {targetName(target)}
          </h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="grid size-9 shrink-0 place-items-center rounded-lg text-ink-600 transition hover:bg-white/10 hover:text-ink-950"
          >
            <svg viewBox="0 0 20 20" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* The three steps */}
        <ol className="flex border-b border-line">
          {STEPS.map((s, i) => {
            const reached = STEPS.findIndex((x) => x.id === step) >= i;
            const allowed = i === 0 || (i === 1 && canLeaveDate) || (i === 2 && canLeaveDetails);
            return (
              <li key={s.id} className="flex-1">
                <button
                  type="button"
                  disabled={!allowed}
                  aria-current={step === s.id ? "step" : undefined}
                  onClick={() => setStep(s.id)}
                  className={`display w-full border-b-2 px-2 py-3 text-sm tracking-wide transition ${
                    step === s.id ? "border-flag text-ink-950" : reached && allowed ? "border-transparent text-ink-600 hover:text-ink-950" : "border-transparent text-ink-500/50"
                  }`}
                >
                  {/* Decoration: the step's name is what a screen reader should read, and the
                      position is already carried by the list and by aria-current. */}
                  <span aria-hidden className="tnum mr-2 text-xs">
                    {i + 1}
                  </span>
                  {s.label}
                </button>
              </li>
            );
          })}
        </ol>

        <div className="grid flex-1 gap-0 sm:grid-cols-[1fr_16rem]">
          {/* The step itself */}
          <div className="min-w-0 p-5">
            {step === "date" ? (
              <DateStep
                config={config}
                target={target}
                date={date}
                closedWeekdays={closedWeekdays}
                availability={availability}
                loading={loadingSlots}
                error={dayError}
                startTime={startTime}
                payError={payError}
                onPickDate={(d) => {
                  setDate(d);
                  setSelection(null);
                  setPayError(null);
                }}
                onBackToCalendar={() => setDate(null)}
                onPickTime={(time) => {
                  setSelection({ key: dayKey, time });
                  setStep("details");
                }}
              />
            ) : null}

            {step === "details" ? (
              <DetailsStep
                config={config}
                target={target}
                slot={slot}
                durations={durations}
                durationMinutes={durationMinutes}
                onDuration={setDurationChoice}
                freeResources={freeResources}
                resourceId={resourceId}
                onResource={setResourceId}
                member={member}
                loginHref={loginHref}
                guest={guest}
                onGuest={() => setGuest(true)}
                accountName={account?.customer.name ?? null}
                memberNotice={memberNotice}
                session={session !== null}
                customer={customer}
                onCustomer={setCustomer}
                games={games}
                simPick={simPick}
                onSimPick={setSimPick}
                freeMinutes={freeMinutes}
                freeMinuteChoices={freeMinuteChoices}
                onFreeMinutes={setFreeMinutesChoice}
                quote={quote}
                claimedPromoIds={claimedPromoIds}
                onClaimPromo={(id, on) => setClaimedPromoIds((ids) => (on ? [...ids, id] : ids.filter((x) => x !== id)))}
                referral={referral}
                referralInput={referralInput}
                referralError={referralError}
                checkingReferral={checkingReferral}
                onReferralInput={(v) => {
                  setReferralInput(v);
                  setReferralError(null);
                }}
                onApplyReferral={() => void applyReferral()}
                onRemoveReferral={() => {
                  setReferral(null);
                  setReferralInput("");
                }}
              />
            ) : null}

            {step === "pay" ? (
              <PayStep
                config={config}
                target={target}
                date={date}
                startTime={startTime}
                setupLabel={setupLabel}
                resourceLabel={resourceId === ANY_RESOURCE ? "Any available" : (freeResources.find((r) => r.id === resourceId)?.label ?? "")}
                quote={quote}
                quoting={quoting}
                quoteError={currentQuoteError}
                changedTotal={changedTotal}
                acceptTerms={acceptTerms}
                onAcceptTerms={setAcceptTerms}
                payError={payError}
                contactGiven={contactGiven}
                canPay={canPay}
                paying={paying}
                onPay={() => void pay()}
              />
            ) : null}
          </div>

          {/* What you're booking, always in view — the reference keeps this beside the steps. */}
          <aside className="border-t border-line bg-night/40 p-5 text-sm sm:border-l sm:border-t-0">
            <Summary target={target} config={config} date={date} startTime={startTime} durationMinutes={durationMinutes} quote={quote} />
          </aside>
        </div>

        {/* Moving between steps */}
        <div className="flex items-center justify-between gap-3 border-t border-line bg-night/60 px-4 py-3">
          <Button
            onClick={() => {
              if (step === "pay") setStep("details");
              else if (step === "details") setStep("date");
              else onClose();
            }}
          >
            {step === "date" ? "Cancel" : "Back"}
          </Button>
          {step !== "pay" ? (
            <Button
              variant="primary"
              disabled={step === "date" ? !canLeaveDate : !canLeaveDetails}
              onClick={() => setStep(step === "date" ? "details" : "pay")}
            >
              Continue
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ── Step 1: date, then a time ────────────────────────────────────────────────
function DateStep({
  config,
  target,
  date,
  closedWeekdays,
  availability,
  loading,
  error,
  startTime,
  payError,
  onPickDate,
  onBackToCalendar,
  onPickTime,
}: {
  config: PublicConfig;
  target: BookTarget;
  date: string | null;
  closedWeekdays: number[];
  availability: Availability | null;
  loading: boolean;
  error: string | null;
  startTime: string | null;
  payError: string | null;
  onPickDate: (date: string) => void;
  onBackToCalendar: () => void;
  onPickTime: (time: string) => void;
}) {
  if (!date) {
    return (
      <div>
        {payError ? (
          <div className="mb-4">
            <Notice tone="warn">{payError}</Notice>
          </div>
        ) : null}
        <h3 className="display mb-4 text-lg">Pick a day</h3>
        <MonthCalendar today={config.today} lastDate={lastBookableDate(config)} closedWeekdays={closedWeekdays} value={date} onSelect={onPickDate} />
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <button
          type="button"
          aria-label="Back to the calendar"
          onClick={onBackToCalendar}
          className="grid size-9 shrink-0 place-items-center rounded-full border border-line text-ink-600 transition hover:border-flag hover:text-ink-950"
        >
          <svg viewBox="0 0 20 20" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <path d="M12 4L6 10l6 6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <h3 className="display text-lg">{formatVenueDate(date)}</h3>
      </div>

      {loading ? <Spinner label="Checking what's free…" /> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      {availability?.closed ? <p className="text-sm text-ink-500">We&apos;re closed on {formatVenueDate(date)}.</p> : null}
      {availability && !availability.closed && availability.slots.length === 0 ? (
        <p className="text-sm text-ink-500">Nothing left on {formatVenueDate(date)}. Try another day.</p>
      ) : null}

      {availability && availability.slots.length > 0 ? (
        <>
          <p className="mb-3 text-sm text-ink-500">
            Choose a start time. Each shows how many {target.kind === "experience" ? "spots" : "are"} free.
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {availability.slots.map((s) => {
              const free = s.availableResources > 0;
              const selected = s.time === startTime;
              return (
                <button
                  key={s.time}
                  type="button"
                  disabled={!free}
                  aria-pressed={selected}
                  onClick={() => onPickTime(s.time)}
                  className={`rounded-xl border px-3 py-2.5 text-center transition ${
                    selected
                      ? "border-flag bg-flag/15"
                      : free
                        ? "border-line bg-mist/50 hover:border-flag hover:bg-mist"
                        : "cursor-not-allowed border-line/50 bg-transparent opacity-40"
                  }`}
                >
                  <span className="display tnum block text-base">{formatWallTime(s.time)}</span>
                  <span className="block truncate text-xs text-ink-500">{targetName(target)}</span>
                  <span className={`block text-xs ${free ? "text-gold" : "text-ink-500"}`}>
                    {free ? `${s.availableResources} ${s.availableResources === 1 ? "spot" : "spots"}` : "Full"}
                  </span>
                </button>
              );
            })}
          </div>
        </>
      ) : null}
    </div>
  );
}

// ── Step 2: how long, which one, and who you are ─────────────────────────────
function DetailsStep({
  config,
  target,
  slot,
  durations,
  durationMinutes,
  onDuration,
  freeResources,
  resourceId,
  onResource,
  member,
  loginHref,
  guest,
  onGuest,
  accountName,
  memberNotice,
  session,
  customer,
  onCustomer,
  games,
  simPick,
  onSimPick,
  freeMinutes,
  freeMinuteChoices,
  onFreeMinutes,
  quote,
  claimedPromoIds,
  onClaimPromo,
  referral,
  referralInput,
  referralError,
  checkingReferral,
  onReferralInput,
  onApplyReferral,
  onRemoveReferral,
}: {
  config: PublicConfig;
  target: BookTarget;
  slot: Slot | null;
  durations: number[];
  durationMinutes: number;
  onDuration: (m: number) => void;
  freeResources: { id: string; label: string }[];
  resourceId: string;
  onResource: (id: string) => void;
  member: NonNullable<NonNullable<ReturnType<typeof useAccount>["account"]>["member"]> | null;
  loginHref: string;
  guest: boolean;
  onGuest: () => void;
  accountName: string | null;
  memberNotice: string | null;
  session: boolean;
  customer: Customer;
  onCustomer: (c: Customer) => void;
  games: Game[];
  simPick: SimPick;
  onSimPick: (p: SimPick) => void;
  freeMinutes: number;
  freeMinuteChoices: number[];
  onFreeMinutes: (m: number) => void;
  quote: Quote | null;
  claimedPromoIds: string[];
  onClaimPromo: (id: string, on: boolean) => void;
  referral: { code: string; label: string } | null;
  referralInput: string;
  referralError: string | null;
  checkingReferral: boolean;
  onReferralInput: (v: string) => void;
  onApplyReferral: () => void;
  onRemoveReferral: () => void;
}) {
  const isExperience = target.kind === "experience";
  return (
    <div className="space-y-5">
      {/* Asked first, before anything is filled in, so a member doesn't type their details twice (D79). */}
      {!session && !guest ? (
        <section aria-labelledby="member-ask" className="rounded-xl border border-gold/40 bg-gold/10 p-4">
          <h3 id="member-ask" className="display text-base text-gold">
            Are you a member?
          </h3>
          <p className="mt-1 text-sm text-ink-600">Log in for your member price and free play. You&apos;ll come straight back to this booking.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <ButtonLink href={loginHref} variant="gold" size="sm">
              Yes, log in
            </ButtonLink>
            <Button size="sm" onClick={onGuest}>
              No, continue as a guest
            </Button>
          </div>
        </section>
      ) : null}

      {!isExperience && slot ? (
        <>
          <fieldset>
            <legend className="display text-sm tracking-wide text-ink-800">How long?</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {QUICK_MINUTES.filter((m) => durations.includes(m)).map((m) => (
                <Button key={m} size="sm" variant={m === durationMinutes ? "primary" : "secondary"} aria-pressed={m === durationMinutes} onClick={() => onDuration(m)}>
                  {formatMinutes(m)}
                </Button>
              ))}
            </div>
            <div className="mt-3 max-w-xs">
              <Field label="Or another length">
                <Select value={durationMinutes} onChange={(e) => onDuration(Number(e.target.value))}>
                  {durations.map((m) => (
                    <option key={m} value={m}>
                      {formatMinutes(m)}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <p className="mt-2 text-xs text-ink-500">
              Up to {formatMinutes(slot.maxMinutes)} from {formatWallTime(slot.time)}, until we close.
            </p>
          </fieldset>

          <Field label={`Which ${target.type.name}?`} hint={pickHint(freeResources)}>
            <Select value={resourceId} onChange={(e) => onResource(e.target.value)}>
              <option value={ANY_RESOURCE}>Any available</option>
              {freeResources.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </Select>
          </Field>
        </>
      ) : null}

      {isExperience ? (
        <Field label={`Which ${config.resourceTypes.find((t) => t.id === target.experience.resourceTypeId)?.name ?? "one"}?`} hint={pickHint(freeResources)}>
          <Select value={resourceId} onChange={(e) => onResource(e.target.value)}>
            <option value={ANY_RESOURCE}>Any available</option>
            {freeResources.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}

      {member ? (
        <div className="rounded-xl border border-gold/30 bg-gold/10 p-4">
          <p className="display text-gold">
            {/* D82: an experience has a flat member price; the percentage is for time booked by the hour. */}
            {isExperience ? `${member.tier.name} member price` : `${member.tier.name} member · ${member.tier.discountBp / 100}% off`}
          </p>
          <p className="mt-1 text-sm text-ink-600">
            Booking as {accountName}. {isExperience ? "Your member price is already in the price." : "Your discount is already in the price."}
          </p>
        </div>
      ) : session ? (
        <Notice>
          Booking as {accountName}.{memberNotice ? ` ${memberNotice}` : ""}
        </Notice>
      ) : null}

      {member && member.balanceMinutes > 0 ? (
        <Field
          label="Use your free play?"
          hint={`You have ${formatMinutes(member.balanceMinutes)} saved up. ${
            isExperience ? `On ${targetName(target)} it is used ${config.sessionMinutes} minutes at a time.` : "On a booking it starts at one session."
          }`}
        >
          <Select value={freeMinutes} onChange={(e) => onFreeMinutes(Number(e.target.value))}>
            {freeMinuteChoices.map((m) => (
              <option key={m} value={m}>
                {m === 0 ? "None, save them for later" : formatMinutes(m)}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}

      {/* Prices you have to ask for, e.g. the student price (D66). */}
      {quote && quote.claimablePromos.length > 0 ? (
        <fieldset className="rounded-xl border border-line p-4">
          <legend className="display px-1 text-sm tracking-wide text-ink-800">Any of these apply?</legend>
          <div className="space-y-2">
            {quote.claimablePromos.map((promo) => (
              <label key={promo.id} className="flex items-start gap-3 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5 size-4 accent-[var(--color-flag)]"
                  checked={claimedPromoIds.includes(promo.id)}
                  onChange={(e) => onClaimPromo(promo.id, e.target.checked)}
                />
                <span>
                  <span className="font-medium text-ink-950">{promo.name} price — {formatCents(promo.priceCents)}</span>
                  <span className="block text-xs text-ink-500">Bring proof to the counter, or the difference is payable.</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}

      {games.length > 0 ? <SimPicker games={games} pick={simPick} onPick={onSimPick} /> : null}

      <div className={`grid gap-4 sm:grid-cols-2 ${session ? "hidden" : ""}`}>
        <div className="sm:col-span-2">
          <Field label="Name">
            <Input autoComplete="name" value={customer.name} onChange={(e) => onCustomer({ ...customer, name: e.target.value })} />
          </Field>
        </div>
        <Field label="Email" hint="For your confirmation, booking code and cancellation link.">
          <Input type="email" autoComplete="email" value={customer.email} onChange={(e) => onCustomer({ ...customer, email: e.target.value })} />
        </Field>
        <Field label="Phone" hint="Either email or phone is enough.">
          <Input type="tel" autoComplete="tel" value={customer.phone} onChange={(e) => onCustomer({ ...customer, phone: e.target.value })} />
        </Field>
      </div>

      {/* A member never sees this: a membership and a code can't be combined (D9). */}
      <div className={`border-t border-line pt-5 ${member ? "hidden" : ""}`}>
        <Field label="Referral code (optional)" error={referralError}>
          <div className="flex gap-2">
            <Input
              value={referralInput}
              onChange={(e) => onReferralInput(e.target.value)}
              placeholder="ABC234"
              aria-label="Referral code"
              disabled={referral !== null}
              className="uppercase"
            />
            {referral ? <Button onClick={onRemoveReferral}>Remove</Button> : <Button onClick={onApplyReferral} disabled={checkingReferral || referralInput.trim() === ""}>Apply</Button>}
          </div>
        </Field>
        {referral ? (
          <p className="mt-2 text-sm font-medium text-emerald-300">
            Code {referral.code} applied: {referral.label}.
          </p>
        ) : null}
        {!session ? (
          <p className="mt-2 text-sm text-ink-500">
            Members:{" "}
            <Link href={loginHref} className="underline">
              log in
            </Link>{" "}
            to use your discount and free play.
          </p>
        ) : null}
      </div>
    </div>
  );
}

// ── Pick your game, track and car (D80) ──────────────────────────────────────
function SimPicker({ games, pick, onPick }: { games: Game[]; pick: SimPick; onPick: (p: SimPick) => void }) {
  const game = games.find((g) => g.id === pick.gameId) ?? null;
  return (
    <div className="rounded-xl border border-line p-4">
      <label className="flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          className="mt-0.5 size-4 accent-[var(--color-flag)]"
          checked={pick.on}
          onChange={(e) => onPick({ ...pick, on: e.target.checked })}
        />
        <span>
          <span className="font-medium text-ink-950">Would you like to pick your game, track and car?</span>
          <span className="block text-xs text-ink-500">Optional. We&apos;ll have it set up for you when you arrive.</span>
        </span>
      </label>
      {pick.on ? (
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {/* Game names are long ("Assetto Corsa Competizione"): a full row of their own. */}
          <div className="sm:col-span-2">
            <SearchSelect
            label="Game"
            options={games}
            value={pick.gameId}
            // A track or car belongs to its game, so changing the game clears them.
            onChange={(gameId) => onPick({ ...pick, gameId, trackId: null, carId: null })}
            />
          </div>
          <SearchSelect
            label="Track"
            options={game?.tracks ?? []}
            value={pick.trackId}
            disabled={!game}
            noneLabel={game ? "No preference" : "Pick a game first"}
            onChange={(trackId) => onPick({ ...pick, trackId })}
          />
          <SearchSelect
            label="Car"
            options={game?.cars ?? []}
            value={pick.carId}
            disabled={!game}
            noneLabel={game ? "No preference" : "Pick a game first"}
            onChange={(carId) => onPick({ ...pick, carId })}
          />
        </div>
      ) : null}
    </div>
  );
}

// ── Step 3: what it costs, and pay ───────────────────────────────────────────
function PayStep({
  config,
  target,
  date,
  startTime,
  setupLabel,
  resourceLabel,
  quote,
  quoting,
  quoteError,
  changedTotal,
  acceptTerms,
  onAcceptTerms,
  payError,
  contactGiven,
  canPay,
  paying,
  onPay,
}: {
  config: PublicConfig;
  target: BookTarget;
  date: string | null;
  startTime: string | null;
  setupLabel: string | null;
  resourceLabel: string;
  quote: Quote | null;
  quoting: boolean;
  quoteError: string | null;
  changedTotal: number | null;
  acceptTerms: boolean;
  onAcceptTerms: (on: boolean) => void;
  payError: string | null;
  contactGiven: boolean;
  canPay: boolean;
  paying: boolean;
  onPay: () => void;
}) {
  return (
    <div className="space-y-4">
      {quoting ? <Spinner label="Working out the price…" /> : null}
      {quoteError ? <Notice tone="error">{quoteError}</Notice> : null}
      {quote ? (
        <>
          <div className="space-y-1">
            <Row label={targetName(target)} value={resourceLabel} />
            <Row label="When" value={`${formatVenueDate(date!)}, ${formatWallTime(startTime!)}`} />
            <Row label="How long" value={formatMinutes(quote.durationMinutes)} />
            {setupLabel ? <Row label="Your setup" value={setupLabel} /> : null}
          </div>

          <div className="rounded-xl bg-mist/60 p-4">
            <ul className="space-y-1 text-sm text-ink-600">
              {quote.explanation.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
            <div className="mt-3 border-t border-line pt-3">
              <Row label="Total to pay" value={formatCents(quote.totalCents)} strong />
              <p className="mt-1 text-right text-xs text-ink-500">includes GST {formatCents(quote.gstCents)}</p>
            </div>
          </div>

          {changedTotal !== null ? (
            <Notice tone="warn">The price changed to {formatCents(changedTotal)} while you were booking. Check it and press Pay again.</Notice>
          ) : null}

          <SessionRules arriveEarlyMinutes={config.arriveEarlyMinutes} noShowHoldMinutes={config.noShowHoldMinutes} />

          <div className="rounded-xl border border-line p-4 text-sm text-ink-600">
            <p className="display text-ink-950">Cancellations</p>
            <p className="mt-1">
              Full refund if you cancel at least {config.refundPolicy.fullRefundHoursBefore} hours before the start, 50% between{" "}
              {config.refundPolicy.halfRefundHoursBefore} and {config.refundPolicy.fullRefundHoursBefore} hours before. Inside{" "}
              {config.refundPolicy.halfRefundHoursBefore} hours you can&apos;t cancel online.
            </p>
          </div>

          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" className="mt-1 size-4 accent-[var(--color-flag)]" checked={acceptTerms} onChange={(e) => onAcceptTerms(e.target.checked)} />
            <span>
              I accept the{" "}
              <a href="/terms" className="underline" target="_blank" rel="noreferrer">
                terms
              </a>{" "}
              and the{" "}
              <a href="/refund-policy" className="underline" target="_blank" rel="noreferrer">
                cancellation policy
              </a>
              .
            </span>
          </label>

          {payError ? <Notice tone="error">{payError}</Notice> : null}
          {!contactGiven ? <p className="text-sm text-ink-500">Add your name and an email or phone number to continue.</p> : null}

          <Button variant="primary" size="lg" className="w-full" disabled={!canPay} onClick={onPay}>
            {paying ? "Taking you to payment…" : quote.totalCents === 0 ? "Confirm booking" : `Pay ${formatCents(quote.totalCents)}`}
          </Button>
          <p className="text-center text-xs text-ink-500">
            {quote.totalCents === 0 ? "Nothing to pay for this booking." : "You'll pay securely on Stripe. We never see your card details."}
          </p>
        </>
      ) : null}
    </div>
  );
}

// ── The panel beside the steps ───────────────────────────────────────────────
function Summary({
  target,
  config,
  date,
  startTime,
  durationMinutes,
  quote,
}: {
  target: BookTarget;
  config: PublicConfig;
  date: string | null;
  startTime: string | null;
  durationMinutes: number;
  quote: Quote | null;
}) {
  const exp = target.kind === "experience" ? target.experience : null;
  return (
    <div className="space-y-4">
      <div>
        <h3 className="display text-lg">{targetName(target)}</h3>
        {exp?.tagline ? <p className="text-xs text-ink-500">{exp.tagline}</p> : null}
      </div>

      {exp && exp.badges.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {exp.badges.map((badge, i) => (
            <Badge key={badge} tone={i === 0 ? "flag" : "gold"}>
              {badge}
            </Badge>
          ))}
        </div>
      ) : null}

      <p className="display tnum text-3xl text-flag">
        {quote
          ? formatCents(quote.totalCents)
          : target.kind === "experience"
            ? formatCents(target.experience.fromPriceCents)
            : formatRate(target.type.baseRateCents)}
      </p>

      <dl className="space-y-1 text-xs text-ink-600">
        <div className="flex justify-between gap-2">
          <dt>Length</dt>
          <dd className="tnum">{durationMinutes ? formatMinutes(durationMinutes) : exp ? formatMinutes(exp.minutes) : "—"}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt>Day</dt>
          <dd>{date ? formatVenueDate(date, { year: false }) : "—"}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt>Start</dt>
          <dd className="tnum">{startTime ? formatWallTime(startTime) : "—"}</dd>
        </div>
      </dl>

      {exp && exp.bullets.length > 0 ? (
        <ul className="space-y-1.5 border-t border-line pt-4 text-xs text-ink-600">
          {exp.bullets.map((b) => (
            <li key={b} className="flex gap-2">
              <span aria-hidden className="text-flag">
                ✓
              </span>
              {b}
            </li>
          ))}
        </ul>
      ) : null}

      <p className="border-t border-line pt-4 text-xs text-ink-500">
        All prices include GST. All times are Sydney time. Book from {config.onlineCutoffMinutes} minutes ahead.
      </p>
    </div>
  );
}

/** VR rigs are simulators at the same price (D77); the hint says so when one is on offer. */
function pickHint(resources: { label: string }[]): string {
  const vr = resources.some((r) => /\bVR\b/i.test(r.label));
  return vr ? "We'll pick one for you unless you have a favourite. The VR rigs are the same price." : "We'll pick one for you unless you have a favourite.";
}

/** today + the booking window, as a venue date. */
function lastBookableDate(config: PublicConfig): string {
  const [y, m, d] = config.today.split("-").map(Number);
  const at = new Date(Date.UTC(y!, m! - 1, d! + config.bookingWindowDays));
  return at.toISOString().slice(0, 10);
}
