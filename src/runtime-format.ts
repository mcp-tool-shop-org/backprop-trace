/**
 * Runtime number formatter — bridges JS doubles to the decimal-string policy.
 *
 * Contract:
 *   double -> toPrecision(17) -> scientificToPlain -> formatDecimalStringForFixture
 *
 * Rationale: 17 is the IEEE-754 round-trip envelope for binary64 (Steele &
 * White 1990; Adams Ryu PLDI 2018). toPrecision delivers 17 significant
 * decimal digits, but per ECMA-262 §21.1.3.5 it forces scientific notation
 * when the decimal exponent e satisfies `e < -6 OR e >= 17`. For
 * backprop-trace the `e < -6` branch is the operative one (numeric_policy
 * tolerance at 1e-9 hits it); the `e >= 17` branch is unreachable because
 * the policy plain_decimal_range floors `|v| < 1e7`. scientificToPlain
 * handles both forms identically — it expands scientific to plain decimal
 * via string-and-digit arithmetic, never coercing the mantissa back through
 * a Number or parseFloat call.
 *
 * The runtime formatter may use JS number arithmetic on the input double —
 * that is its job. scientificToPlain is restricted to string-and-digit
 * arithmetic on the toPrecision output.
 */

import { formatDecimalStringForFixture } from "./format.js";

/**
 * Format a finite IEEE 754 double into the canonical fixture decimal string.
 *
 * Pipeline:
 *   1. Reject NaN / Infinity / -Infinity.
 *   2. Normalize negative zero to positive zero (defense-in-depth; see F-A-005).
 *   3. value.toPrecision(17) — yields 17 significant decimal digits, the
 *      binary64 round-trip envelope (Steele & White PLDI 1990; Adams Ryu
 *      PLDI 2018).
 *   4. scientificToPlain when toPrecision emits scientific notation
 *      (e < -6 per ECMA-262 §21.1.3.5; reachable for tolerance at 1e-9).
 *   5. formatDecimalStringForFixture — round to 9 significant digits via
 *      round-half-to-even (IEEE 754-2019 §4.3.1).
 *
 * This is the canonical bridge from JS numbers to fixture text. Callers that
 * already hold a plain-decimal string should call formatDecimalStringForFixture
 * directly.
 *
 * @throws Error when input is non-finite (NaN, Infinity, -Infinity). The
 *   message includes a remediation hint pointing to upstream input validation.
 * @throws FormatPolicyError from formatDecimalStringForFixture when magnitude
 *   is outside [1e-9, 1e7).
 */
export function formatNumberForEngine(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error(
      `formatNumberForEngine: input is not finite (got ${String(value)}). Hint: only finite IEEE 754 doubles are formattable. NaN, Infinity, and -Infinity are invalid for receipt emission and indicate a bug upstream (likely in engine input validation or arithmetic). Check engine.ts assertFiniteMazurInput.`,
    );
  }
  // Normalize negative zero to positive zero before any string conversion.
  // F-A-005: this is defense-in-depth. Per ECMA-262 §21.1.3.5, the spec for
  // Number.prototype.toPrecision already returns the unsigned literal
  // "0.0000000000000000" for (-0).toPrecision(17) — the sign bit of negative
  // zero is dropped by the spec's ToString conversion before formatting.
  // format.ts's zero-detection branch (integerPart === "0" && fractionalPart
  // all-zero) also collapses any signed-zero variant onto the canonical
  // "0.000000000" representation. The explicit Object.is(value, -0) check
  // covers any future caller path that bypasses toPrecision (e.g., a direct
  // formatDecimalStringForFixture-skipping helper), so the negative-zero
  // input never reaches downstream stages where the assumption might not
  // hold. Keep the normalization; the rationale lives here so the line
  // does not look redundant on a casual read.
  const v = Object.is(value, -0) ? 0 : value;

  const precise = v.toPrecision(17);
  const plain =
    precise.includes("e") || precise.includes("E")
      ? scientificToPlain(precise)
      : precise;

  return formatDecimalStringForFixture(plain);
}

const SCIENTIFIC_REGEX = /^(-?)(\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/;

// T-A-014 (LOW): binary64's exponent range is approximately [-324, 308]
// (Number.MIN_VALUE ≈ 5e-324; Number.MAX_VALUE ≈ 1.8e308). A scientific-form
// string with |exponent| > 400 cannot have originated from toPrecision(17) on
// any finite double; allowing it would let a malformed caller request
// arbitrarily large zero-padding (DoS via "1e1000000" -> a million zeros).
// 400 leaves comfortable headroom above 324 while still being a small,
// auditable constant.
const MAX_ABS_SCIENTIFIC_EXPONENT = 400;

/**
 * Expand a scientific-notation decimal string to plain decimal.
 *
 * Operates on string and digit arithmetic. The exponent is parsed via parseInt
 * because it is a structural integer index (digit-position shift), not a
 * precision-sensitive value; the mantissa digits are never coerced.
 *
 * Designed to consume toPrecision(17)'s scientific-form output (e.g.,
 * `"1.0000000000000000e-9"`, `"1.5e+3"`); the regex also accepts canonical
 * literal forms like `"1e-9"`, `"1E-9"`, `"-1.5e3"`. Plain-decimal input
 * (no `e`/`E`) is NOT accepted by design — callers route through
 * formatNumberForEngine which decides whether expansion is needed before
 * delegating here.
 *
 * @throws Error when input does not match SCIENTIFIC_REGEX, the parsed
 *   exponent is non-finite, or |exponent| > 400 (which exceeds binary64's
 *   range of approximately [-324, 308] and indicates a malformed caller).
 */
export function scientificToPlain(decimal: string): string {
  const m = SCIENTIFIC_REGEX.exec(decimal);
  if (m === null) {
    throw new Error(
      `scientificToPlain: input ${JSON.stringify(decimal)} is not in scientific notation (regex ${SCIENTIFIC_REGEX.source}). Hint: scientificToPlain is a helper for expanding toPrecision(17)-emitted scientific notation. Plain-decimal input is unchanged; you likely meant to call formatNumberForEngine instead.`,
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
  // T-A-014: bound exponent magnitude before any zero-padding allocation.
  // binary64 caps at roughly [-324, 308]; |exponent| > 400 is impossible from
  // a real double and would let a caller demand unbounded string allocation.
  if (Math.abs(exp) > MAX_ABS_SCIENTIFIC_EXPONENT) {
    throw new Error(
      `scientificToPlain: exponent ${exp} exceeds binary64 range (~[-324, 308]); input likely malformed: ${JSON.stringify(decimal)}`,
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
