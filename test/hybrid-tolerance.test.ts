/**
 * applyToleranceCheck + normalizeTolerance unit tests.
 *
 * Pins the v0.3 hybrid-tolerance primitive (memo §3) — the symmetric
 * max-form
 *
 *     |a - b| <= max(atol, rtol * max(|a|, |b|))
 *
 * that every reconciler rule routes through. Tests are written against
 * the exported `applyToleranceCheck` so a single change in formula or
 * threshold surfaces here before propagating downstream.
 *
 * Coverage:
 *   - atol-only path (small delta < atol, slightly-too-large delta ≥ atol).
 *   - rtol-only path (atol vanishingly small; rtol * magnitude dominates).
 *   - Non-finite poisoning (NaN / Infinity inputs return ok=false with
 *     isFinite=false sentinels).
 *   - Scalar-form legacy: `applyToleranceCheck(a, b, 1e-9)` must behave
 *     identically to `applyToleranceCheck(a, b, {atol: 1e-9, rtol: 0})` —
 *     v0.1/v0.2 byte-equal preservation.
 *   - normalizeTolerance(scalar) and normalizeTolerance(object) round-trip.
 */

import { test } from "node:test"
import assert from "node:assert/strict"
import { applyToleranceCheck, normalizeTolerance } from "../src/reconcile.js"

test("applyToleranceCheck(1.0, 1.0 + 5e-13, {atol: 1e-12, rtol: 0}) — sub-atol delta passes (atol-only path)", () => {
  // Pick a target delta strictly below atol so IEEE-754's representation
  // jitter on `1 + N - 1` (which lands within a few ulps of N) doesn't
  // push us past the threshold. The 5e-13 delta is half of atol — the
  // ulp jitter at magnitude 1 is ~2.22e-16, well below the safety margin.
  const r = applyToleranceCheck(1.0, 1.0 + 5e-13, { atol: 1e-12, rtol: 0 })
  assert.strictEqual(r.ok, true, "delta < atol must pass")
  assert.ok(
    r.delta > 0 && r.delta < 1e-12,
    `delta should land in (0, atol); got ${r.delta}`,
  )
  assert.strictEqual(
    r.appliedTolerance,
    1e-12,
    "appliedTolerance should equal atol when rtol=0",
  )
  assert.strictEqual(r.isFinite, true, "finite arithmetic")
})

test("applyToleranceCheck(1.0, 1.0 + 1.5e-12, {atol: 1e-12, rtol: 0}) — slightly over threshold fails", () => {
  const r = applyToleranceCheck(1.0, 1.0 + 1.5e-12, { atol: 1e-12, rtol: 0 })
  assert.strictEqual(
    r.ok,
    false,
    "delta > atol must fail when rtol=0 (no relative-scale rescue)",
  )
})

test("applyToleranceCheck(1000, 1000 + 1e-9, {atol: 1e-12, rtol: 1e-9}) — rtol dominates at large magnitude", () => {
  const r = applyToleranceCheck(1000, 1000 + 1e-9, { atol: 1e-12, rtol: 1e-9 })
  assert.strictEqual(
    r.ok,
    true,
    "rtol * max(|a|, |b|) = 1e-9 * 1000 = ~1e-6 must dominate atol=1e-12; 1e-9 < 1e-6",
  )
  // 1e-9 * 1000 in IEEE 754 is 1.000000000000001e-6 (not exactly 1e-6).
  // Pin proximity, not bit-equality.
  assert.ok(
    Math.abs(r.appliedTolerance - 1e-6) < 1e-15,
    `appliedTolerance should be ≈ max(atol, rtol*magnitude) = 1e-6; got ${r.appliedTolerance}`,
  )
  assert.strictEqual(r.isFinite, true)
})

test("applyToleranceCheck(NaN, 1, ...) — non-finite a returns ok=false with isFinite=false sentinel", () => {
  const r = applyToleranceCheck(NaN, 1, { atol: 1e-9, rtol: 0 })
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.isFinite, false, "isFinite sentinel must flip false")
  assert.ok(Number.isNaN(r.delta), "delta is NaN on non-finite poisoning")
  assert.strictEqual(
    r.appliedTolerance,
    0,
    "appliedTolerance is 0 (the documented sentinel) on non-finite path",
  )
})

test("applyToleranceCheck(Infinity, 1, ...) — non-finite a returns ok=false with isFinite=false sentinel", () => {
  const r = applyToleranceCheck(Infinity, 1, { atol: 1e-9, rtol: 0 })
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.isFinite, false)
})

test("applyToleranceCheck(1, NaN, ...) — non-finite b returns ok=false (symmetric)", () => {
  const r = applyToleranceCheck(1, NaN, { atol: 1e-9, rtol: 0 })
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.isFinite, false)
})

test("applyToleranceCheck(1, 1, 1e-9) — scalar form is sugar for {atol: 1e-9, rtol: 0}", () => {
  const r = applyToleranceCheck(1, 1, 1e-9)
  assert.strictEqual(r.ok, true, "delta=0 passes any atol")
  assert.strictEqual(r.delta, 0)
  assert.strictEqual(
    r.appliedTolerance,
    1e-9,
    "scalar 1e-9 normalizes to atol=1e-9, rtol=0 — appliedTolerance is atol",
  )
})

test("applyToleranceCheck — scalar vs object form on the same numbers agree byte-identically", () => {
  // Pin v0.1/v0.2 byte-equal preservation: a v0.1 receipt with
  // tolerance: 1e-9 (scalar) must reconcile identically to a v0.3 receipt
  // with tolerance: {atol: 1e-9, rtol: 0}.
  const cases: Array<[number, number]> = [
    [1.0, 1.0 + 5e-10],
    [1.0, 1.0 + 1.5e-9],
    [-0.5, -0.5 + 1e-10],
    [42, 42 + 1e-10],
  ]
  for (const [a, b] of cases) {
    const fromScalar = applyToleranceCheck(a, b, 1e-9)
    const fromObject = applyToleranceCheck(a, b, { atol: 1e-9, rtol: 0 })
    assert.strictEqual(
      fromScalar.ok,
      fromObject.ok,
      `scalar vs object 'ok' disagreement at (${a}, ${b})`,
    )
    assert.strictEqual(
      fromScalar.delta,
      fromObject.delta,
      `scalar vs object 'delta' disagreement at (${a}, ${b})`,
    )
    assert.strictEqual(
      fromScalar.appliedTolerance,
      fromObject.appliedTolerance,
      `scalar vs object 'appliedTolerance' disagreement at (${a}, ${b})`,
    )
  }
})

test("normalizeTolerance(scalar) === {atol: scalar, rtol: 0}", () => {
  assert.deepStrictEqual(normalizeTolerance(1e-9), { atol: 1e-9, rtol: 0 })
  assert.deepStrictEqual(normalizeTolerance(0), { atol: 0, rtol: 0 })
  assert.deepStrictEqual(normalizeTolerance(1e-12), { atol: 1e-12, rtol: 0 })
})

test("normalizeTolerance(object) round-trips both fields verbatim", () => {
  assert.deepStrictEqual(
    normalizeTolerance({ atol: 1e-12, rtol: 1e-9 }),
    { atol: 1e-12, rtol: 1e-9 },
  )
  assert.deepStrictEqual(
    normalizeTolerance({ atol: 0, rtol: 0 }),
    { atol: 0, rtol: 0 },
  )
})
