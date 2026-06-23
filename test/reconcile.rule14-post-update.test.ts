/**
 * ENG-1 + ENG-2 — Rule 14 post-update + forward-map completeness.
 *
 * Two false-PASS holes in checkRule14EngineRecomputeDifferential, both the same
 * meta-pattern (a gated/looped differential check SILENTLY SKIPS absent fields):
 *
 *   ENG-1 (post-update completeness): the differential re-runs the engine and
 *   compares forward / loss / backward / updates / parameters_after — but NEVER
 *   the engine's recomputed post_update_forward.units or post_update_loss
 *   (per_output + total). So an external_imported receipt could fabricate
 *   post_update_loss.total, any post_update_forward.<u>.{net,out}, or any
 *   post_update_loss.per_output[u] and still reconcile ok:true. A receipt that
 *   DECLARES post_update_forward but DROPS a unit must also FAIL completeness.
 *
 *   ENG-2 (forward-map completeness): the forward loop iterated the ENGINE's
 *   keys with `if (!eUnit || !rUnit) continue`, so a forward unit ABSENT from
 *   the receipt (drop forward.o1) — or present with only `out` (drop
 *   forward.o1.net) — was silently skipped → false PASS.
 *
 * THE FIX mirrors the FIX-2 key-set-EQUAL discipline already applied to
 * updates / parameters_after: the receipt's forward (and post_update_forward /
 * post_update_loss) key sets must EQUAL the engine's recomputed key sets, each
 * forward/post-update unit must carry BOTH net and out, and every comparison
 * flows through the SAME verifier-clamped differential tolerance (no looser
 * window). Each tamper/omission is REJECTED; the honest observer golden still
 * reconciles ok:true (anti-vacuity).
 *
 * Determinism: in-memory deep-clone of the shipped observer golden + a single
 * mutation per test; no wall-clock / randomness / locale. The unmutated golden
 * reconciles ok:true (proving the completeness checks do not mis-fire).
 */

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"
import { reconcileReceipt } from "../src/reconcile.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, "..")

const OBSERVER_GOLDEN = "fixtures/external/pytorch.softmax-ce.golden.jsonl"

/**
 * Load a REQUIRED observer golden by repo-relative path, deep-cloning so each
 * mutation is isolated. Asserts the fixture exists — a deleted/renamed golden
 * MUST fail LOUDLY here, never be skipped vacuously (G-051 / G-025 discipline,
 * mirroring test/reconcile.nan-poisoning.test.ts). Voiding a CRITICAL-class
 * regression by silently skipping is exactly the test-vacuity defect ENG fixes.
 */
function loadRequiredObserverClone(): any {
  const p = resolve(repoRoot, OBSERVER_GOLDEN)
  assert.ok(existsSync(p), `required observer golden fixture missing: ${p}`)
  return JSON.parse(readFileSync(p, "utf-8").trim())
}

function rule14Failures(receipt: unknown) {
  const result = reconcileReceipt(receipt)
  return result
}

// ===========================================================================
// Anti-vacuity baseline: the honest observer golden reconciles ok:true.
// If this is RED the mutation tests below aren't isolating the injected defect.
// ===========================================================================
test("ENG baseline: unmutated observer golden reconciles ok:true (completeness checks do not mis-fire)", () => {
  const r = loadRequiredObserverClone()
  // Precondition: the golden actually carries post_update_* so ENG-1 is exercised.
  assert.ok(
    r.post_update_forward && typeof r.post_update_forward === "object",
    `${OBSERVER_GOLDEN} precondition: must carry post_update_forward`,
  )
  assert.ok(
    r.post_update_loss && typeof r.post_update_loss === "object",
    `${OBSERVER_GOLDEN} precondition: must carry post_update_loss`,
  )
  const result = reconcileReceipt(r)
  assert.strictEqual(
    result.ok,
    true,
    `the unmodified observer golden must reconcile ok:true; got: ${
      result.ok === false
        ? JSON.stringify(result.failures.map((f) => ({ rule: f.rule, field_path: f.field_path })))
        : "ok"
    }`,
  )
})

