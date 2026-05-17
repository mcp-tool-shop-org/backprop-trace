/**
 * Determinism canary tests (Agent E's recommendation from
 * consolidator-decision §5/§7 risk 4).
 *
 * The determinism thesis from research-grounding.md: receipts are
 * byte-equal-reproducible across CI matrix cells (currently Linux/macOS/
 * Windows × Node 22.x), and the engine's only floating-point transcendentals
 * are Math.exp (in sigmoid) and Math.tanh (not currently used but listed
 * as historically drift-prone in V8).
 *
 * These tests are CI canaries: they pin a small set of Math.exp / Math.tanh
 * constants to the exact bytes Node 22 produces. If a future Node bump
 * (or an alternate runtime — Bun/Deno — that the v0.4 thesis explicitly
 * defers) changes Math.exp's IEEE-754 rounding at these inputs, the CI
 * pipeline goes red BEFORE drift sneaks into a regenerated golden fixture.
 *
 * Constants were captured on Node 22.21.1 (the version pinned in the CI
 * matrix; will also pass on the new 22.11.0 matrix cell Agent H is adding).
 *
 * Why this is doc-only-plus-canary, not a determinism wave: per §3
 * "What NOT to build yet," polynomial Math.exp / decimal.js / Bun/Deno
 * matrix would force the verifier into thesis-changing territory. The
 * v0.4 move is to surface drift loudly via a canary, not to engineer
 * around it.
 */

import { test } from "node:test"
import assert from "node:assert/strict"

// Sanity: Math.exp(0) == 1 exactly. If this fails, the JS runtime itself
// is broken — the test serves as a witness for "the rest of the canary
// assertions are meaningful."
test("Math.exp(0) === 1 (sanity)", () => {
  assert.strictEqual(Math.exp(0), 1, "Math.exp(0) must be exactly 1")
})

// Math.exp(-0.5) — the canary Agent E recommended (consolidator §5/§7
// risk 4). The expected literal is the exact double Node 22.21.1 emits.
// Captured 2026-05-16 on Windows Node 22.21.1.
test("Math.exp(-0.5) === recorded-constant (Agent E's Math.exp canary)", () => {
  const expected = 0.6065306597126334
  const actual = Math.exp(-0.5)
  assert.strictEqual(
    actual,
    expected,
    `Math.exp(-0.5) drifted from the v0.4 canary value. Got ${actual}; ` +
      `expected ${expected}. If this fails on a new runtime version, ` +
      `regenerate ALL golden fixtures + re-validate byte-equal reproducibility ` +
      `BEFORE landing the canary update. Per consolidator-decision §3 and ` +
      `§7 risk 4, do NOT implement polynomial Math.exp or decimal.js as a ` +
      `workaround — that would erode the verifier-neutrality thesis.`,
  )
})

// Math.exp(1) — Euler's number canary. Same drift surface as exp(-0.5);
// pinned independently because the exp implementation may diverge at
// different magnitudes via different polynomial-approximation regions.
test("Math.exp(1) === recorded-constant (Euler's number canary)", () => {
  const expected = 2.718281828459045
  const actual = Math.exp(1)
  assert.strictEqual(
    actual,
    expected,
    `Math.exp(1) drifted from the v0.4 canary value. Got ${actual}; ` +
      `expected ${expected}. See Math.exp(-0.5) canary failure-handling notes.`,
  )
})

// Math.tanh(0.1) — Agent E mentioned tanh is historically drift-prone in
// V8 (its polynomial approximation has been retuned more than once across
// V8 versions). Pin it as an additional witness even though the v0.4
// engine doesn't currently use tanh — the canary protects the v0.5+
// activation-extension path before it lands.
test("Math.tanh(0.1) === recorded-constant (V8 tanh drift canary)", () => {
  const expected = 0.09966799462495582
  const actual = Math.tanh(0.1)
  assert.strictEqual(
    actual,
    expected,
    `Math.tanh(0.1) drifted from the v0.4 canary value. Got ${actual}; ` +
      `expected ${expected}. tanh is historically drift-prone in V8; ` +
      `update this canary in concert with any tanh-activation engine path ` +
      `landing (v0.5+).`,
  )
})

// =============================================================================
// v0.5 — softmax+CE canary expansion.
// =============================================================================
//
// The v0.5 softmax+CE engine path uses Math.exp + Math.log + softmax-stable
// arithmetic (subtract max, exp each, sum, divide). The canary pins:
//   - Math.exp(0.5) — a positive-side exp value (negative-side covered above
//     by Math.exp(-0.5))
//   - The exact exp values softmax computes on the SOFTMAX_CE_INPUT logit
//     triple (z_o1=0.874615042, z_o2=0.386575513, z_o3=0.630595278) after
//     subtracting max(z) = z_o1. These three exp() calls drive the softmax
//     normalization that the golden fixture pins.
//   - Math.log of p_o1 in the same fixture — the CE per_output[o1] formula
//     value. If Math.log drifts at the softmax probability magnitude,
//     loss.per_output.o1 + loss.total drift too.
//
// Captured 2026-05-17 on the same engine path that produced
// fixtures/softmax-ce.golden.jsonl.

test("Math.exp(0.5) === recorded-constant (softmax+CE positive-side canary)", () => {
  const expected = 1.6487212707001282
  const actual = Math.exp(0.5)
  assert.strictEqual(
    actual,
    expected,
    `Math.exp(0.5) drifted from the v0.5 canary value. Got ${actual}; ` +
      `expected ${expected}. The softmax+CE engine path depends on this value via the ` +
      `LSE-stable softmax intermediate computations. If this drifts, regenerate ALL ` +
      `softmax+CE goldens and re-pin this canary in one synchronized commit.`,
  )
})

test("softmax intermediate exp(z_o2 - z_max) === recorded-constant (softmax+CE LSE canary)", () => {
  // SOFTMAX_CE_INPUT logits: z_o1=0.874615042 (max), z_o2=0.386575513, z_o3=0.630595278.
  // softmax subtracts max(z) before exp; this is the o2 intermediate.
  const expected = 0.6138286085321776
  const actual = Math.exp(0.386575513 - 0.874615042)
  assert.strictEqual(
    actual,
    expected,
    `Softmax intermediate exp(z_o2 - z_max) drifted from the v0.5 canary value. ` +
      `Got ${actual}; expected ${expected}. fixtures/softmax-ce.golden.jsonl pins ` +
      `p_o2=0.256049895 which depends on this exp value. If this canary fires, ` +
      `regenerate softmax-ce.golden.jsonl AND every fixtures/bad/softmax-ce.bad-*.jsonl ` +
      `(via scripts/generate-softmax-ce-bad-fixtures.ts) in the same commit.`,
  )
})

test("Math.log(p_o1=0.4171...) === recorded-constant (cross_entropy_softmax canary)", () => {
  // p_o1 from fixtures/softmax-ce.golden.jsonl. CE loss formula evaluates
  // -y_o1 * log(p_o1) at this exact magnitude. The golden's loss.total
  // is the negation of this Math.log call (since y_o1=1, y_o2=y_o3=0).
  const expected = -0.8743434200428728
  const actual = Math.log(0.41713581279921863)
  assert.strictEqual(
    actual,
    expected,
    `Math.log at the softmax+CE probability magnitude drifted from the v0.5 canary. ` +
      `Got ${actual}; expected ${expected}. fixtures/softmax-ce.golden.jsonl pins ` +
      `loss.per_output.o1=0.874343420 and loss.total=0.874343420 which depend on this ` +
      `Math.log value (formula: -y * log(p) with y_o1=1).`,
  )
})
