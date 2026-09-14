/** Round a non-negative rational numerator/denominator to the nearest integer, half up. */
export function roundHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (numerator < 0n || denominator <= 0n) {
    throw new RangeError("roundHalfUp expects a non-negative numerator and positive denominator");
  }
  return (numerator * 2n + denominator) / (denominator * 2n);
}

/**
 * Split `total` (an integer) across parts given as exact numerators over a shared denominator,
 * using the largest-remainder method so the integer parts sum exactly to `total`.
 * Ties go to the earlier part.
 */
export function allocateLargestRemainder(
  numerators: bigint[],
  denominator: bigint,
  total: bigint,
): bigint[] {
  const floors = numerators.map((n) => n / denominator);
  const remainders = numerators.map((n, i) => ({ i, r: n % denominator }));
  let shortfall = total - floors.reduce((a, b) => a + b, 0n);
  if (shortfall < 0n || shortfall > BigInt(numerators.length)) {
    throw new RangeError("Allocation total is inconsistent with the parts");
  }
  remainders.sort((a, b) => (a.r === b.r ? a.i - b.i : a.r > b.r ? -1 : 1));
  const result = [...floors];
  for (const { i } of remainders) {
    if (shortfall === 0n) break;
    result[i] = (result[i] ?? 0n) + 1n;
    shortfall -= 1n;
  }
  return result;
}

export function formatCents(cents: number): string {
  const sign = cents < 0 ? "−" : "";
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const rest = String(abs % 100).padStart(2, "0");
  return `${sign}$${dollars.toLocaleString("en-AU")}.${rest}`;
}

export function formatBp(bp: number): string {
  const pct = bp / 100;
  return `${Number.isInteger(pct) ? pct : Number(pct.toFixed(2))}%`;
}
