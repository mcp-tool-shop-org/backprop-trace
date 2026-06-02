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

// =============================================================================
// VERIFIER-OWNED TOLERANCE CEILINGS (G-001 / G-002 / family-of-call-sites)
//
// THREAT: the receipt under judgement must NOT control the strictness of the
// check that judges it. A receipt with corrupted math can set
// numeric_policy.tolerance = {atol: 1e9, rtol: 1e9} and — absent a clamp —
// EVERY numeric rule passes (false PASS, the worst defect for an inverted
// threat model). Same attack via attestor.differential_tolerance defeats
// Rule 14 (the only math gate on observer-mode imports).
//
// Verifier-owned ceilings (see CEILING constants in src/reconcile.ts):
//   numeric_policy.tolerance:           atol <= 1e-8,  rtol <= 1e-6
//   attestor.differential_tolerance:    atol <= 1e-5,  rtol <= 1e-3
//
// These were TIGHTENED from the original (1e-6/1e-3 numeric, 1e-3/1e-2
// differential) because an at-ceiling tolerance under the old, looser values
// laundered a real ~1e-5 relative corruption into a clean PASS. The new
// ceilings sit ONE order of magnitude above the legit corpus maxima (corpus
// max atol 1e-9 scalar / 1e-11 object / rtol 1e-7 numeric; atol 1e-6 / rtol
// 1e-4 differential) — enough headroom for honest framework FP drift, tight
// enough that canonical ~1e-5 corruptions are now caught.
// =============================================================================

import { existsSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"
import {
  reconcileReceipt,
  clampTolerancePolicy,
  isValidTolerancePolicy,
  NUMERIC_TOLERANCE_CEILING,
  DIFFERENTIAL_TOLERANCE_CEILING,
} from "../src/reconcile.js"

const __ceilDir = dirname(fileURLToPath(import.meta.url))
const __repoRoot = resolve(__ceilDir, "..")

function loadBad(name: string): unknown {
  const p = resolve(__repoRoot, `fixtures/bad/${name}`)
  if (!existsSync(p)) throw new Error(`fixture not found: ${p}`)
  return JSON.parse(readFileSync(p, "utf-8").trim())
}

// ---- clampTolerancePolicy unit behavior (non-vacuity anchor) ----------------

test("clampTolerancePolicy: loose object tolerance is reported as exceeding the ceiling and clamped down", () => {
  const r = clampTolerancePolicy({ atol: 1e9, rtol: 1e9 }, NUMERIC_TOLERANCE_CEILING)
  assert.strictEqual(r.exceeded, true, "{1e9,1e9} must be flagged exceeded")
  // effective is clamped to the ceiling — never looser than the verifier allows.
  const eff = typeof r.effective === "number"
    ? { atol: r.effective, rtol: 0 }
    : r.effective
  assert.ok(
    eff.atol <= NUMERIC_TOLERANCE_CEILING.atol + 0,
    `clamped atol ${eff.atol} must be <= ceiling atol ${NUMERIC_TOLERANCE_CEILING.atol}`,
  )
  assert.ok(
    eff.rtol <= NUMERIC_TOLERANCE_CEILING.rtol + 0,
    `clamped rtol ${eff.rtol} must be <= ceiling rtol ${NUMERIC_TOLERANCE_CEILING.rtol}`,
  )
})

test("clampTolerancePolicy: a legit-corpus-tight tolerance passes through unchanged (not exceeded)", () => {
  // legit corpus max is atol 1e-11 / rtol 1e-7 — well under the ceiling.
  const r = clampTolerancePolicy({ atol: 1e-11, rtol: 1e-7 }, NUMERIC_TOLERANCE_CEILING)
  assert.strictEqual(r.exceeded, false, "tight legit tolerance must NOT be flagged exceeded")
  assert.deepStrictEqual(r.effective, { atol: 1e-11, rtol: 1e-7 })
})

test("clampTolerancePolicy: negative axis is flagged (negative tolerance is nonsense)", () => {
  const r = clampTolerancePolicy({ atol: -1, rtol: 0 }, NUMERIC_TOLERANCE_CEILING)
  assert.strictEqual(r.negative, true, "negative atol must set negative=true")
})

test("clampTolerancePolicy: scalar form is bounded by the atol ceiling", () => {
  const r = clampTolerancePolicy(1e9, NUMERIC_TOLERANCE_CEILING)
  assert.strictEqual(r.exceeded, true, "scalar 1e9 maps to {atol:1e9,rtol:0} and exceeds")
})

// ---- isValidTolerancePolicy must reject negatives (G-001 spirit) ------------

test("isValidTolerancePolicy rejects a negative scalar tolerance", () => {
  assert.strictEqual(
    isValidTolerancePolicy(-1e-9),
    false,
    "a negative scalar tolerance is structurally invalid (would widen every check)",
  )
})

test("isValidTolerancePolicy rejects an object tolerance with a negative axis", () => {
  assert.strictEqual(isValidTolerancePolicy({ atol: -1e-12, rtol: 0 }), false)
  assert.strictEqual(isValidTolerancePolicy({ atol: 0, rtol: -1e-9 }), false)
})

test("isValidTolerancePolicy still accepts legit zero and positive tolerances", () => {
  assert.strictEqual(isValidTolerancePolicy(0), true)
  assert.strictEqual(isValidTolerancePolicy(1e-12), true)
  assert.strictEqual(isValidTolerancePolicy({ atol: 0, rtol: 0 }), true)
  assert.strictEqual(isValidTolerancePolicy({ atol: 1e-11, rtol: 1e-7 }), true)
})

// ---- G-001: numeric_policy.tolerance cannot be widened to launder bad math --

test("G-001: bad-gradient receipt with absurdly loose object tolerance is STILL rejected (Rule 0 ceiling)", () => {
  const receipt = loadBad("xor.bad-bias-gradient.jsonl") as {
    numeric_policy: { tolerance: unknown }
  }
  // The fixture's REAL gradient error is ~1e-6. Try to swallow it by setting
  // a tolerance 15 orders of magnitude above the verifier ceiling.
  receipt.numeric_policy.tolerance = { atol: 1e9, rtol: 1e9 }
  const result = reconcileReceipt(receipt)
  assert.strictEqual(
    result.ok,
    false,
    "receipt-supplied tolerance must NOT control the strictness of the check that judges it — " +
      "a corrupted receipt with {atol:1e9,rtol:1e9} must still be REJECTED",
  )
  if (result.ok) return
  const rule0 = result.failures.find(
    (f) =>
      f.rule === 0 &&
      /tolerance/i.test(f.field_path) &&
      /verifier maximum|ceiling|exceeds/i.test(f.message ?? ""),
  )
  assert.ok(
    rule0,
    `expected a Rule 0 structural failure naming the tolerance ceiling; got: ${JSON.stringify(
      result.failures.map((f) => ({ rule: f.rule, field_path: f.field_path, message: f.message })),
    )}`,
  )
})

test("G-001: bad-gradient receipt with absurdly loose SCALAR tolerance is STILL rejected", () => {
  const receipt = loadBad("xor.bad-bias-gradient.jsonl") as {
    numeric_policy: { tolerance: unknown }
  }
  receipt.numeric_policy.tolerance = 1e9
  const result = reconcileReceipt(receipt)
  assert.strictEqual(
    result.ok,
    false,
    "scalar tolerance 1e9 maps to {atol:1e9,rtol:0} and must be caught by the atol ceiling",
  )
  if (result.ok) return
  assert.ok(
    result.failures.some(
      (f) => f.rule === 0 && /tolerance/i.test(f.field_path),
    ),
    "expected a Rule 0 tolerance-ceiling failure",
  )
})

test("G-001: negative numeric_policy.tolerance is rejected as a structural failure", () => {
  const receipt = loadBad("xor.bad-bias-gradient.jsonl") as {
    numeric_policy: { tolerance: unknown }
  }
  // A negative tolerance would make |a-b| <= negative impossible to satisfy
  // for the honest case but, combined with rtol, is pure nonsense that must
  // never reach a rule. isValidTolerancePolicy must reject it up front.
  receipt.numeric_policy.tolerance = { atol: -1, rtol: 0 }
  const result = reconcileReceipt(receipt)
  assert.strictEqual(result.ok, false, "negative tolerance must be rejected")
  if (result.ok) return
  assert.ok(
    result.failures.some(
      (f) => f.rule === 0 && f.field_path === "numeric_policy.tolerance",
    ),
    "expected the existing Rule 0 malformed-tolerance failure to fire on a negative axis",
  )
})

test("G-001: a legit tight tolerance at the corpus max still reconciles a GOOD receipt ok:true", () => {
  // Anti-vacuity for the clamp: the ceiling must not break honest receipts.
  // The Mazur golden uses scalar 1e-9 (well under the 1e-8 atol ceiling — wait,
  // 1e-9 < 1e-8, so it remains under the TIGHTENED ceiling with headroom).
  const goldenPath = resolve(__repoRoot, "fixtures/mazur.golden.jsonl")
  const golden = JSON.parse(readFileSync(goldenPath, "utf-8").trim()) as {
    numeric_policy: { tolerance: unknown }
  }
  // Tighten to the legit-corpus max to prove headroom: atol 1e-11 / rtol 1e-7.
  golden.numeric_policy.tolerance = { atol: 1e-11, rtol: 1e-7 }
  const result = reconcileReceipt(golden)
  assert.strictEqual(
    result.ok,
    true,
    `legit golden at corpus-max tolerance must still pass after the clamp; got: ${
      result.ok === false
        ? JSON.stringify(result.failures.map((f) => ({ rule: f.rule, field_path: f.field_path })))
        : "ok"
    }`,
  )
})

// ---- FIX-1: the TIGHTENED ceiling closes the at-ceiling laundering of a ~1e-5
// relative corruption (the residual false-PASS that survived the first wave) ---
//
// THREAT (residual false-PASS): with the OLD numeric ceiling {atol:1e-6,
// rtol:1e-3}, a corrupted receipt could declare its tolerance AT that ceiling.
// At rtol 1e-3 the applied tolerance on an O(0.1) field is ~1.5e-4 — which
// SWALLOWS a real ~1e-5 relative corruption (absolute ~1.5e-6), turning a
// REJECT into a clean PASS. The first-wave clamp DID stop {atol:1e9,rtol:1e9},
// but it left the at-ceiling laundering open because the ceiling itself was too
// loose. FIX-1 tightens the ceiling to {atol:1e-8, rtol:1e-6} (one order above
// the corpus max), so (a) the old-ceiling tolerance is now itself rejected by
// Rule 0, and (b) even the new at-ceiling tolerance no longer swallows ~1e-5.
//
// MUTATION THAT MAKES THIS RED: revert NUMERIC_TOLERANCE_CEILING in
// src/reconcile.ts back to {atol:1e-6, rtol:1e-3}. Then the first assertion
// goes RED — at the old ceiling, a receipt-declared {atol:1e-6,rtol:1e-3} is
// at-ceiling (not "exceeded"), Rule 0 stays silent, and rtol 1e-3 swallows the
// ~1e-5 corruption → reconcileReceipt returns ok:true.
test("FIX-1: a ~1e-5 relative corruption is NOT launderable — old-ceiling tolerance is rejected, new at-ceiling tolerance still catches it", () => {
  const goldenPath = resolve(__repoRoot, "fixtures/mazur.golden.jsonl")
  const base = JSON.parse(readFileSync(goldenPath, "utf-8").trim()) as {
    numeric_policy: { tolerance: unknown }
    updates: Array<{ weight_after: number }>
  }

  // Inject a single ~1e-5 RELATIVE corruption on an O(0.1)-magnitude field:
  // updates[0].weight_after. This breaks Rule 6 (weight_after ==
  // weight_before + update) by an absolute ~1.5e-6 (= 0.15 * 1e-5).
  const corrupt = JSON.parse(JSON.stringify(base)) as typeof base
  const honest = corrupt.updates[0]!.weight_after
  corrupt.updates[0]!.weight_after = honest * (1 + 1e-5)

  // (1) Old-ceiling tolerance {atol:1e-6, rtol:1e-3} — the value that USED to
  // launder this corruption — now EXCEEDS the tightened ceiling and must be
  // rejected up front with a Rule 0 tolerance-ceiling failure. (Under the old
  // ceiling this same tolerance was at-ceiling and swallowed the corruption.)
  {
    const r = JSON.parse(JSON.stringify(corrupt)) as typeof base
    r.numeric_policy.tolerance = { atol: 1e-6, rtol: 1e-3 }
    const result = reconcileReceipt(r)
    assert.strictEqual(
      result.ok,
      false,
      "old-ceiling tolerance {atol:1e-6,rtol:1e-3} must now be REJECTED — it exceeds the " +
        "tightened verifier ceiling and was the exact value that laundered the ~1e-5 corruption",
    )
    if (result.ok) return
    assert.ok(
      result.failures.some(
        (f) =>
          f.rule === 0 &&
          f.field_path === "numeric_policy.tolerance" &&
          /verifier maximum|ceiling|exceeds/i.test(f.message ?? ""),
      ),
      `expected a Rule 0 tolerance-ceiling failure naming numeric_policy.tolerance; got: ${JSON.stringify(
        result.failures.map((f) => ({ rule: f.rule, field_path: f.field_path })),
      )}`,
    )
  }

  // (2) New AT-CEILING tolerance {atol:1e-8, rtol:1e-6} is valid (inclusive
  // maximum) so the numeric rules RUN — and the ~1e-5 corruption now exceeds
  // the applied tolerance (max(1e-8, 1e-6*0.15) ≈ 1.5e-7 < absolute 1.5e-6),
  // so Rule 6 fires. The corruption can no longer hide behind any allowed
  // tolerance.
  {
    const r = JSON.parse(JSON.stringify(corrupt)) as typeof base
    r.numeric_policy.tolerance = { atol: 1e-8, rtol: 1e-6 }
    const result = reconcileReceipt(r)
    assert.strictEqual(
      result.ok,
      false,
      "a ~1e-5 relative corruption must be REJECTED even at the new at-ceiling tolerance " +
        "{atol:1e-8,rtol:1e-6} — the tightened ceiling leaves no allowed tolerance that swallows it",
    )
    if (result.ok) return
    assert.ok(
      result.failures.some((f) => f.rule === 6),
      `expected Rule 6 (weight_after == weight_before + update) to fire on the ~1e-5 corruption; got rules: ${[
        ...new Set(result.failures.map((f) => f.rule)),
      ]
        .sort((a, b) => a - b)
        .join(",")}`,
    )
  }
})

// FIX-1 anti-vacuity: the HONEST golden at the new at-ceiling tolerance still
// reconciles ok:true (the tightened ceiling does not break a clean receipt).
test("FIX-1: honest golden at the new at-ceiling tolerance {atol:1e-8,rtol:1e-6} still passes (anti-vacuity)", () => {
  const goldenPath = resolve(__repoRoot, "fixtures/mazur.golden.jsonl")
  const golden = JSON.parse(readFileSync(goldenPath, "utf-8").trim()) as {
    numeric_policy: { tolerance: unknown }
  }
  golden.numeric_policy.tolerance = { atol: 1e-8, rtol: 1e-6 }
  const result = reconcileReceipt(golden)
  assert.strictEqual(
    result.ok,
    true,
    `honest golden at the at-ceiling tolerance must pass (inclusive maximum); got: ${
      result.ok === false
        ? JSON.stringify(result.failures.map((f) => ({ rule: f.rule, field_path: f.field_path })))
        : "ok"
    }`,
  )
})

// ---- G-002: attestor.differential_tolerance cannot defeat Rule 14 -----------

test("G-002: external receipt with absurdly loose differential_tolerance — Rule 14 STILL fires", () => {
  const receipt = loadBad("external.bad-collapsed-laundered.jsonl") as {
    attestor: { differential_tolerance: unknown }
  }
  // The forged signal_value diverges from engine recompute by ~0.5. Try to
  // swallow it by widening the differential tolerance far past the ceiling.
  receipt.attestor.differential_tolerance = { atol: 1e9, rtol: 1e9 }
  const result = reconcileReceipt(receipt)
  assert.strictEqual(
    result.ok,
    false,
    "attestor.differential_tolerance is the receipt's own claim — it must NOT be allowed to " +
      "widen Rule 14 past the verifier's differential ceiling",
  )
  if (result.ok) return
  const rule14 = result.failures.filter((f) => f.rule === 14)
  assert.ok(
    rule14.length >= 1,
    `Rule 14 must still fire despite the loose differential_tolerance; got rules: ${[
      ...new Set(result.failures.map((f) => f.rule)),
    ]
      .sort((a, b) => a - b)
      .join(",")}`,
  )
})

test("G-002: differential ceiling has headroom — observer golden with framework-tight diffTol still ok:true", () => {
  // Anti-vacuity for the differential clamp. The pytorch observer golden uses
  // differential_tolerance {atol:1e-6, rtol:1e-4} (legit corpus max), which is
  // under the differential ceiling. It must continue to reconcile cleanly.
  const goldenPath = resolve(
    __repoRoot,
    "fixtures/external/pytorch.softmax-ce.golden.jsonl",
  )
  if (!existsSync(goldenPath)) return
  const golden = JSON.parse(readFileSync(goldenPath, "utf-8").trim())
  const result = reconcileReceipt(golden)
  assert.strictEqual(
    result.ok,
    true,
    `observer golden at corpus-max differential_tolerance must still pass after the clamp; got: ${
      result.ok === false
        ? JSON.stringify(result.failures.map((f) => ({ rule: f.rule, field_path: f.field_path })))
        : "ok"
    }`,
  )
})

test("DIFFERENTIAL/NUMERIC ceilings are exported and ordered as documented", () => {
  // Pin the documented (TIGHTENED) ceilings so a silent loosening surfaces here.
  // A regression that loosens these back toward the old 1e-6/1e-3 numeric or
  // 1e-3/1e-2 differential values re-opens the at-ceiling laundering hole.
  assert.strictEqual(NUMERIC_TOLERANCE_CEILING.atol, 1e-8)
  assert.strictEqual(NUMERIC_TOLERANCE_CEILING.rtol, 1e-6)
  assert.strictEqual(DIFFERENTIAL_TOLERANCE_CEILING.atol, 1e-5)
  assert.strictEqual(DIFFERENTIAL_TOLERANCE_CEILING.rtol, 1e-3)
})
