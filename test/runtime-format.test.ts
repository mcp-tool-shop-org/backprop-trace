import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatNumberForEngine,
  scientificToPlain,
} from "../src/runtime-format.js";
import { FormatPolicyError } from "../src/format.js";

// =============================================================================
// formatNumberForEngine — happy path
// =============================================================================

type HappyCase = { name: string; input: number; expected: string };

const happyCases: HappyCase[] = [
  { name: "tolerance magnitude 1e-9",                 input:  1e-9,                  expected:  "0.00000000100000000" },
  { name: "tight 17-digit mantissa at 1e-9 boundary", input:  1.2345678901234567e-9, expected:  "0.00000000123456789" },
  { name: "negative tolerance magnitude",             input: -1e-9,                  expected: "-0.00000000100000000" },
  { name: "half",                                     input:  0.5,                   expected:  "0.500000000" },
  { name: "negative zero normalized to positive",     input: -0,                     expected:  "0.000000000" },
  { name: "positive zero",                            input:  0,                     expected:  "0.000000000" },
  { name: "unit",                                     input:  1,                     expected:  "1.00000000" },
  { name: "Mazur out_h1 round-trip identity",         input:  0.593269992,           expected:  "0.593269992" },
];

for (const c of happyCases) {
  test(`formatNumberForEngine(${String(c.input)}) [${c.name}] -> ${JSON.stringify(c.expected)}`, () => {
    assert.strictEqual(formatNumberForEngine(c.input), c.expected);
  });
}

// =============================================================================
// formatNumberForEngine — out-of-scope is policy's responsibility
// =============================================================================

test("formatNumberForEngine(1e7) throws PLAIN_DECIMAL_OUT_OF_SCOPE (at max_magnitude_exclusive)", () => {
  let caught: unknown;
  try {
    formatNumberForEngine(1e7);
  } catch (e) {
    caught = e;
  }
  if (!(caught instanceof FormatPolicyError)) {
    throw new Error(`Expected FormatPolicyError, got ${String(caught)}`);
  }
  assert.strictEqual(caught.kind, "PLAIN_DECIMAL_OUT_OF_SCOPE");
});

test("formatNumberForEngine(1e-14) throws PLAIN_DECIMAL_OUT_OF_SCOPE (v0.3: below 1e-12 min_magnitude)", () => {
  // v0.3 widened the user-intent floor from 1e-9 to 1e-12. The actual
  // pre-round check accepts leading-exponent down to -13 to admit IEEE-754
  // 1e-12 representation (which dips to ~9.99...e-13). So the new boundary
  // for guaranteed OUT_OF_SCOPE is 1e-14 or smaller.
  let caught: unknown;
  try {
    formatNumberForEngine(1e-14);
  } catch (e) {
    caught = e;
  }
  if (!(caught instanceof FormatPolicyError)) {
    throw new Error(`Expected FormatPolicyError, got ${String(caught)}`);
  }
  assert.strictEqual(caught.kind, "PLAIN_DECIMAL_OUT_OF_SCOPE");
});

// =============================================================================
// formatNumberForEngine — non-finite inputs rejected before policy
// =============================================================================

test("formatNumberForEngine(NaN) throws non-finite error", () => {
  let caught: unknown;
  try {
    formatNumberForEngine(NaN);
  } catch (e) {
    caught = e;
  }
  assert.ok(caught instanceof Error, "must throw");
  assert.match((caught as Error).message, /not finite/);
});

test("formatNumberForEngine(Infinity) throws non-finite error", () => {
  let caught: unknown;
  try {
    formatNumberForEngine(Infinity);
  } catch (e) {
    caught = e;
  }
  assert.ok(caught instanceof Error, "must throw");
  assert.match((caught as Error).message, /not finite/);
});

test("formatNumberForEngine(-Infinity) throws non-finite error", () => {
  let caught: unknown;
  try {
    formatNumberForEngine(-Infinity);
  } catch (e) {
    caught = e;
  }
  assert.ok(caught instanceof Error, "must throw");
});

// =============================================================================
// formatNumberForEngine — input-form equivalence
// =============================================================================

