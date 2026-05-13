/**
 * Decimal-string formatter policy for backprop-trace.
 *
 * Implements:
 *   formatDecimalStringForFixture(input_decimal: string) -> string
 *
 * Driven by fixtures/formatter.policy.golden.json. Operates on decimal-string
 * digit arrays only. Does NOT call Number() / parseFloat(), does NOT coerce
 * the input to a JS number, does NOT use Math.round / Math.floor / Math.ceil,
 * does NOT use any IEEE-754 floating-point operation on the input value.
 *
 * The runtime-side formatter (formatNumberForEngine) lives in
 * src/runtime-format.ts and bridges JS doubles to this policy by routing
 * through toPrecision(17) + scientificToPlain.
 */

export type FormatErrorKind = "NON_PLAIN_DECIMAL_INPUT" | "PLAIN_DECIMAL_OUT_OF_SCOPE";

export class FormatPolicyError extends Error {
  readonly kind: FormatErrorKind;
  constructor(kind: FormatErrorKind, message: string) {
    super(message);
    this.kind = kind;
    this.name = "FormatPolicyError";
  }
}

const PLAIN_DECIMAL_REGEX = /^-?(0|[1-9][0-9]*)(\.[0-9]+)?$/;
const SIGNIFICANT_DIGITS = 9;
const PLAIN_DECIMAL_MIN_EXPONENT = -9;
const PLAIN_DECIMAL_MAX_EXPONENT_EXCLUSIVE = 7;
const ZERO_REPRESENTATION = "0.000000000";

// Lookup tables avoid any numeric coercion of digit characters.
const INC_DIGIT: Record<string, { result: string; carry: boolean }> = {
  "0": { result: "1", carry: false },
  "1": { result: "2", carry: false },
  "2": { result: "3", carry: false },
  "3": { result: "4", carry: false },
  "4": { result: "5", carry: false },
  "5": { result: "6", carry: false },
  "6": { result: "7", carry: false },
  "7": { result: "8", carry: false },
  "8": { result: "9", carry: false },
  "9": { result: "0", carry: true },
};

const DIGIT_IS_ODD: Record<string, boolean> = {
  "0": false, "1": true,  "2": false, "3": true,  "4": false,
  "5": true,  "6": false, "7": true,  "8": false, "9": true,
};

export function formatDecimalStringForFixture(input_decimal: string): string {
  // 1. Validate format
  if (!PLAIN_DECIMAL_REGEX.test(input_decimal)) {
    throw new FormatPolicyError(
      "NON_PLAIN_DECIMAL_INPUT",
      `Input ${JSON.stringify(input_decimal)} is not a plain-decimal literal (regex ${PLAIN_DECIMAL_REGEX.source}).`,
    );
  }

  // 2. Tokenize: strip sign, split at decimal point
  let s = input_decimal;
  const isNegativeInput = s.startsWith("-");
  if (isNegativeInput) s = s.slice(1);

  const dotIdx = s.indexOf(".");
  const integerPart = dotIdx === -1 ? s : s.slice(0, dotIdx);
  const fractionalPart = dotIdx === -1 ? "" : s.slice(dotIdx + 1);

  // 3. Zero detection (handles "0", "-0", "0.0", "-0.000", etc.)
  if (integerPart === "0" && /^0*$/.test(fractionalPart)) {
    return ZERO_REPRESENTATION;
  }

  // 4. Locate first significant digit and compute its decimal exponent.
  let leadingExponent: number;
  let sigDigits: string;
  if (integerPart !== "0") {
    leadingExponent = integerPart.length - 1;
    sigDigits = integerPart + fractionalPart;
  } else {
    let leadingZeros = 0;
    while (leadingZeros < fractionalPart.length && fractionalPart[leadingZeros] === "0") {
      leadingZeros++;
    }
    leadingExponent = -(leadingZeros + 1);
    sigDigits = fractionalPart.slice(leadingZeros);
  }

  // 5. Magnitude check (pre-round)
  if (leadingExponent < PLAIN_DECIMAL_MIN_EXPONENT) {
    throw new FormatPolicyError(
      "PLAIN_DECIMAL_OUT_OF_SCOPE",
      `Magnitude of ${JSON.stringify(input_decimal)} is below plain_decimal_range.min_magnitude (1e${PLAIN_DECIMAL_MIN_EXPONENT}).`,
    );
  }
  if (leadingExponent >= PLAIN_DECIMAL_MAX_EXPONENT_EXCLUSIVE) {
    throw new FormatPolicyError(
      "PLAIN_DECIMAL_OUT_OF_SCOPE",
      `Magnitude of ${JSON.stringify(input_decimal)} is at or above plain_decimal_range.max_magnitude_exclusive (1e${PLAIN_DECIMAL_MAX_EXPONENT_EXCLUSIVE}).`,
    );
  }

  // 6. Round sigDigits to SIGNIFICANT_DIGITS digits with round_half_to_even.
  const rounded = roundDigits(sigDigits, SIGNIFICANT_DIGITS);

  // Carry overflow may push exponent up by 1 (e.g., 0.999... -> 1.000...).
  const finalExponent = leadingExponent + rounded.expShift;

  // Re-check max magnitude in case carry pushed it out of scope.
  if (finalExponent >= PLAIN_DECIMAL_MAX_EXPONENT_EXCLUSIVE) {
    throw new FormatPolicyError(
      "PLAIN_DECIMAL_OUT_OF_SCOPE",
      `After rounding, magnitude of ${JSON.stringify(input_decimal)} reached >= 1e${PLAIN_DECIMAL_MAX_EXPONENT_EXCLUSIVE}.`,
    );
  }

  // 7. Emit canonical plain-decimal string.
  return emitFormatted(isNegativeInput, rounded.digits, finalExponent);
}

