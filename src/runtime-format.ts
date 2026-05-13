/**
 * Runtime number formatter — bridges JS doubles to the decimal-string policy.
 *
 * Contract:
 *   double -> toPrecision(17) -> scientificToPlain -> formatDecimalStringForFixture
 *
 * Rationale: 17 is the IEEE-754 round-trip envelope for binary64. toPrecision
 * delivers 17 significant decimal digits, but the ECMA spec forces scientific
 * notation when the value's exponent is below -6 (e.g., numeric_policy.tolerance
 * at 1e-9). scientificToPlain expands that scientific string back to plain
 * decimal before the policy formatter rounds it to 9 sig figs.
 *
 * The runtime formatter may use JS number arithmetic on the input double — that
 * is its job. scientificToPlain is restricted to string-and-digit arithmetic
 * on the toPrecision output; it does not coerce the mantissa back through a
 * Number or parseFloat call.
 */

import { formatDecimalStringForFixture } from "./format.js";

export function formatNumberForEngine(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error(
      `formatNumberForEngine: input is not finite (got ${String(value)})`,
    );
  }
  // Normalize negative zero to positive zero before any string conversion.
  const v = Object.is(value, -0) ? 0 : value;

  const precise = v.toPrecision(17);
  const plain =
    precise.includes("e") || precise.includes("E")
      ? scientificToPlain(precise)
      : precise;

  return formatDecimalStringForFixture(plain);
}

const SCIENTIFIC_REGEX = /^(-?)(\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/;

/**
 * Expand a scientific-notation decimal string to plain decimal.
 *
 * Operates on string and digit arithmetic. The exponent is parsed via parseInt
 * because it is a structural integer index (digit-position shift), not a
 * precision-sensitive value; the mantissa digits are never coerced.
 */
export function scientificToPlain(decimal: string): string {
  const m = SCIENTIFIC_REGEX.exec(decimal);
  if (m === null) {
    throw new Error(
      `scientificToPlain: input ${JSON.stringify(decimal)} is not in scientific notation (regex ${SCIENTIFIC_REGEX.source}).`,
    );
  }
  const sign = m[1] ?? "";
  const intPart = m[2]!;
  const fracPart = m[3] ?? "";
  const expStr = m[4]!;

  // Exponent is a positional shift, not a mantissa value. parseInt is safe
  // here because the result is a small integer well within Number.MAX_SAFE_INTEGER.
  const exp = parseInt(expStr, 10);
  if (!Number.isFinite(exp)) {
    throw new Error(
      `scientificToPlain: exponent ${JSON.stringify(expStr)} did not parse to a finite integer.`,
    );
  }

  const allDigits = intPart + fracPart;

  // In scientific notation, the decimal point is implicitly between intPart
  // and fracPart (position = intPart.length from the start of allDigits).
  // Multiplying by 10^exp shifts the decimal point `exp` positions to the right
  // (or `-exp` to the left if exp < 0).
  const decimalPos = intPart.length + exp;

  if (decimalPos >= allDigits.length) {
    // Decimal lands past every digit: append trailing zeros, no fractional part.
    const zerosToPad = decimalPos - allDigits.length;
    return sign + allDigits + "0".repeat(zerosToPad);
  } else if (decimalPos > 0) {
    // Decimal lands inside the digit stream: split.
    return sign + allDigits.slice(0, decimalPos) + "." + allDigits.slice(decimalPos);
  } else {
    // Decimal lands before every digit: prepend leading zeros.
    const leadingZeros = -decimalPos;
    return sign + "0." + "0".repeat(leadingZeros) + allDigits;
  }
}
