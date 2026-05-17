/**
 * Rule 0f (structural) test: Update.kind vs topology.parameters[].role
 * contradiction.
 *
 * The fixture mutates updates[0].kind from "weight" to "bias" on
 * parameter w_x1_h1 (whose topology role remains "input_to_hidden_weight").
 * Bias-role parameters require kind="bias"; weight-role parameters
 * require kind="weight". The pairing is contradictory and Rule 0f fires.
 */

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"
import { reconcileReceipt, type ReconciliationFailure } from "../src/reconcile.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const fixturePath = resolve(__dirname, "../fixtures/bad/xor.bad-kind-vs-role.jsonl")

test("xor.bad-kind-vs-role fires Rule 0f on updates[0].kind vs parameter role mismatch", (t) => {
  if (!existsSync(fixturePath)) {
    t.skip("fixture not present")
    return
  }
  const receipt = JSON.parse(readFileSync(fixturePath, "utf-8"))
  const result = reconcileReceipt(receipt)
  assert.strictEqual(result.ok, false, "expected reconcile to fail")
  if (result.ok) return // type narrowing
  const rule0 = result.failures.filter((f: ReconciliationFailure) => f.rule === 0)
  assert.ok(rule0.length >= 1, `expected at least one Rule 0 failure, got ${result.failures.length}`)

  const kindFailure = rule0.find(
    (f) => f.field_path === "updates[0].kind" && f.parameter_id === "w_x1_h1",
  )
  assert.ok(
    kindFailure,
    `expected Rule 0 failure on updates[0].kind for w_x1_h1, got: ${JSON.stringify(rule0.map((f) => ({ rule: f.rule, field_path: f.field_path, parameter_id: f.parameter_id })))}`,
  )
  assert.ok(
    kindFailure.message?.includes("input_to_hidden_weight"),
    `expected failure message to mention the role 'input_to_hidden_weight'; got: ${kindFailure.message}`,
  )
})
