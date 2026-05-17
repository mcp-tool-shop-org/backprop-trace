/**
 * T-A-006: Property/fuzz tests for the formatter pipeline.
 *
 * Property smoke for `formatNumberForEngine` / `scientificToPlain`. The four
 * properties pinned here close the deferred T-A-006 finding from Stage A:
 *
 *   1. Round-trip idempotency
 *        `format(x) === format(parseFloat(format(x)))` over 100+ random
 *        doubles inside the v0.1 plain-decimal range [1e-9, 1e7). If the
 *        formatter ever produces a string that parses back to a different
 *        double, this property breaks loudly. Backstops the 9-sig-fig HTE
 *        contract against accidental drift across toPrecision(17), scientific
 *        expansion, and HTE rounding.
 *
 *   2. Negative-zero invariance
 *        `formatNumberForEngine(-0) === formatNumberForEngine(0) === "0.000000000"`.
 *        Pins the F-A-005 normalization branch in runtime-format.ts AND the
 *        zero-detection branch in format.ts so future refactors cannot
 *        accidentally leak the IEEE-754 sign bit into emitted bytes.
 *
 *   3. MAX_VALUE / MIN_VALUE clean rejection
 *        `formatNumberForEngine(Number.MAX_VALUE)` and `Number.MIN_VALUE`
 *        (subnormal) both throw `FormatPolicyError(PLAIN_DECIMAL_OUT_OF_SCOPE)`.
 *        Pins that out-of-scope magnitudes surface as a typed policy error,
 *        not as a silent overflow / underflow into a malformed string.
 *
 *   4. Scientific boundary
 *        Doubles at exactly `1e-9` round to "0.00000000100000000"; at
 *        `9.999999e-10` throw OUT_OF_SCOPE; at `9.999999e6` round to fixed
 *        form; at `1.000001e7` throw OUT_OF_SCOPE. Pins the exact boundary
 *        the runtime decides scientific-vs-plain on, matching the
 *        `e < -6 OR e >= 17` rule documented in runtime-format.ts.
 *
 * No fast-check dep: simple `Math.random()` PRNG is fine for property
 * smoke at this stage. If a counterexample ever falls out of this fuzz,
 * promoting to fast-check is straightforward.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatNumberForEngine,
  scientificToPlain,
} from "../src/runtime-format.js";
import { FormatPolicyError } from "../src/format.js";

// =============================================================================
// Property 1: round-trip idempotency over random doubles in [1e-9, 1e7)
// =============================================================================

const FUZZ_ITERATIONS = 200;

function randomDoubleInRange(): number {
  // Uniform in [1e-9, 1e7). Math.random() is non-seeded; the property
  // claim is true for ALL inputs in-range, so a non-seeded PRNG that
  // explores 200 random points each run is adequate. If a counterexample
  // surfaces in CI, the failing input prints in the assertion message so
  // it can be folded into the happy-case table in runtime-format.test.ts.
  return Math.random() * (1e7 - 1e-9) + 1e-9;
}

test(
  `T-A-006: format(x) === format(parseFloat(format(x))) over ${FUZZ_ITERATIONS} random doubles in [1e-9, 1e7)`,
  () => {
    for (let i = 0; i < FUZZ_ITERATIONS; i++) {
      const x = randomDoubleInRange();
      const first = formatNumberForEngine(x);
      const parsed = parseFloat(first);
      // parseFloat must produce a finite double inside the same range
      // (idempotency cannot hold if the string round-trips to NaN /
      // Infinity / a magnitude outside policy scope).
      assert.ok(
        Number.isFinite(parsed),
        `round-trip parseFloat(${JSON.stringify(first)}) for x=${x} produced non-finite ${parsed}`,
      );
      const second = formatNumberForEngine(parsed);
      assert.strictEqual(
        second,
        first,
        `round-trip drift on x=${x}: first=${JSON.stringify(first)} second=${JSON.stringify(second)}`,
      );
    }
  },
);

// Also pin a handful of small negatives for the property — they live in
// the same plain-decimal range and the formatter must round-trip them
// identically through the negative-sign branch.
test(
  `T-A-006: negative-half-range round-trip idempotency (${FUZZ_ITERATIONS} doubles)`,
  () => {
    for (let i = 0; i < FUZZ_ITERATIONS; i++) {
      const x = -randomDoubleInRange();
      const first = formatNumberForEngine(x);
      const parsed = parseFloat(first);
      assert.ok(
        Number.isFinite(parsed),
        `round-trip parseFloat(${JSON.stringify(first)}) for negative x=${x} produced non-finite ${parsed}`,
      );
      const second = formatNumberForEngine(parsed);
      assert.strictEqual(
        second,
        first,
        `negative round-trip drift on x=${x}: first=${JSON.stringify(first)} second=${JSON.stringify(second)}`,
      );
    }
  },
);

// =============================================================================
// Property 2: negative-zero invariance
// =============================================================================

test("T-A-006: formatNumberForEngine(-0) === formatNumberForEngine(0)", () => {
  assert.strictEqual(formatNumberForEngine(-0), formatNumberForEngine(0));
});

test("T-A-006: formatNumberForEngine(-0) === '0.000000000' (positive-zero canonical form)", () => {
  assert.strictEqual(formatNumberForEngine(-0), "0.000000000");
});

test("T-A-006: formatNumberForEngine(0) === '0.000000000' (positive-zero canonical form)", () => {
  assert.strictEqual(formatNumberForEngine(0), "0.000000000");
});

// =============================================================================
// Property 3: MAX_VALUE / MIN_VALUE clean rejection
// =============================================================================

test("T-A-006: formatNumberForEngine(Number.MAX_VALUE) throws PLAIN_DECIMAL_OUT_OF_SCOPE", () => {
  let caught: unknown;
  try {
    formatNumberForEngine(Number.MAX_VALUE);
  } catch (e) {
    caught = e;
  }
  assert.ok(
    caught instanceof FormatPolicyError,
    `expected FormatPolicyError, got ${String(caught)}`,
  );
  assert.strictEqual(
    (caught as FormatPolicyError).kind,
    "PLAIN_DECIMAL_OUT_OF_SCOPE",
    "MAX_VALUE must be rejected as PLAIN_DECIMAL_OUT_OF_SCOPE (overflow above 1e7 max_magnitude_exclusive)",
  );
});

test("T-A-006: formatNumberForEngine(Number.MIN_VALUE) throws PLAIN_DECIMAL_OUT_OF_SCOPE (subnormal)", () => {
  let caught: unknown;
  try {
    formatNumberForEngine(Number.MIN_VALUE);
  } catch (e) {
    caught = e;
  }
  assert.ok(
    caught instanceof FormatPolicyError,
    `expected FormatPolicyError, got ${String(caught)}`,
  );
  assert.strictEqual(
    (caught as FormatPolicyError).kind,
    "PLAIN_DECIMAL_OUT_OF_SCOPE",
    "Number.MIN_VALUE (~5e-324 subnormal) must be rejected as PLAIN_DECIMAL_OUT_OF_SCOPE (below 1e-9 floor)",
  );
});

// =============================================================================
// Property 4: scientific boundary
// =============================================================================

test("T-A-006: doubles at exactly 1e-9 round to '0.00000000100000000'", () => {
  assert.strictEqual(
    formatNumberForEngine(1e-9),
    "0.00000000100000000",
    "1e-9 is the smallest in-scope magnitude; canonical 9-sig-fig form",
  );
});

test("T-A-006 (v0.3): doubles at 1e-14 (well below 1e-12) throw PLAIN_DECIMAL_OUT_OF_SCOPE", () => {
  // v0.3 widened the user-intent floor from 1e-9 to 1e-12 to admit
  // hybrid-tolerance atol=1e-12. The pre-round check accepts down to
  // leading-exponent -13 to admit IEEE-754 representation of 1e-12
  // (which dips to ~9.99...e-13). So genuine OUT_OF_SCOPE starts at 1e-14.
  let caught: unknown;
  try {
    formatNumberForEngine(1e-14);
  } catch (e) {
    caught = e;
  }
  assert.ok(
    caught instanceof FormatPolicyError,
    `expected FormatPolicyError, got ${String(caught)}`,
  );
  assert.strictEqual(
    (caught as FormatPolicyError).kind,
    "PLAIN_DECIMAL_OUT_OF_SCOPE",
    "1e-14 is below the v0.3 floor (accepts down to -13); must throw OUT_OF_SCOPE",
  );
});

test("T-A-006 (v0.3): doubles previously OUT_OF_SCOPE in v0.1/v0.2 (1e-10) now format cleanly", () => {
  // Regression-by-evolution: this test pins the v0.3 widening.
  const result = formatNumberForEngine(1e-10);
  assert.match(
    result,
    /^0\.0+1[0-9]*$/,
    `expected canonical plain-decimal expansion of 1e-10, got ${result}`,
  );
});

test("T-A-006: doubles at 9.999999e6 (just inside 1e7 ceiling) round to fixed form", () => {
  // The result must be a plain decimal (no `e`/`E`) and parse back to a
  // double very close to the input — exact-string assertion is brittle
  // against HTE rounding choices on the trailing digit, so we assert
  // shape + bounded round-trip drift instead.
  const formatted = formatNumberForEngine(9.999999e6);
  assert.ok(
    !/[eE]/.test(formatted),
    `expected plain-decimal (no scientific), got ${JSON.stringify(formatted)}`,
  );
  const parsed = parseFloat(formatted);
  assert.ok(
    Number.isFinite(parsed),
    `parseFloat(${JSON.stringify(formatted)}) returned ${parsed}`,
  );
  assert.ok(
    Math.abs(parsed - 9.999999e6) <= 1, // 9-sig-fig precision near 1e7 leaves ~1.0 absolute room
    `9.999999e6 round-trip drift too large: |${parsed} - 9.999999e6| = ${Math.abs(parsed - 9.999999e6)}`,
  );
});

test("T-A-006: doubles at 1.000001e7 (just above 1e7 ceiling) throw PLAIN_DECIMAL_OUT_OF_SCOPE", () => {
  let caught: unknown;
  try {
    formatNumberForEngine(1.000001e7);
  } catch (e) {
    caught = e;
  }
  assert.ok(
    caught instanceof FormatPolicyError,
    `expected FormatPolicyError, got ${String(caught)}`,
  );
  assert.strictEqual(
    (caught as FormatPolicyError).kind,
    "PLAIN_DECIMAL_OUT_OF_SCOPE",
    "1.000001e7 sits above the 1e7 max_magnitude_exclusive; must throw OUT_OF_SCOPE",
  );
});

// =============================================================================
// Bonus: scientificToPlain is an inverse-of-toPrecision over fuzzed doubles
// =============================================================================

test(
  `T-A-006: scientificToPlain(toPrecision(17)) parses back to the same double (${FUZZ_ITERATIONS} doubles)`,
  () => {
    for (let i = 0; i < FUZZ_ITERATIONS; i++) {
      const x = randomDoubleInRange();
      const sci = x.toPrecision(17);
      // toPrecision may return either scientific or fixed; only feed
      // scientific into scientificToPlain (skip fixed-form outputs,
      // they're not the property under test).
      if (!/[eE]/.test(sci)) continue;
      const plain = scientificToPlain(sci);
      const back = parseFloat(plain);
      assert.strictEqual(
        back,
        x,
        `scientificToPlain inverse drift on x=${x}: sci=${JSON.stringify(sci)} plain=${JSON.stringify(plain)} parsed=${back}`,
      );
    }
  },
);
