/**
 * R14-PERSAMPLE-OMISSION — Stage A iteration-2 fix.
 *
 * A HIGH false-PASS-by-omission residual at the per-sample differential of a
 * BATCHED observer receipt. The per_sample loop in
 * checkRule14EngineRecomputeDifferential (reconcile.ts) iterated the ENGINE's
 * per-sample forward/loss keys and `continue`d / early-returned on a missing
 * RECEIPT entry instead of asserting key-set EQUALITY. So an
 * external_imported batched receipt could DROP a NESTED per_sample field —
 * per_sample[sid].forward.<u>.net / .out / the whole unit, or
 * per_sample[sid].loss.total / loss.per_output.<u> — and reconcileReceipt
 * returned ok:true.
 *
 *   - Rule 18 only checks the FLAT loss.per_sample scalar (not nested
 *     per_sample[sid].loss).
 *   - Rule 19 only checks the per_sample KEY SET equals batch.sample_order
 *     (catches a dropped WHOLE sample, NOT a dropped nested field).
 *
 * So this per-sample differential is the SOLE check on per-sample forward/loss
 * values. The fix mirrors the top-level forward ENG-2 completeness pattern:
 * key-set-EQUAL + both-scalars-present, raising rule:14 COMPLETENESS failures.
 *
 * NOTE on the gate under test: these tests assert on reconcileReceipt()
 * directly (the load-bearing math gate). Schema validation (validateReceiptSchema)
 * ALSO catches the dropped-scalar / dropped-loss.total variants via
 * ForwardUnit.required / Loss.required — that is welcome defense-in-depth — but
 * library callers may reconcile WITHOUT schema-validating, so reconcileReceipt
 * must fail closed on its own. The whole-unit-drop variant is permitted by
 * schema (ForwardMap is an open additionalProperties map) and is caught ONLY by
 * this fix.
 */

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"
import { reconcileReceipt } from "../src/reconcile.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, "..")

function loadBad(name: string): unknown {
  const p = resolve(repoRoot, `fixtures/bad/${name}.jsonl`)
  if (!existsSync(p)) throw new Error(`Fixture ${name} not found.`)
  return JSON.parse(readFileSync(p, "utf-8").trim())
}

function rulesOf(result: ReturnType<typeof reconcileReceipt>): number[] {
  return result.ok
    ? []
    : [...new Set(result.failures.map((f) => f.rule))].sort((a, b) => a - b)
}

// ============================================================================
// Variant 1: a NESTED per-sample forward scalar is dropped (s0.forward.h1.net).
// ============================================================================

test("R14-PERSAMPLE-OMISSION: dropping per_sample.s0.forward.h1.net is REJECTED by reconcile (Rule 14 COMPLETENESS)", () => {
  const r = loadBad("batch.bad-per-sample-forward-field-dropped")
  const result = reconcileReceipt(r)
  assert.strictEqual(
    result.ok,
    false,
    "a dropped per-sample forward scalar must be REJECTED — compareScalar early-returns on a non-number, so " +
      "the per-sample differential is the sole gate and must raise on absence rather than skip",
  )
  if (result.ok) return
  const rule14 = result.failures.filter((f) => f.rule === 14)
  assert.ok(
    rule14.length >= 1,
    `expected Rule 14 to fire on the dropped per-sample forward scalar; got rules: ${rulesOf(result).join(", ")}`,
  )
  const hit = rule14.find((f) => f.field_path === "per_sample.s0.forward.h1.net")
  assert.ok(
    hit,
    `Rule 14 must name per_sample.s0.forward.h1.net; got Rule 14 paths: ${JSON.stringify(
      rule14.map((f) => f.field_path),
    )}`,
  )
  assert.match(hit!.message ?? "", /COMPLETENESS/, "the failure must be a COMPLETENESS-class Rule 14 failure")
})

// ============================================================================
// Variant 2: a WHOLE per-sample forward unit is dropped (s0.forward.h1).
// Schema PERMITS this (open ForwardMap) — this fix is the sole gate.
// ============================================================================

test("R14-PERSAMPLE-OMISSION: dropping the whole per_sample.s0.forward.h1 unit is REJECTED by reconcile (Rule 14 COMPLETENESS, key-set-EQUAL)", () => {
  const r = loadBad("batch.bad-per-sample-forward-unit-dropped")
  const result = reconcileReceipt(r)
  assert.strictEqual(
    result.ok,
    false,
    "a dropped whole per-sample forward unit must be REJECTED — per_sample[sid].forward's key set must EQUAL the " +
      "engine's recomputed per-sample forward key set (a dropped sample is Rule 19's domain; a dropped nested unit is this fix's)",
  )
  if (result.ok) return
  const rule14 = result.failures.filter((f) => f.rule === 14)
  assert.ok(
    rule14.length >= 1,
    `expected Rule 14 to fire on the dropped per-sample forward unit; got rules: ${rulesOf(result).join(", ")}`,
  )
  const hit = rule14.find((f) => f.field_path === "per_sample.s0.forward.h1")
  assert.ok(
    hit,
    `Rule 14 must name the missing per_sample.s0.forward.h1 unit (key-set-EQUAL); got Rule 14 paths: ${JSON.stringify(
      rule14.map((f) => f.field_path),
    )}`,
  )
})

