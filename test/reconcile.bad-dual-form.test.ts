/**
 * Rule 13 (gated dual-form consistency) tests for the three sub-checks:
 *   13a — per-term multiplication
 *   13b — summation
 *   13c — collapsed-vs-dual
 *
 * The three bad fixtures isolate (as closely as possible) one OR a pair
 * of the sub-checks each:
 *   - bad-dual-term:        13a + 13b (term value mutated; multiplication
 *                                       and sum both wrong; 13c passes
 *                                       because summed_value still matches
 *                                       signal_value).
 *   - bad-dual-sum:         13b + 13c (summed_value mutated; sum
 *                                       inconsistent AND no longer matches
 *                                       signal_value).
 *   - bad-collapsed-vs-dual: 13c alone (dual_form mutated self-consistently;
 *                                        13a and 13b pass; only the cross-
 *                                        form check vs signal_value fires).
 *
 * Plus a gating test: the half_squared_error goldens (Mazur, XOR, iris,
 * per-neuron-bias) MUST NOT trip Rule 13 because their receipts don't
 * carry dual_form fields. Rule 13 silently skips on absent dual_form.
 */

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"
import { reconcileReceipt, type ReconciliationFailure } from "../src/reconcile.js"

const __dirname = dirname(fileURLToPath(import.meta.url))

test("softmax-ce.bad-dual-term fires Rule 13 (13a + 13b sub-checks)", (t) => {
  const fpath = resolve(
    __dirname,
    "../fixtures/bad/softmax-ce.bad-dual-term.jsonl",
  )
  if (!existsSync(fpath)) {
    t.skip("fixture not present")
    return
  }
  const receipt = JSON.parse(readFileSync(fpath, "utf-8"))
  const result = reconcileReceipt(receipt)
  assert.strictEqual(result.ok, false, "expected reconcile to fail")
  if (result.ok) return

  const rule13 = result.failures.filter(
    (f: ReconciliationFailure) => f.rule === 13,
  )
  assert.ok(
    rule13.length >= 1,
    `expected at least one Rule 13 failure; got ${result.failures.length}`,
  )
  const has13a = rule13.some((f) => /Rule 13a/.test(f.message ?? ""))
  const has13b = rule13.some((f) => /Rule 13b/.test(f.message ?? ""))
  assert.ok(
    has13a,
    `expected a Rule 13a failure (per-term multiplication); got messages: ${JSON.stringify(rule13.map((f) => f.message))}`,
  )
  assert.ok(
    has13b,
    `expected a Rule 13b failure (summation); got messages: ${JSON.stringify(rule13.map((f) => f.message))}`,
  )
})

test("softmax-ce.bad-dual-sum fires Rule 13 (13b + 13c sub-checks)", (t) => {
  const fpath = resolve(
    __dirname,
    "../fixtures/bad/softmax-ce.bad-dual-sum.jsonl",
  )
  if (!existsSync(fpath)) {
    t.skip("fixture not present")
    return
  }
  const receipt = JSON.parse(readFileSync(fpath, "utf-8"))
  const result = reconcileReceipt(receipt)
  assert.strictEqual(result.ok, false, "expected reconcile to fail")
  if (result.ok) return

  const rule13 = result.failures.filter(
    (f: ReconciliationFailure) => f.rule === 13,
  )
  const has13b = rule13.some((f) => /Rule 13b/.test(f.message ?? ""))
  const has13c = rule13.some((f) => /Rule 13c/.test(f.message ?? ""))
  assert.ok(
    has13b,
    `expected a Rule 13b failure (summation); got messages: ${JSON.stringify(rule13.map((f) => f.message))}`,
  )
  assert.ok(
    has13c,
    `expected a Rule 13c failure (collapsed-vs-dual); got messages: ${JSON.stringify(rule13.map((f) => f.message))}`,
  )
})

test(
  "softmax-ce.bad-collapsed-vs-dual fires Rule 13c ALONE (self-consistent dual_form)",
  (t) => {
    const fpath = resolve(
      __dirname,
      "../fixtures/bad/softmax-ce.bad-collapsed-vs-dual.jsonl",
    )
    if (!existsSync(fpath)) {
      t.skip("fixture not present")
      return
    }
    const receipt = JSON.parse(readFileSync(fpath, "utf-8"))
    const result = reconcileReceipt(receipt)
    assert.strictEqual(result.ok, false, "expected reconcile to fail")
    if (result.ok) return

    const rule13 = result.failures.filter(
      (f: ReconciliationFailure) => f.rule === 13,
    )
    assert.strictEqual(
      rule13.length,
      1,
      `expected exactly one Rule 13 failure (13c alone); got ${rule13.length}: ${JSON.stringify(rule13.map((f) => f.message))}`,
    )
    assert.match(
      rule13[0]!.message ?? "",
      /Rule 13c \(collapsed-vs-dual\)/,
      `Rule 13c message must name itself; got: ${rule13[0]!.message}`,
    )
    // No other rules should fire — the dual_form is internally consistent
    // and only the cross-form (vs signal_value) check is broken.
    const otherRules = result.failures.filter(
      (f: ReconciliationFailure) => f.rule !== 13,
    )
    assert.strictEqual(
      otherRules.length,
      0,
      `bad-collapsed-vs-dual must isolate Rule 13c; got: ${JSON.stringify(
        otherRules.map((f) => ({ rule: f.rule, field_path: f.field_path })),
      )}`,
    )
  },
)

// =============================================================================
// Gating: Rule 13 silently skips when dual_form is absent.
// =============================================================================

test("Mazur golden (no dual_form) does NOT fire Rule 13 (gated skip)", () => {
  const goldenPath = resolve(__dirname, "../fixtures/mazur.golden.jsonl")
  if (!existsSync(goldenPath)) return
  const receipt = JSON.parse(readFileSync(goldenPath, "utf-8"))
  const result = reconcileReceipt(receipt)
  assert.strictEqual(
    result.ok,
    true,
    `Mazur golden has no dual_form fields, so Rule 13 must silently skip; got failures: ${JSON.stringify(result.ok === false ? result.failures.map((f) => ({ rule: f.rule, field_path: f.field_path })) : "ok")}`,
  )
})

test("XOR golden (no dual_form) does NOT fire Rule 13 (gated skip)", () => {
  const goldenPath = resolve(__dirname, "../fixtures/xor.golden.jsonl")
  if (!existsSync(goldenPath)) return
  const receipt = JSON.parse(readFileSync(goldenPath, "utf-8"))
  const result = reconcileReceipt(receipt)
  assert.strictEqual(
    result.ok,
    true,
    `XOR golden has no dual_form fields, so Rule 13 must silently skip; got failures: ${JSON.stringify(result.ok === false ? result.failures.map((f) => ({ rule: f.rule, field_path: f.field_path })) : "ok")}`,
  )
})

test("softmax-ce golden (with dual_form) passes Rule 13 cleanly", () => {
  const goldenPath = resolve(__dirname, "../fixtures/softmax-ce.golden.jsonl")
  if (!existsSync(goldenPath)) return
  const receipt = JSON.parse(readFileSync(goldenPath, "utf-8"))
  const result = reconcileReceipt(receipt)
  assert.strictEqual(
    result.ok,
    true,
    `softmax-ce golden has dual_form fields and must pass all three 13 sub-checks; got: ${JSON.stringify(result.ok === false ? result.failures.map((f) => ({ rule: f.rule, field_path: f.field_path, message: f.message })) : "ok")}`,
  )
})
