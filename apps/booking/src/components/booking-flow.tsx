"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiRequestError, errorMessage } from "@/lib/api";
import { addDays, formatCents, formatMinutes, formatVenueDate, formatWallTime } from "@/lib/format";
import type { Availability, HoldResult, PublicConfig, Quote, QuoteResponse, ReferralCheck, Slot } from "@/lib/types";
import { Button, Card, Field, Input, Notice, Row, Spinner } from "@/components/ui";

const STEP_MINUTES = 15;
const ANY_RESOURCE = "any";
/** The lengths most people pick; every other length that fits is in the dropdown beside them. */
const QUICK_MINUTES = [30, 60, 90, 120];

interface Customer {
  name: string;
  email: string;
  phone: string;
}

export function BookingFlow() {
  const router = useRouter();
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);

  const [typeKey, setTypeKey] = useState<string | null>(null);
  const [date, setDate] = useState<string | null>(null);
  /** Availability and its errors are keyed by type+day, so what's on screen always matches the choice. */
  const [availabilityState, setAvailabilityState] = useState<{ key: string; data: Availability } | null>(null);
  const [slotsError, setSlotsError] = useState<{ key: string; message: string } | null>(null);
  /** Bumped to look the times up again after someone else takes a slot. */
  const [reloadSlots, setReloadSlots] = useState(0);

  /** Keyed to the chosen type and day: changing either drops the selection without an effect. */
  const [selection, setSelection] = useState<{ key: string; time: string } | null>(null);
  const [durationChoice, setDurationChoice] = useState<number | null>(null);
  const [resourceId, setResourceId] = useState<string>(ANY_RESOURCE);

  const [customer, setCustomer] = useState<Customer>({ name: "", email: "", phone: "" });
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

  // ── Config ────────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    api<PublicConfig>("/public/config")
      .then((c) => {
        if (cancelled) return;
        setConfig(c);
        setTypeKey((t) => t ?? c.resourceTypes[0]?.key ?? null);
        setDate((d) => d ?? c.today);
      })
      .catch((err: unknown) => !cancelled && setConfigError(errorMessage(err)));
    return () => {
      cancelled = true;
    };
  }, []);

  const dates = useMemo(() => {
    if (!config) return [];
    return Array.from({ length: config.bookingWindowDays + 1 }, (_, i) => addDays(config.today, i));
  }, [config]);

  const resourceType = config?.resourceTypes.find((t) => t.key === typeKey) ?? null;

  // ── Availability ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!typeKey || !date) return;
    const key = `${typeKey}|${date}`;
    const controller = new AbortController();
    api<Availability>(`/public/availability?type=${encodeURIComponent(typeKey)}&date=${date}`, { signal: controller.signal })
      .then((data) => setAvailabilityState({ key, data }))
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setSlotsError({ key, message: errorMessage(err) });
      });
    return () => controller.abort();
  }, [typeKey, date, reloadSlots]);

  const dayKey = `${typeKey}|${date}`;
  const availability = availabilityState?.key === dayKey ? availabilityState.data : null;
  const dayError = slotsError?.key === dayKey ? slotsError.message : null;
  const loadingSlots = !availability && !dayError;
  const startTime = selection?.key === dayKey ? selection.time : null;
  const slot: Slot | null = availability?.slots.find((s) => s.time === startTime) ?? null;

  /** Lengths that still fit before the next booking or closing time, on the chosen table. */
  const durations = useMemo(() => {
    if (!slot || !resourceType) return [];
    const max = resourceId === ANY_RESOURCE ? slot.maxMinutes : (slot.resourceMaxMinutes[resourceId] ?? 0);
    const lengths: number[] = [];
    for (let m = resourceType.minMinutes; m <= max; m += STEP_MINUTES) lengths.push(m);
    return lengths;
  }, [slot, resourceId, resourceType]);

  /** The chosen length if it still fits, otherwise an hour, otherwise the longest that fits. */
  const durationMinutes =
    durationChoice !== null && durations.includes(durationChoice)
      ? durationChoice
      : (durations.find((m) => m >= 60) ?? durations[durations.length - 1] ?? 0);

  const freeResources = useMemo(() => {
    if (!slot || !availability) return [];
    return availability.resources.filter((r) => (slot.resourceMaxMinutes[r.id] ?? 0) >= durationMinutes);
  }, [slot, availability, durationMinutes]);

  // ── Quote ─────────────────────────────────────────────────────────────────
  const quoteRequest = useMemo(() => {
    if (!resourceType || !date || !startTime || !durationMinutes) return null;
    return {
      resourceTypeId: resourceType.id,
      date,
      startTime,
      durationMinutes,
      ...(referral ? { referralCode: referral.code } : {}),
    };
  }, [resourceType, date, startTime, durationMinutes, referral]);

  const quoteKey = quoteRequest ? JSON.stringify(quoteRequest) : null;
  useEffect(() => {
    if (!quoteKey) return;
    const controller = new AbortController();
    api<QuoteResponse>("/public/quote", { body: JSON.parse(quoteKey) as unknown, signal: controller.signal })
      .then((r) => setQuoteState({ key: quoteKey, quote: r.quote }))
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setQuoteError({ key: quoteKey, message: errorMessage(err) });
      })
    return () => controller.abort();
  }, [quoteKey]);

  // Only ever show a quote, an error or a price change that belongs to the current choice.
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
      const r = await api<ReferralCheck>("/public/referral/check", { body: { code } });
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
  const contactGiven = customer.name.trim() !== "" && (customer.email.trim() !== "" || customer.phone.trim() !== "");
  const canPay = quote !== null && contactGiven && acceptTerms && !paying;

  async function pay() {
    if (!quote || !quoteRequest) return;
    setPaying(true);
    setPayError(null);
    try {
      const result = await api<HoldResult>("/bookings/hold", {
        body: {
          ...quoteRequest,
          ...(resourceId === ANY_RESOURCE ? {} : { resourceId }),
          customer: {
            name: customer.name.trim(),
            ...(customer.email.trim() ? { email: customer.email.trim() } : {}),
            ...(customer.phone.trim() ? { phone: customer.phone.trim() } : {}),
          },
          expectedTotalCents: quote.totalCents,
          acceptTerms: true,
        },
      });
      if (result.status === "pending_payment") {
        window.location.href = result.checkoutUrl;
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
        setPayError("Someone just took that time. Please pick another one.");
        setAvailabilityState(null);
        setReloadSlots((n) => n + 1);
        return;
      }
      setPayError(errorMessage(err));
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  if (configError && !config) return <Notice tone="error">{configError}</Notice>;
  if (!config || !resourceType || !date) return <Spinner label="Loading times…" />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black sm:text-3xl">Book your time</h1>
        <p className="mt-1 text-sm text-ink-500">
          All times are Sydney time. Prices include GST. You can book from {config.onlineCutoffMinutes} minutes ahead, up to {config.bookingWindowDays} days.
        </p>
      </div>

      <Card title="1. What and when">
        <fieldset>
          <legend className="text-sm font-medium text-ink-800">What would you like?</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {config.resourceTypes.map((t) => (
              <Button key={t.id} variant={t.key === typeKey ? "primary" : "secondary"} aria-pressed={t.key === typeKey} onClick={() => setTypeKey(t.key)}>
                {t.name}
              </Button>
            ))}
          </div>
        </fieldset>

        <fieldset className="mt-5">
          <legend className="text-sm font-medium text-ink-800">Which day?</legend>
          <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
            {dates.map((d) => (
              <Button key={d} variant={d === date ? "primary" : "secondary"} aria-pressed={d === date} className="shrink-0" onClick={() => setDate(d)}>
                {d === config.today ? "Today" : formatVenueDate(d, { year: false })}
              </Button>
            ))}
          </div>
        </fieldset>

        <fieldset className="mt-5">
          <legend className="text-sm font-medium text-ink-800">Start time</legend>
          {loadingSlots ? (
            <div className="mt-2">
              <Spinner label="Checking what&apos;s free…" />
            </div>
          ) : dayError ? (
            <div className="mt-2">
              <Notice tone="error">{dayError}</Notice>
            </div>
          ) : availability?.closed ? (
            <p className="mt-2 text-sm text-ink-500">We&apos;re closed on {formatVenueDate(date)}.</p>
          ) : (availability?.slots.length ?? 0) === 0 ? (
            <p className="mt-2 text-sm text-ink-500">Nothing left on {formatVenueDate(date)}. Try another day.</p>
          ) : (
            <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-6">
              {availability!.slots.map((s) => {
                const free = s.availableResources > 0 && s.maxMinutes >= resourceType.minMinutes;
                return (
                  <Button
                    key={s.time}
                    size="sm"
                    variant={s.time === startTime ? "primary" : "secondary"}
                    aria-pressed={s.time === startTime}
                    disabled={!free}
                    title={free ? `${s.availableResources} free` : "Taken"}
                    onClick={() => setSelection({ key: dayKey, time: s.time })}
                  >
                    {formatWallTime(s.time)}
                  </Button>
                );
              })}
            </div>
          )}
        </fieldset>

        {slot ? (
          <>
            <fieldset className="mt-5">
              <legend className="text-sm font-medium text-ink-800">How long?</legend>
              <div className="mt-2 flex flex-wrap gap-2">
                {QUICK_MINUTES.filter((m) => durations.includes(m)).map((m) => (
                  <Button key={m} size="sm" variant={m === durationMinutes ? "primary" : "secondary"} aria-pressed={m === durationMinutes} onClick={() => setDurationChoice(m)}>
                    {formatMinutes(m)}
                  </Button>
                ))}
              </div>
              <div className="mt-3 max-w-xs">
                <Field label="Or another length">
                  <select
                    className="h-11 w-full rounded-xl border border-line bg-paper px-3 focus:border-ink-950 focus:outline-none"
                    value={durationMinutes}
                    onChange={(e) => setDurationChoice(Number(e.target.value))}
                  >
                    {durations.map((m) => (
                      <option key={m} value={m}>
                        {formatMinutes(m)}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <p className="mt-2 text-sm text-ink-500">Up to {formatMinutes(slot.maxMinutes)} from {formatWallTime(slot.time)}, until we close.</p>
            </fieldset>

            <div className="mt-5">
              <Field label={`Which ${resourceType.name}?`} hint="We'll pick one for you unless you have a favourite.">
                <select
                  className="h-11 w-full rounded-xl border border-line bg-paper px-3 focus:border-ink-950 focus:outline-none"
                  value={resourceId}
                  onChange={(e) => setResourceId(e.target.value)}
                >
                  <option value={ANY_RESOURCE}>Any available</option>
                  {freeResources.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </>
        ) : null}
      </Card>

      {slot ? (
        <Card title="2. Your details">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Field label="Name">
                <Input autoComplete="name" value={customer.name} onChange={(e) => setCustomer({ ...customer, name: e.target.value })} />
              </Field>
            </div>
            <Field label="Email" hint="For your confirmation, booking code and cancellation link.">
              <Input type="email" autoComplete="email" value={customer.email} onChange={(e) => setCustomer({ ...customer, email: e.target.value })} />
            </Field>
            <Field label="Phone" hint="Either email or phone is enough.">
              <Input type="tel" autoComplete="tel" value={customer.phone} onChange={(e) => setCustomer({ ...customer, phone: e.target.value })} />
            </Field>
          </div>

          <div className="mt-5 border-t border-line pt-5">
            <Field label="Referral code (optional)" error={referralError}>
              <div className="flex gap-2">
                <Input
                  value={referralInput}
                  onChange={(e) => {
                    setReferralInput(e.target.value);
                    setReferralError(null);
                  }}
                  placeholder="ABC234"
                  aria-label="Referral code"
                  disabled={referral !== null}
                  className="uppercase"
                />
                {referral ? (
                  <Button
                    onClick={() => {
                      setReferral(null);
                      setReferralInput("");
                    }}
                  >
                    Remove
                  </Button>
                ) : (
                  <Button onClick={() => void applyReferral()} disabled={checkingReferral || referralInput.trim() === ""}>
                    Apply
                  </Button>
                )}
              </div>
            </Field>
            {referral ? <p className="mt-2 text-sm font-medium text-emerald-700">Code {referral.code} applied: {referral.label}.</p> : null}
            <p className="mt-2 text-sm text-ink-500">Members: log in from the top of the page to use your discount (coming soon).</p>
          </div>
        </Card>
      ) : null}

      {slot ? (
        <Card title="3. Check and pay">
          {quoting ? <Spinner label="Working out the price…" /> : null}
          {currentQuoteError ? <Notice tone="error">{currentQuoteError}</Notice> : null}
          {quote ? (
            <div className="space-y-4">
              <div className="space-y-1">
                <Row label={resourceType.name} value={resourceId === ANY_RESOURCE ? "Any available" : (freeResources.find((r) => r.id === resourceId)?.label ?? "")} />
                <Row label="When" value={`${formatVenueDate(date)}, ${formatWallTime(startTime!)}`} />
                <Row label="How long" value={formatMinutes(quote.durationMinutes)} />
              </div>
              <div className="rounded-xl bg-mist p-4">
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

              <div className="rounded-xl border border-line p-4 text-sm text-ink-600">
                <p className="font-medium text-ink-950">Cancellations</p>
                <p className="mt-1">
                  Full refund if you cancel at least {config.refundPolicy.fullRefundHoursBefore} hours before the start, 50% between{" "}
                  {config.refundPolicy.halfRefundHoursBefore} and {config.refundPolicy.fullRefundHoursBefore} hours before. Inside{" "}
                  {config.refundPolicy.halfRefundHoursBefore} hours you can&apos;t cancel online. We hold your spot {config.noShowHoldMinutes} minutes after the start time.
                </p>
              </div>

              <label className="flex items-start gap-3 text-sm">
                <input type="checkbox" className="mt-1 size-4" checked={acceptTerms} onChange={(e) => setAcceptTerms(e.target.checked)} />
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

              <Button variant="primary" size="lg" className="w-full" disabled={!canPay} onClick={() => void pay()}>
                {paying ? "Taking you to payment…" : quote.totalCents === 0 ? "Confirm booking" : `Pay ${formatCents(quote.totalCents)}`}
              </Button>
              <p className="text-center text-xs text-ink-500">
                {quote.totalCents === 0 ? "Nothing to pay for this booking." : "You&apos;ll pay securely on Stripe. We never see your card details."}
              </p>
            </div>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}
