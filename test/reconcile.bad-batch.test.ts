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
