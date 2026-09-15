import { randomUUID } from "node:crypto";
import { localSupabase, saveFixture, type Fixture } from "./fixture";

/** Its own resource type and referral codes, so a run never competes with the POS tests or a used database. */
export default async function globalSetup() {
  const db = localSupabase();
  const run = randomUUID().slice(0, 6);

  const key = `e2e_web_${run}`;
  const { data: type, error: typeError } = await db
    .from("resource_types")
    .insert({ key, name: `E2E Booth ${run}`, base_rate_cents: 3000, min_minutes: 15, sort: 900 })
    .select("id")
    .single();
  if (typeError) throw typeError;

  const labels = [`E2E Booth A ${run}`, `E2E Booth B ${run}`];
  const { data: resources, error: resourceError } = await db
    .from("resources")
    .insert(labels.map((label, i) => ({ resource_type_id: type.id, label, sort: i })))
    .select("id, label");
  if (resourceError) throw resourceError;
  const ordered = labels.map((l) => resources.find((r: { id: string; label: string }) => r.label === l)!);

  // $1,000 off makes a short booking free, so the flow can be tested without Stripe.
  const { data: codes, error: codeError } = await db
    .from("referral_codes")
    .insert([
      { discount_type: "fixed", discount_value: 100_000, max_uses: 20, uses_count: 0 },
      { discount_type: "fixed", discount_value: 100_000, max_uses: 1, uses_count: 1 },
    ])
    .select("code, max_uses, uses_count");
  if (codeError) throw codeError;
  const freeCode = codes.find((c) => c.uses_count === 0)!.code as string;
  const usedUpCode = codes.find((c) => c.uses_count === 1)!.code as string;

  const fixture: Fixture = {
    run,
    resourceTypeId: type.id,
    resourceTypeKey: key,
    resourceTypeName: `E2E Booth ${run}`,
    resourceIds: ordered.map((r) => r.id),
    resourceLabels: labels,
    freeCode,
    usedUpCode,
    customerEmail: `e2e-web-${run}@raceground.test`,
  };
  saveFixture(fixture);
}