// ============================================================================
// Variant 3: a nested per-sample loss.total is dropped (s0.loss.total).
// ============================================================================

test("R14-PERSAMPLE-OMISSION: dropping per_sample.s0.loss.total is REJECTED by reconcile (Rule 14 COMPLETENESS)", () => {
  const r = loadBad("batch.bad-per-sample-loss-total-dropped")
  const result = reconcileReceipt(r)
  assert.strictEqual(
    result.ok,
    false,
    "a dropped per-sample loss.total must be REJECTED — compareScalar early-returns on absence, so the per-sample " +
      "differential must raise on a missing loss.total (Rule 18 checks only the FLAT loss.per_sample scalar, not nested per_sample[sid].loss)",
  )
  if (result.ok) return
  const rule14 = result.failures.filter((f) => f.rule === 14)
  assert.ok(
    rule14.length >= 1,
    `expected Rule 14 to fire on the dropped per-sample loss.total; got rules: ${rulesOf(result).join(", ")}`,
  )
  const hit = rule14.find((f) => f.field_path === "per_sample.s0.loss.total")
  assert.ok(
    hit,
    `Rule 14 must name per_sample.s0.loss.total; got Rule 14 paths: ${JSON.stringify(
      rule14.map((f) => f.field_path),
    )}`,
  )
})

// ============================================================================
// ANTI-VACUITY: the untouched batched golden still reconciles ok:true.
// If the completeness check false-fired on a COMPLETE per-sample map, this
// would go red — proving the new gate is not a blanket reject.
// ============================================================================

test("R14-PERSAMPLE-OMISSION anti-vacuity: the untouched batched golden still reconciles ok:true", () => {
  const goldenPath = resolve(
    repoRoot,
    "fixtures/external/pytorch.softmax-ce.batched.golden.jsonl",
  )
  if (!existsSync(goldenPath)) return
  const r = JSON.parse(readFileSync(goldenPath, "utf-8").trim())
  const result = reconcileReceipt(r)
  assert.strictEqual(
    result.ok,
    true,
    `the canonical batched golden has a COMPLETE per-sample forward/loss map and must stay green; failures: ${
      result.ok === false
        ? JSON.stringify(result.failures.map((f) => ({ rule: f.rule, field_path: f.field_path })))
        : "ok"
    }`,
  )
})

// ============================================================================
// CONTROL (already passing — keep green): forging a per-sample forward VALUE
// is caught by the existing per-sample differential (not by the completeness
// addition). Proves the value-comparison path is intact alongside the new
// omission path.
// ============================================================================

test("R14-PERSAMPLE-OMISSION control: forging per_sample.s0.forward.h1.net=999 is still caught (Rule 14 value differential)", () => {
  const goldenPath = resolve(
    repoRoot,
    "fixtures/external/pytorch.softmax-ce.batched.golden.jsonl",
  )
  if (!existsSync(goldenPath)) return
  const r = JSON.parse(readFileSync(goldenPath, "utf-8").trim())
  r.per_sample.s0.forward.h1.net = 999
  const result = reconcileReceipt(r)
  assert.strictEqual(result.ok, false, "a forged per-sample forward value must be REJECTED")
  if (result.ok) return
  const rule14 = result.failures.filter(
    (f) => f.rule === 14 && /^per_sample\..+\.forward\..+\.(net|out)$/.test(f.field_path),
  )
  assert.ok(
    rule14.length >= 1,
    `expected a Rule 14 per-sample forward value disagreement; got rules: ${rulesOf(result).join(", ")}`,
  )
})

// ============================================================================
// CONTROL (already passing — keep green): dropping a WHOLE per-sample (s0) is
// caught by Rule 19 (per_sample key set != batch.sample_order). Confirms the
// completeness fix does not REPLACE Rule 19's sample-set coherence.
// ============================================================================

test("R14-PERSAMPLE-OMISSION control: dropping the whole sample s0 is still caught by Rule 19", () => {
  const goldenPath = resolve(
    repoRoot,
    "fixtures/external/pytorch.softmax-ce.batched.golden.jsonl",
  )
  if (!existsSync(goldenPath)) return
  const r = JSON.parse(readFileSync(goldenPath, "utf-8").trim())
  delete r.per_sample.s0
  const result = reconcileReceipt(r)
  assert.strictEqual(result.ok, false, "a dropped whole sample must be REJECTED")
  if (result.ok) return
  const rule19 = result.failures.filter((f) => f.rule === 19)
  assert.ok(
    rule19.length >= 1,
    `expected Rule 19 to fire on the dropped whole sample; got rules: ${rulesOf(result).join(", ")}`,
  )
})
