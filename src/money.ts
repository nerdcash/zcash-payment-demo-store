const ZAT_PER_ZEC = 100_000_000n;

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoneyError";
  }
}

/** Parse a ZEC decimal string into zatoshis. One ZEC is 100_000_000 zatoshis. */
export function zecToZat(amount: string): number {
  const match = /^(-?)(\d{1,12})(?:\.(\d{1,8}))?$/.exec(amount.trim());
  if (!match) {
    throw new MoneyError(`invalid ZEC amount: ${amount}`);
  }

  const whole = BigInt(match[2]);
  const fraction = BigInt((match[3] ?? "").padEnd(8, "0"));
  let zat = whole * ZAT_PER_ZEC + fraction;
  if (match[1] === "-") zat = -zat;
  if (zat > BigInt(Number.MAX_SAFE_INTEGER) || zat < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new MoneyError("ZEC amount is out of range");
  }
  return Number(zat);
}

/** Format zatoshis the way zcash-payment-service formats total_received: 8 decimal places. */
export function formatZatAsZec(zat: number): string {
  if (!Number.isSafeInteger(zat)) {
    throw new MoneyError("amount must be an integer number of zatoshis");
  }
  const negative = zat < 0;
  const absolute = BigInt(Math.abs(zat));
  const whole = absolute / ZAT_PER_ZEC;
  const fraction = (absolute % ZAT_PER_ZEC).toString().padStart(8, "0");
  return `${negative ? "-" : ""}${whole.toString()}.${fraction}`;
}

/** Catalog display: trim trailing zeros, keep at least two decimal places. */
export function formatZecDisplay(zat: number): string {
  const exact = formatZatAsZec(zat);
  const negative = exact.startsWith("-");
  const [whole, fraction] = exact.slice(negative ? 1 : 0).split(".");
  const trimmed = fraction.replace(/0+$/, "");
  const digits = trimmed.length < 2 ? trimmed.padEnd(2, "0") : trimmed;
  return `${negative ? "-" : ""}${whole}.${digits}`;
}