test("formatNumberForEngine(1e-9) === formatNumberForEngine(0.000000001) (same double)", () => {
  assert.strictEqual(formatNumberForEngine(1e-9), formatNumberForEngine(0.000000001));
});

// =============================================================================
// scientificToPlain — unit tests for the expander itself
// =============================================================================

type ScientificCase = { name: string; input: string; expected: string };

const scientificCases: ScientificCase[] = [
  { name: "tolerance toPrecision(17) output",     input:  "1.0000000000000000e-9", expected:  "0.0000000010000000000000000" },
  { name: "compact 1e-9",                          input:  "1e-9",                  expected:  "0.000000001" },
  { name: "negative compact",                      input: "-1e-9",                  expected: "-0.000000001" },
  { name: "explicit positive exponent sign",       input:  "1.5e+3",                expected:  "1500" },
  { name: "implicit positive exponent",            input:  "1.5e3",                 expected:  "1500" },
  { name: "decimal lands inside digit stream",     input:  "1.234567e3",            expected:  "1234.567" },
  { name: "decimal lands at digit boundary",       input:  "1.234e3",               expected:  "1234" },
  { name: "small fraction with negative exponent", input:  "5.5e-2",                expected:  "0.055" },
  { name: "uppercase E accepted",                  input:  "1E-9",                  expected:  "0.000000001" },
];

for (const c of scientificCases) {
  test(`scientificToPlain(${JSON.stringify(c.input)}) [${c.name}] -> ${JSON.stringify(c.expected)}`, () => {
    assert.strictEqual(scientificToPlain(c.input), c.expected);
  });
}

test("scientificToPlain('0.5') throws (input is not in scientific notation)", () => {
  let caught: unknown;
  try {
    scientificToPlain("0.5");
  } catch (e) {
    caught = e;
  }
  assert.ok(caught instanceof Error, "must throw on non-scientific input");
});

test("scientificToPlain('') throws (empty input)", () => {
  let caught: unknown;
  try {
    scientificToPlain("");
  } catch (e) {
    caught = e;
  }
  assert.ok(caught instanceof Error, "must throw on empty input");
});

// =============================================================================
// T-A-014: scientificToPlain rejects exponents far outside binary64 range
// =============================================================================
//
// Binary64 has |exp10| < ~310; |exp| of 400+ is unreachable from any finite
// JS double — toPrecision(17) on a finite double never produces an exponent
// magnitude greater than ~308. A value with `|e| > 400` in scientific
// notation can only reach scientificToPlain via direct user mis-use of the
// helper or a malformed upstream pipeline. The function must reject it
// rather than allocate a string with hundreds of millions of leading zeros
// or carry an enormous decimal-position shift through to a downstream
// formatter. This pins the guard that the format agent is expected to add
// on top of the existing scientific-notation validator.

test(
  "T-A-014: scientificToPlain rejects exponent > 400 (1e500)",
  () => {
    let caught: unknown;
    try {
      // Construct a string by hand — JS Number cannot represent 1e500.
      scientificToPlain("1e500");
    } catch (e) {
      caught = e;
    }
    assert.ok(
      caught instanceof Error,
      `scientificToPlain('1e500') must throw (exp magnitude 500 > 400 guard); got no throw`,
    );
  },
);

test(
  "T-A-014: scientificToPlain rejects exponent < -400 (1e-500)",
  () => {
    let caught: unknown;
    try {
      scientificToPlain("1e-500");
    } catch (e) {
      caught = e;
    }
    assert.ok(
      caught instanceof Error,
      `scientificToPlain('1e-500') must throw (exp magnitude 500 > 400 guard); got no throw`,
    );
  },
);

test(
  "T-A-014: scientificToPlain rejects pathological exponent (1e10000)",
  () => {
    let caught: unknown;
    try {
      scientificToPlain("1e10000");
    } catch (e) {
      caught = e;
    }
    assert.ok(
      caught instanceof Error,
      `scientificToPlain('1e10000') must throw; allowing this would attempt to allocate ` +
        `a 10kdigit string and burn arbitrary memory on a malformed input`,
    );
  },
);
