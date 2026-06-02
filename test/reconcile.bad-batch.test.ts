/**
 * v0.9 — batched observer-mode bad-fixture plate test.
 *
 * Four fixtures, each proving a specific batched attack class is caught
 * by the named rule. Anti-circularity discipline preserved (Csmith/
 * CompCert): every test asserts the targeted rule fires BEFORE the
 * reconciler consults fixture_status metadata.
 *
 * Plate (targeted rule):
 *   - batch.bad-reduction-mode-mismatch    → Rule 18 (mean-vs-sum confusion)
 *   - batch.bad-sample-id-missing          → Rule 19 (per-sample map key set)
 *   - batch.bad-sample-order-duplicate     → Rule 19 (defense in depth;
 *                                              schema also catches via uniqueItems)
 *   - batch.bad-reduced-gradient-wrong     → Rule 14 (existing engine-recompute
 *                                              differential generalizes to batched)
 */

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"
import { reconcileReceipt } from "../src/reconcile.js"
import { validateReceiptSchema } from "../src/validate.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, "..")

function loadFixture(name: string): unknown {
  const p = resolve(repoRoot, `fixtures/bad/${name}.jsonl`)
  if (!existsSync(p)) {
    throw new Error(`Fixture ${name} not found. Run scripts/generate-batch-bad-fixtures.ts.`)
  }
  return JSON.parse(readFileSync(p, "utf-8").trim())
}

// ============================================================================
// Fixture 1: bad-reduction-mode-mismatch → Rule 18
// ============================================================================

test("batch.bad-reduction-mode-mismatch fires Rule 18 (loss.total inconsistent with declared reduction)", () => {
  const r = loadFixture("batch.bad-reduction-mode-mismatch")
  const result = reconcileReceipt(r)
  assert.strictEqual(result.ok, false, "must fail reconcile (declared mean, emitted sum)")
  if (result.ok) return
  const rule18 = result.failures.filter((f) => f.rule === 18)
  assert.ok(
    rule18.length >= 1,
    `expected Rule 18 to fire on mean-vs-sum confusion; got rules: ${[
      ...new Set(result.failures.map((f) => f.rule)),
    ]
      .sort()
      .join(", ")}`,
  )
  const msg = rule18[0]!.message ?? ""
  assert.match(
    msg,
    /mean.*sum|reduction|mean-vs-sum/i,
    "Rule 18 diagnostic must name the mean-vs-sum confusion explicitly",
  )
})

// ============================================================================
// Fixture 2: bad-sample-id-missing → Rule 19
// ============================================================================

test("batch.bad-sample-id-missing fires Rule 19 (loss.per_sample missing declared sample_id)", () => {
  const r = loadFixture("batch.bad-sample-id-missing")
  // Schema validation first — should pass (no cross-field constraint on
  // per-sample key set in v0.4.0 additive extension).
  const v = validateReceiptSchema(r)
  assert.strictEqual(
    v.ok,
    true,
    `bad-sample-id-missing must schema-validate (Rule 19 catches at reconcile, not schema); errors: ${
      v.ok ? "[]" : JSON.stringify(v.errors)
    }`,
  )
  const result = reconcileReceipt(r)
  assert.strictEqual(result.ok, false)
  if (result.ok) return
  const rule19 = result.failures.filter((f) => f.rule === 19)
  assert.ok(
    rule19.length >= 1,
    `expected Rule 19 to fire on sample-id missing; got rules: ${[
      ...new Set(result.failures.map((f) => f.rule)),
    ]
      .sort()
      .join(", ")}`,
  )
  const msg = rule19[0]!.message ?? ""
  assert.match(
    msg,
    /loss\.per_sample is missing sample_id "s3"|missing sample_id/i,
    "Rule 19 diagnostic must name the missing sample_id",
  )
})

// ============================================================================
// Fixture 3: bad-sample-order-duplicate → Rule 19 OR Rule 0 (schema)
// ============================================================================

test("batch.bad-sample-order-duplicate is rejected — schema uniqueItems OR Rule 19 (defense in depth)", () => {
  const r = loadFixture("batch.bad-sample-order-duplicate")
  // Either route catches: schema uniqueItems rejects at validation (Rule 0
  // structural failure at reconcile), OR Rule 19's defense-in-depth check
  // catches at reconcile if schema validation were skipped.
  const v = validateReceiptSchema(r)
  if (!v.ok) {
    // Schema-level uniqueItems caught it — that's the primary defense, Rule
    // 0 (structural sentinel) would fire at reconcile. Acceptable outcome.
    const errs = v.errors
    const hasUniqueItemsViolation = errs.some(
      (e) =>
        e.keyword === "uniqueItems" ||
        (typeof e.message === "string" && /unique/i.test(e.message)),
    )
    assert.ok(
      hasUniqueItemsViolation,
      `schema validation rejected the fixture but not for the expected uniqueItems reason; errors: ${JSON.stringify(errs)}`,
    )
    return
  }
  // Schema validation passed — Rule 19's defense-in-depth must catch.
  const result = reconcileReceipt(r)
  assert.strictEqual(result.ok, false)
  if (result.ok) return
  const rule19 = result.failures.filter((f) => f.rule === 19)
  assert.ok(
    rule19.length >= 1,
    `schema permitted the duplicate; Rule 19 defense-in-depth must catch. got rules: ${[
      ...new Set(result.failures.map((f) => f.rule)),
    ]
      .sort()
      .join(", ")}`,
  )
})