function roundDigits(
  sigDigits: string,
  n: number,
): { digits: string[]; expShift: number } {
  const arr = Array.from(sigDigits);

  // Pad with trailing zeros if shorter than n.
  while (arr.length < n) arr.push("0");

  if (arr.length === n) {
    return { digits: arr, expShift: 0 };
  }

  // arr.length > n — apply round_half_to_even on guard digit.
  const guard = arr[n]!;
  let roundUp: boolean;

  if (guard < "5") {
    roundUp = false;
  } else if (guard > "5") {
    roundUp = true;
  } else {
    // guard === "5" — could be an exact tie or a "5 followed by non-zero".
    let hasNonZeroTrail = false;
    for (let i = n + 1; i < arr.length; i++) {
      if (arr[i] !== "0") {
        hasNonZeroTrail = true;
        break;
      }
    }
    if (hasNonZeroTrail) {
      // Strictly greater than tie; round up.
      roundUp = true;
    } else {
      // Exact tie — round-half-to-even: round up iff last-kept digit is odd.
      const lastKept = arr[n - 1]!;
      roundUp = DIGIT_IS_ODD[lastKept]!;
    }
  }

  const result = arr.slice(0, n);

  if (!roundUp) {
    return { digits: result, expShift: 0 };
  }

  // Add 1 with carry propagation, working right-to-left.
  for (let i = n - 1; i >= 0; i--) {
    const step = INC_DIGIT[result[i]!]!;
    result[i] = step.result;
    if (!step.carry) {
      return { digits: result, expShift: 0 };
    }
  }

  // Overflow: every digit carried. Result is "1" followed by n zeros, but we
  // hold exactly n digits in the output — drop the trailing zero and lift the
  // exponent by 1 instead.
  result.unshift("1");
  result.pop();
  return { digits: result, expShift: 1 };
}

function emitFormatted(
  isNegative: boolean,
  digits: string[],
  finalExponent: number,
): string {
  const sign = isNegative ? "-" : "";
  let integerStr: string;
  let fractionalStr: string;

  if (finalExponent >= 0) {
    const integerLen = finalExponent + 1;
    integerStr = digits.slice(0, integerLen).join("");
    fractionalStr = digits.slice(integerLen).join("");
  } else {
    const leadingZeros = -finalExponent - 1;
    integerStr = "0";
    fractionalStr = "0".repeat(leadingZeros) + digits.join("");
  }

  return sign + integerStr + "." + fractionalStr;
}

