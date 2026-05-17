/**
 * Rule 0e (structural) test: topology.bias_sharing vs
 * topology.parameters[*].applies_to_units.length contradiction.
 *
 * The fixture mutates topology.bias_sharing from "per_neuron" to
 * "per_layer" while leaving each bias parameter's applies_to_units
 * array at length 1. Under per_layer, hidden-bias parameters must
 * have applies_to_units covering the entire hidden layer (length 2
 * for the XOR 2-2-1 topology). Output-bias b_y has applies_to_units
 * length 1 which matches the output layer's size 1, so b_y does NOT
 * fire — only b_h1 and b_h2 do.
 */

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"
import { reconcileReceipt, type ReconciliationFailure } from "../src/reconcile.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const fixturePath = resolve(__dirname, "../fixtures/bad/xor.bad-bias-sharing-mismatch.jsonl")

test("xor.bad-bias-sharing-mismatch fires Rule 0e on hidden-bias applies_to_units mismatch", (t) => {
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

  const applies = rule0.filter((f) => f.field_path.includes("applies_to_units"))
  assert.ok(
    applies.length >= 1,
    `expected at least one applies_to_units failure, got: ${JSON.stringify(rule0.map((f) => f.field_path))}`,
  )

  const paramIds = new Set(applies.map((f) => f.parameter_id))
  assert.ok(paramIds.has("b_h1"), `expected b_h1 in failures, got ${[...paramIds].join(",")}`)
  assert.ok(paramIds.has("b_h2"), `expected b_h2 in failures, got ${[...paramIds].join(",")}`)
  // b_y has applies_to_units=["y"] length 1 matching output layer size 1 — must NOT fire
  assert.ok(!paramIds.has("b_y"), `b_y must NOT fire (output layer size 1 == applies_to_units length 1)`)
})