// ============================================================================
// Fixture 4: bad-reduced-gradient-wrong → Rule 14
// ============================================================================

test("batch.bad-reduced-gradient-wrong fires Rule 14 (existing engine-recompute differential generalizes)", () => {
  const r = loadFixture("batch.bad-reduced-gradient-wrong")
  const result = reconcileReceipt(r)
  assert.strictEqual(result.ok, false)
  if (result.ok) return
  const rule14 = result.failures.filter((f) => f.rule === 14)
  assert.ok(
    rule14.length >= 1,
    `expected Rule 14 to fire on reduced-gradient mismatch; got rules: ${[
      ...new Set(result.failures.map((f) => f.rule)),
    ]
      .sort()
      .join(", ")}`,
  )
  // Diagnostic: Rule 14 should report a forward / loss / gradient mismatch
  // — exact field varies based on which engine recompute step diverges.
  // (Note: Rule 5 may also fire as cross-fire because we changed gradient
  // but not update — that's expected and documented in the meta file.)
})

// ============================================================================
// Fixture 5 (G-S1): bad-per-sample-forward-tamper → Rule 14 (per-sample)
//
// THREAT (residual false-PASS): a batched observer receipt's TOP-LEVEL
// forward/loss are batch-reduced (or first-sample-only by canonical
// convention). Rule 14 originally compared only those top-level fields, never
// the per_sample[*] forward/loss. So forging a SINGLE per_sample forward value
// survived: the reduced gradient/update/weight_after/parameters_after are
// recomputed by the engine from per_sample[*].inputs (not from the forged
// forward), so they stayed consistent, and nothing inspected per_sample —
// ok:true. Rule 14 now mirrors the importer's stricter per-sample check.
//
// MUTATION THAT MAKES THIS RED: delete the per-sample comparison block in
// checkRule14EngineRecomputeDifferential. The forged per_sample.s1.forward.h1.out
// is then never compared against the engine recompute, no other rule catches it
// (reduced state is engine-consistent), and reconcileReceipt returns ok:true.
// ============================================================================

test("batch.bad-per-sample-forward-tamper fires Rule 14 (per-sample forward differential — reduced state stays consistent)", () => {
  const r = loadFixture("batch.bad-per-sample-forward-tamper")
  // Schema validation should PASS — only a numeric value changed; Rule 14
  // (not schema) is the load-bearing gate for the forged per-sample forward.
  const v = validateReceiptSchema(r)
  assert.strictEqual(
    v.ok,
    true,
    `bad-per-sample-forward-tamper must schema-validate (Rule 14 catches at reconcile, not schema); errors: ${
      v.ok ? "[]" : JSON.stringify(v.errors)
    }`,
  )
  const result = reconcileReceipt(r)
  assert.strictEqual(
    result.ok,
    false,
    "a forged per_sample forward value must be REJECTED — the engine recomputes per-sample " +
      "state from per_sample[*].inputs and the forged value diverges (Rule 14 per-sample differential)",
  )
  if (result.ok) return
  const rule14 = result.failures.filter((f) => f.rule === 14)
  assert.ok(
    rule14.length >= 1,
    `expected Rule 14 to fire on the per-sample forward tamper; got rules: ${[
      ...new Set(result.failures.map((f) => f.rule)),
    ]
      .sort((a, b) => a - b)
      .join(", ")}`,
  )
  // The forged field is per_sample.s1.forward.h1.out — Rule 14 must name a
  // per_sample forward path (proving it inspected per-sample state, not just
  // the top-level reduced forward).
  const perSampleFailure = rule14.find((f) =>
    /^per_sample\..+\.forward\..+\.(net|out)$/.test(f.field_path),
  )
  assert.ok(
    perSampleFailure,
    `Rule 14 must report a per_sample.*.forward.*.{net,out} field_path (the per-sample loop is the ` +
      `sole defense; a top-level-only failure would not prove G-S1 is closed). Got Rule 14 paths: ${JSON.stringify(
        rule14.map((f) => f.field_path),
      )}`,
  )
})

// ============================================================================
// Counter-positive sanity: canonical batched golden reconciles cleanly
// ============================================================================

test("batched golden reconciles cleanly (no false positives from Rules 18, 19 on the canonical fixture)", () => {
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
    `Canonical batched golden must pass all rules including new Rules 18 + 19; failures: ${
      result.ok === false
        ? JSON.stringify(result.failures.map((f) => ({ rule: f.rule, field_path: f.field_path })))
        : "ok"
    }`,
  )
})