// ===========================================================================
// ENG-1 — post_update_loss.total fabrication is REJECTED.
// ===========================================================================
test("ENG-1: fabricated post_update_loss.total is REJECTED (engine recompute disagrees) AND the honest golden still passes", () => {
  const honest = loadRequiredObserverClone()
  assert.strictEqual(
    reconcileReceipt(honest).ok,
    true,
    "honest-golden half of the invariant: the unmodified golden must still pass",
  )

  const r = loadRequiredObserverClone()
  const original = r.post_update_loss.total
  r.post_update_loss.total = original + 99.0 // well beyond any differential tolerance
  const result = rule14Failures(r)
  assert.strictEqual(
    result.ok,
    false,
    "a fabricated post_update_loss.total must NOT reconcile ok:true — the engine recomputes the post-update loss",
  )
  if (result.ok) return
  const f = result.failures.find(
    (x) => x.rule === 14 && x.field_path === "post_update_loss.total",
  )
  assert.ok(
    f,
    `expected a Rule 14 failure at post_update_loss.total; got: ${JSON.stringify(
      result.failures.map((x) => ({ rule: x.rule, field_path: x.field_path })),
    )}`,
  )
})

// ===========================================================================
// ENG-1 — post_update_forward unit .out fabrication is REJECTED.
// ===========================================================================
test("ENG-1: fabricated post_update_forward.<u>.out is REJECTED AND the honest golden still passes", () => {
  const r = loadRequiredObserverClone()
  // Pick the first output unit present as a flat key on post_update_forward.
  const unitKey = Object.keys(r.post_update_forward).find(
    (k) => k !== "status" && k !== "units",
  )!
  assert.ok(unitKey, "fixture precondition: post_update_forward carries at least one unit")
  r.post_update_forward[unitKey].out = r.post_update_forward[unitKey].out + 5.0
  const result = reconcileReceipt(r)
  assert.strictEqual(
    result.ok,
    false,
    `a fabricated post_update_forward.${unitKey}.out must be REJECTED`,
  )
  if (result.ok) return
  const f = result.failures.find(
    (x) => x.rule === 14 && x.field_path === `post_update_forward.${unitKey}.out`,
  )
  assert.ok(
    f,
    `expected a Rule 14 failure at post_update_forward.${unitKey}.out; got: ${JSON.stringify(
      result.failures.filter((x) => x.rule === 14).map((x) => x.field_path),
    )}`,
  )
  // Honest half:
  assert.strictEqual(
    reconcileReceipt(loadRequiredObserverClone()).ok,
    true,
    "the unmodified golden must still pass",
  )
})

// ===========================================================================
// ENG-1 — post_update_loss.per_output fabrication is REJECTED.
// ===========================================================================
test("ENG-1: fabricated post_update_loss.per_output[u] is REJECTED AND the honest golden still passes", () => {
  const r = loadRequiredObserverClone()
  const outKey = Object.keys(r.post_update_loss.per_output)[0]!
  assert.ok(outKey, "fixture precondition: post_update_loss.per_output is non-empty")
  r.post_update_loss.per_output[outKey] = r.post_update_loss.per_output[outKey] + 7.0
  const result = reconcileReceipt(r)
  assert.strictEqual(result.ok, false, `fabricated post_update_loss.per_output.${outKey} must be REJECTED`)
  if (result.ok) return
  const f = result.failures.find(
    (x) => x.rule === 14 && x.field_path === `post_update_loss.per_output.${outKey}`,
  )
  assert.ok(
    f,
    `expected a Rule 14 failure at post_update_loss.per_output.${outKey}; got: ${JSON.stringify(
      result.failures.filter((x) => x.rule === 14).map((x) => x.field_path),
    )}`,
  )
  assert.strictEqual(reconcileReceipt(loadRequiredObserverClone()).ok, true, "honest golden still passes")
})

