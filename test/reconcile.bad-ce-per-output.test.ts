/**
 * Rule 12 (CE branch) per-output test.
 *
 * The fixture mutates loss.per_output.o1 by +0.1 (0.874343420 → 0.974343420)
 * while leaving every other field byte-identical. Rule 12's
 * cross_entropy_softmax branch fires on the per_output[o1] check:
 * stored 0.974... != recomputed (-y_o1 * log(p_o1) = 0.874...).
 *
 * Independence: loss.total is checked against forward+targets independently
 * of loss.per_output, so the total check passes. Rules 1-8 are backward-
 * side and never read loss.* — no cascade.
 */

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"
import { reconcileReceipt, type ReconciliationFailure } from "../src/reconcile.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const perOutputPath = resolve(
  __dirname,
  "../fixtures/bad/softmax-ce.bad-ce-per-output.jsonl",
)
const totalPath = resolve(
  __dirname,
  "../fixtures/bad/softmax-ce.bad-ce-total.jsonl",
)

test(
  "softmax-ce.bad-ce-per-output fires Rule 12 on loss.per_output.o1 alone",
  (t) => {
    if (!existsSync(perOutputPath)) {
      t.skip("fixture not present")
      return
    }
    const receipt = JSON.parse(readFileSync(perOutputPath, "utf-8"))
    const result = reconcileReceipt(receipt)
    assert.strictEqual(result.ok, false, "expected reconcile to fail")
    if (result.ok) return

    const rule12 = result.failures.filter(
      (f: ReconciliationFailure) => f.rule === 12,
    )
    assert.strictEqual(
      rule12.length,
      1,
      `expected exactly one Rule 12 failure; got ${rule12.length}: ${JSON.stringify(rule12.map((f) => f.field_path))}`,
    )
    assert.strictEqual(
      rule12[0]!.field_path,
      "loss.per_output.o1",
      `Rule 12 must fire on the mutated per_output entry; got ${rule12[0]!.field_path}`,
    )
    // No cascade.
    const otherRules = result.failures.filter(
      (f: ReconciliationFailure) => f.rule !== 12,
    )
    assert.strictEqual(
      otherRules.length,
      0,
      `CE per_output mutation must not cascade; got: ${JSON.stringify(otherRules.map((f) => ({ rule: f.rule, field_path: f.field_path })))}`,
    )
  },
)

test("softmax-ce.bad-ce-total fires Rule 12 on loss.total alone", (t) => {
  if (!existsSync(totalPath)) {
    t.skip("fixture not present")
    return
  }
  const receipt = JSON.parse(readFileSync(totalPath, "utf-8"))
  const result = reconcileReceipt(receipt)
  assert.strictEqual(result.ok, false, "expected reconcile to fail")
  if (result.ok) return

  const rule12 = result.failures.filter(
    (f: ReconciliationFailure) => f.rule === 12,
  )
  assert.strictEqual(
    rule12.length,
    1,
    `expected exactly one Rule 12 failure (loss.total); got: ${JSON.stringify(rule12.map((f) => f.field_path))}`,
  )
  assert.strictEqual(rule12[0]!.field_path, "loss.total")
  const otherRules = result.failures.filter(
    (f: ReconciliationFailure) => f.rule !== 12,
  )
  assert.strictEqual(
    otherRules.length,
    0,
    `loss.total mutation must not cascade; got: ${JSON.stringify(otherRules.map((f) => ({ rule: f.rule, field_path: f.field_path })))}`,
  )
})