// ============================================================================
// core-B-002: reconcileReceipt is TOLERANT of malformed ARRAY ELEMENTS
//
// reconcileReceipt documents itself as "tolerant of malformed receipts:
// surfaces a typed Rule-0 failure, never throws" (library callers do NOT wrap
// it in try/catch). But a malformed array ELEMENT — updates:[null],
// updates:[42], or output_error_signals factors:[null] — slips past the
// top-level structural guards (updates IS an array) and reaches the numeric
// rules, where `r.updates[i]!.optimizer.product_order` / a non-object factor
// throws a raw TypeError. That violates the never-throw contract and hands a
// library caller an unstructured crash.
//
// FIX: any throw inside the rule dispatch is converted to a typed Rule-0
// structural failure (graceful degradation — a diagnosable message, not a
// crash). reconcileReceipt(malformed) returns { ok:false, rule:0 }.
//
// Non-vacuity / mutation that turns these RED: remove the try/catch (or
// per-rule element guards) so the malformed element throws again — the
// assert.doesNotThrow then fails on the raw TypeError.
// ============================================================================

/**
 * Minimal receipt skeleton that passes the top-level structural guards
 * (object, valid numeric_policy.tolerance, updates is an array) and the Rule-0
 * cross-consistency checks, so the malformed-element mutation reaches the
 * numeric rule dispatch where the throw currently happens. The base (no
 * mutation) reconciles to a clean, throw-free result.
 */
function minimalReceiptBase(): Record<string, unknown> {
  return {
    schema_version: "0.2.0",
    numeric_policy: { tolerance: { atol: 1e-9, rtol: 1e-7 } },
    updates: [],
    backward: { output_error_signals: {}, hidden_error_signals: {} },
  }
}

test("core-B-002: reconcileReceipt({updates:[null]}) returns a typed Rule-0 failure, never throws", () => {
  const r = minimalReceiptBase()
  r.updates = [null]
  let result: ReturnType<typeof reconcileReceipt> | undefined
  assert.doesNotThrow(() => {
    result = reconcileReceipt(r)
  }, "a null array element MUST NOT throw a raw TypeError (documented never-throw contract)")
  assert.ok(result, "reconcileReceipt must return a result")
  assert.strictEqual(result!.ok, false, "a null update element must fail reconcile")
  if (result!.ok) return
  const rule0 = result!.failures.filter((f) => f.rule === 0)
  assert.ok(
    rule0.length >= 1,
    `a malformed update element must surface as a Rule-0 structural failure; got rules: ${[
      ...new Set(result!.failures.map((f) => f.rule)),
    ].join(", ")}`,
  )
  assert.ok(
    typeof rule0[0]!.message === "string" && rule0[0]!.message!.length > 0,
    "the Rule-0 failure must carry a developer-facing message (diagnosable, not a bare crash)",
  )
})

test("core-B-002: reconcileReceipt({updates:[42]}) returns a typed Rule-0 failure, never throws", () => {
  const r = minimalReceiptBase()
  r.updates = [42]
  let result: ReturnType<typeof reconcileReceipt> | undefined
  assert.doesNotThrow(() => {
    result = reconcileReceipt(r)
  }, "a non-object (number) array element MUST NOT throw a raw TypeError")
  assert.ok(result, "reconcileReceipt must return a result")
  assert.strictEqual(result!.ok, false, "a numeric update element must fail reconcile")
  if (result!.ok) return
  const rule0 = result!.failures.filter((f) => f.rule === 0)
  assert.ok(
    rule0.length >= 1,
    `a numeric update element must surface as a Rule-0 structural failure; got rules: ${[
      ...new Set(result!.failures.map((f) => f.rule)),
    ].join(", ")}`,
  )
})

test("core-B-002: reconcileReceipt with output_error_signals factors:[null] returns a typed Rule-0 failure, never throws", () => {
  const r = minimalReceiptBase()
  // A well-formed output error signal shell with a malformed factor ELEMENT.
  r.backward = {
    output_error_signals: {
      o1: {
        product_order: "left_to_right",
        signal_value: 0.5,
        factors: [null],
      },
    },
    hidden_error_signals: {},
  }
  let result: ReturnType<typeof reconcileReceipt> | undefined
  assert.doesNotThrow(() => {
    result = reconcileReceipt(r)
  }, "a null factor element MUST NOT throw a raw TypeError")
  assert.ok(result, "reconcileReceipt must return a result")
  assert.strictEqual(result!.ok, false, "a null factor element must fail reconcile")
  if (result!.ok) return
  const rule0 = result!.failures.filter((f) => f.rule === 0)
  assert.ok(
    rule0.length >= 1,
    `a malformed factor element must surface as a Rule-0 structural failure; got rules: ${[
      ...new Set(result!.failures.map((f) => f.rule)),
    ].join(", ")}`,
  )
})

test("core-B-002: a clean minimal receipt still reconciles ok:true (the tolerance guard does not false-FAIL valid input)", () => {
  // Regression-safety: the never-throw conversion must not turn a structurally
  // valid (if trivial) receipt into a failure. Empty updates + empty backward
  // is a degenerate-but-valid shape that exercises every rule's no-op path.
  const r = minimalReceiptBase()
  const result = reconcileReceipt(r)
  assert.strictEqual(
    result.ok,
    true,
    `a clean minimal receipt must still pass; failures: ${
      result.ok === false ? JSON.stringify(result.failures) : "ok"
    }`,
  )
})