// ===========================================================================
// ENG-1 — DROPPING a declared post_update_forward unit is REJECTED (completeness).
// A receipt that declares post_update_forward but drops a unit must NOT escape.
// ===========================================================================
test("ENG-1: dropping a declared post_update_forward unit is REJECTED (completeness) AND the honest golden still passes", () => {
  const r = loadRequiredObserverClone()
  const unitKey = Object.keys(r.post_update_forward).find(
    (k) => k !== "status" && k !== "units",
  )!
  assert.ok(unitKey, "fixture precondition: post_update_forward carries at least one unit")
  delete r.post_update_forward[unitKey]
  const result = reconcileReceipt(r)
  assert.strictEqual(
    result.ok,
    false,
    `dropping post_update_forward.${unitKey} (while still declaring the post_update_forward block) must be ` +
      `REJECTED — the engine recomputes that unit, so a missing receipt counterpart is a SELECTIVE-OMISSION ` +
      `laundering attempt, not a clean PASS`,
  )
  if (result.ok) return
  const f = result.failures.find(
    (x) =>
      x.rule === 14 &&
      x.field_path === `post_update_forward.${unitKey}` &&
      /COMPLETENESS/.test(x.message ?? ""),
  )
  assert.ok(
    f,
    `expected a Rule 14 COMPLETENESS failure at post_update_forward.${unitKey}; got: ${JSON.stringify(
      result.failures.filter((x) => x.rule === 14).map((x) => ({ field_path: x.field_path, message: x.message })),
    )}`,
  )
  assert.strictEqual(reconcileReceipt(loadRequiredObserverClone()).ok, true, "honest golden still passes")
})

// ===========================================================================
// ENG-2 — DROPPING an entire forward unit is REJECTED (completeness).
// ===========================================================================
test("ENG-2: dropping an entire forward unit is REJECTED (key set must EQUAL the engine's) AND the honest golden still passes", () => {
  const r = loadRequiredObserverClone()
  // Drop an output unit the engine recomputes; it stays in topology.unit_order
  // (the omission tell) but vanishes from the receipt's forward map.
  const dropped = "o1"
  assert.ok(
    Object.prototype.hasOwnProperty.call(r.forward, dropped),
    `fixture precondition: forward.${dropped} must exist`,
  )
  delete r.forward[dropped]
  const result = reconcileReceipt(r)
  assert.strictEqual(
    result.ok,
    false,
    `dropping forward.${dropped} entirely must be REJECTED — the engine recomputes it, so a missing receipt ` +
      `counterpart escapes the differential by omission`,
  )
  if (result.ok) return
  const f = result.failures.find(
    (x) =>
      x.rule === 14 &&
      x.field_path === `forward.${dropped}` &&
      /COMPLETENESS/.test(x.message ?? ""),
  )
  assert.ok(
    f,
    `expected a Rule 14 COMPLETENESS failure at forward.${dropped}; got: ${JSON.stringify(
      result.failures.filter((x) => x.rule === 14).map((x) => ({ field_path: x.field_path, message: x.message })),
    )}`,
  )
  assert.strictEqual(reconcileReceipt(loadRequiredObserverClone()).ok, true, "honest golden still passes")
})

// ===========================================================================
// ENG-2 — DROPPING just forward.<u>.net (keeping .out) is REJECTED.
// This isolates the "unit must carry BOTH net and out" half of the fix: the
// unit is still PRESENT (so the key-set check passes) but missing a scalar.
// ===========================================================================
test("ENG-2: dropping forward.<u>.net while keeping .out is REJECTED (unit must carry BOTH net and out) AND the honest golden still passes", () => {
  const r = loadRequiredObserverClone()
  const unit = "o1"
  assert.ok(
    Object.prototype.hasOwnProperty.call(r.forward, unit) &&
      typeof r.forward[unit].net === "number" &&
      typeof r.forward[unit].out === "number",
    `fixture precondition: forward.${unit} must carry both net and out`,
  )
  delete r.forward[unit].net
  const result = reconcileReceipt(r)
  assert.strictEqual(
    result.ok,
    false,
    `dropping only forward.${unit}.net (keeping .out) must be REJECTED — compareScalar early-returns on the ` +
      `missing net, so without the completeness check the engine's recomputed net would never be compared`,
  )
  if (result.ok) return
  const f = result.failures.find(
    (x) =>
      x.rule === 14 &&
      x.field_path === `forward.${unit}.net` &&
      /COMPLETENESS/.test(x.message ?? ""),
  )
  assert.ok(
    f,
    `expected a Rule 14 COMPLETENESS failure at forward.${unit}.net; got: ${JSON.stringify(
      result.failures.filter((x) => x.rule === 14).map((x) => ({ field_path: x.field_path, message: x.message })),
    )}`,
  )
  assert.strictEqual(reconcileReceipt(loadRequiredObserverClone()).ok, true, "honest golden still passes")
})
