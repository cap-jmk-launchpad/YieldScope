/**
 * Exact decimal-string arithmetic for earn amounts.
 * Prefer these over Number()/toFixed so dust rewards survive ingest + native totals.
 */

export class DecimalAmountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DecimalAmountError";
  }
}

/** True when the string is empty or represents zero (no non-zero digit). */
export function isZeroDecimal(amount: string): boolean {
  const s = amount.trim();
  if (!s || s === "+" || s === "-" || s === "." || s === "-." || s === "+.") {
    return true;
  }
  return !/[1-9]/.test(s);
}

interface ParsedDecimal {
  neg: boolean;
  /** Absolute integer digits (no decimal point). */
  digits: bigint;
  /** Number of digits after the decimal in the original value. */
  scale: number;
}

function parseDecimal(raw: string): ParsedDecimal {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new DecimalAmountError("Empty decimal amount");
  }

  let neg = false;
  let s = trimmed;
  if (s[0] === "-") {
    neg = true;
    s = s.slice(1);
  } else if (s[0] === "+") {
    s = s.slice(1);
  }

  if (!/^\d+(\.\d+)?$/.test(s)) {
    throw new DecimalAmountError(`Malformed decimal amount: ${raw}`);
  }

  const [wholeRaw, fracRaw = ""] = s.split(".");
  const whole = wholeRaw.replace(/^0+(?=\d)/, "") || "0";
  const digitsStr = `${whole}${fracRaw}`.replace(/^0+(?=\d)/, "") || "0";
  return {
    neg,
    digits: BigInt(digitsStr),
    scale: fracRaw.length,
  };
}

function formatParsed(neg: boolean, digits: bigint, scale: number): string {
  if (digits === 0n) return "0";
  const abs = digits < 0n ? -digits : digits;
  let digs = abs.toString();
  if (scale > 0) {
    if (digs.length <= scale) {
      digs = digs.padStart(scale + 1, "0");
    }
    const split = digs.length - scale;
    digs = `${digs.slice(0, split)}.${digs.slice(split)}`.replace(/\.?0+$/, "");
  }
  const body = digs || "0";
  const signed = neg || digits < 0n;
  return signed && body !== "0" ? `-${body}` : body;
}

/**
 * Format integer base units (wei, integer uluna, …) as a human decimal string.
 * Exact — no float.
 */
export function formatBaseUnits(amount: bigint, decimals: number): string {
  if (!Number.isInteger(decimals) || decimals < 0) {
    throw new DecimalAmountError(`Invalid decimals: ${decimals}`);
  }
  const neg = amount < 0n;
  const v = neg ? -amount : amount;
  if (decimals === 0) {
    return neg ? `-${v.toString()}` : v.toString();
  }
  const whole = v / 10n ** BigInt(decimals);
  const frac = (v % 10n ** BigInt(decimals))
    .toString()
    .padStart(decimals, "0")
    .replace(/0+$/, "");
  const body = frac ? `${whole}.${frac}` : whole.toString();
  return neg ? `-${body}` : body;
}

/**
 * Divide a decimal amount string by 10^decimals (e.g. uluna → LUNC).
 * Preserves the full fractional precision of the input — no Number()/toFixed.
 */
export function scaleDownDecimal(amount: string, decimals: number): string {
  if (!Number.isInteger(decimals) || decimals < 0) {
    throw new DecimalAmountError(`Invalid decimals: ${decimals}`);
  }
  const parsed = parseDecimal(amount);
  return formatParsed(parsed.neg, parsed.digits, parsed.scale + decimals);
}

/** Add two decimal strings exactly. */
export function addDecimalStrings(a: string, b: string): string {
  const pa = parseDecimal(a);
  const pb = parseDecimal(b);
  const scale = Math.max(pa.scale, pb.scale);
  const ai =
    pa.digits *
    10n ** BigInt(scale - pa.scale) *
    (pa.neg ? -1n : 1n);
  const bi =
    pb.digits *
    10n ** BigInt(scale - pb.scale) *
    (pb.neg ? -1n : 1n);
  const sum = ai + bi;
  const neg = sum < 0n;
  return formatParsed(neg, neg ? -sum : sum, scale);
}

/** Sum decimal strings exactly (skips empty/zero terms). */
export function sumDecimalStrings(amounts: Iterable<string>): string {
  let acc = "0";
  for (const x of amounts) {
    const t = x.trim();
    if (!t || isZeroDecimal(t)) continue;
    acc = addDecimalStrings(acc, t);
  }
  return acc;
}

/**
 * Parse a finite decimal string to number for FX/chart display only.
 * Returns null when malformed or non-finite.
 */
export function decimalToNumber(amount: string): number | null {
  try {
    if (isZeroDecimal(amount)) return 0;
    const n = Number(amount);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}
