/**
 * Rule 12 (loss formula consistency) test on Mazur half_squared_error.
 *
 * The fixture mutates loss.total from 0.298371109 to 0.298372109 (delta
 * +1e-6, ~1000x scalar tolerance) while leaving per-output loss entries,
 * targets, and forward outputs byte-identical. Rule 12 catches:
 * `loss.total != sum(loss.per_output[*])` under the half_squared_error
 * formula declared by topology.loss.
 *
 * This fixture closes a real v0.4.1 trust gap surfaced by the v0.5 study:
 * prior to v0.4.2, loss.total was schema-validated but never math-checked
 * by any reconciler rule, so a receipt could lie about loss.total and
 * reconcileReceipt would return ok===true.
 */

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"
import { reconcileReceipt, type ReconciliationFailure } from "../src/reconcile.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const fixturePath = resolve(__dirname, "../fixtures/bad/mazur.bad-loss-total.jsonl")

test("mazur.bad-loss-total fires Rule 12 on loss.total vs sum(loss.per_output)", (t) => {
  if (!existsSync(fixturePath)) {
    t.skip("fixture not present")
    return
  }
  const receipt = JSON.parse(readFileSync(fixturePath, "utf-8"))
  const result = reconcileReceipt(receipt)
  assert.strictEqual(result.ok, false, "expected reconcile to fail")
  if (result.ok) return // type narrowing

  const rule12 = result.failures.filter((f: ReconciliationFailure) => f.rule === 12)
  assert.ok(
    rule12.length >= 1,
    `expected at least one Rule 12 failure, got ${result.failures.length} failures: ${JSON.stringify(result.failures.map((f) => ({ rule: f.rule, field_path: f.field_path })))}`,
  )

  const totalFailure = rule12.find((f) => f.field_path === "loss.total")
  assert.ok(
    totalFailure,
    `expected Rule 12 failure on loss.total, got: ${JSON.stringify(rule12.map((f) => f.field_path))}`,
  )

  assert.strictEqual(totalFailure.stored, 0.298372109, "stored should be the mutated total")
  // recomputed is the sum-of-per-output, which is the canonical Mazur 0.298371109
  // (full-double-precision; the receipt's stored per-output entries sum to ~0.2983711091616805)
  assert.ok(
    Math.abs(totalFailure.recomputed - 0.298371109) < 1e-6,
    `recomputed (~${totalFailure.recomputed}) should be close to sum(per_output) = 0.298371109`,
  )

  // CRITICAL: Rule 12 must fire ALONE — no cascade to Rules 1-8 (those are
  // backward-side and independent of loss-side mutations). If any of them
  // fire too, the bad fixture has accidentally mutated more than loss.total.
  const otherRules = result.failures.filter(
    (f: ReconciliationFailure) => f.rule >= 1 && f.rule <= 8,
  )
  assert.strictEqual(
    otherRules.length,
    0,
    `loss.total mutation must not cascade to backward-side rules 1-8; got: ${JSON.stringify(otherRules.map((f) => ({ rule: f.rule, field_path: f.field_path })))}`,
  )
})

test("existing Mazur golden passes Rule 12 cleanly", () => {
  const goldenPath = resolve(__dirname, "../fixtures/mazur.golden.jsonl")
  if (!existsSync(goldenPath)) return
  const receipt = JSON.parse(readFileSync(goldenPath, "utf-8"))
  const result = reconcileReceipt(receipt)
  assert.strictEqual(
    result.ok,
    true,
    `mazur.golden.jsonl must pass Rule 12 (and all other rules); got: ${JSON.stringify(result.ok === false ? result.failures.map((f) => ({ rule: f.rule, field_path: f.field_path })) : "ok")}`,
  )
})

test("existing XOR golden passes Rule 12 cleanly", () => {
  const goldenPath = resolve(__dirname, "../fixtures/xor.golden.jsonl")
  if (!existsSync(goldenPath)) return
  const receipt = JSON.parse(readFileSync(goldenPath, "utf-8"))
  const result = reconcileReceipt(receipt)
  assert.strictEqual(
    result.ok,
    true,
    `xor.golden.jsonl must pass Rule 12; got: ${JSON.stringify(result.ok === false ? result.failures.map((f) => ({ rule: f.rule, field_path: f.field_path })) : "ok")}`,
  )
})

test("existing iris golden passes Rule 12 cleanly", () => {
  const goldenPath = resolve(__dirname, "../fixtures/iris.golden.jsonl")
  if (!existsSync(goldenPath)) return
  const receipt = JSON.parse(readFileSync(goldenPath, "utf-8"))
  const result = reconcileReceipt(receipt)
  assert.strictEqual(
    result.ok,
    true,
    `iris.golden.jsonl must pass Rule 12; got: ${JSON.stringify(result.ok === false ? result.failures.map((f) => ({ rule: f.rule, field_path: f.field_path })) : "ok")}`,
  )
})

test("existing xor-per-neuron-bias golden passes Rule 12 cleanly", () => {
  const goldenPath = resolve(__dirname, "../fixtures/xor-per-neuron-bias.golden.jsonl")
  if (!existsSync(goldenPath)) return
  const receipt = JSON.parse(readFileSync(goldenPath, "utf-8"))
  const result = reconcileReceipt(receipt)
  assert.strictEqual(
    result.ok,
    true,
    `xor-per-neuron-bias.golden.jsonl must pass Rule 12; got: ${JSON.stringify(result.ok === false ? result.failures.map((f) => ({ rule: f.rule, field_path: f.field_path })) : "ok")}`,
  )
})
