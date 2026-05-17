/**
 * Rule 0g (structural) test: topology.input_size vs
 * topology.unit_order.input.length contradiction.
 *
 * The fixture mutates topology.input_size from 2 to 3 while
 * unit_order.input stays ["x1","x2"] (length 2). The declared size
 * must equal the array length; Rule 0g fires.
 *
 * hidden_size and output_size still match their respective array
 * lengths, so only input_size fires (asserted here).
 */

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"
import { reconcileReceipt, type ReconciliationFailure } from "../src/reconcile.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const fixturePath = resolve(__dirname, "../fixtures/bad/xor.bad-topology-size.jsonl")

test("xor.bad-topology-size fires Rule 0g on topology.input_size vs unit_order.input.length mismatch", (t) => {
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

  const sizeFailure = rule0.find((f) => f.field_path === "topology.input_size")
  assert.ok(
    sizeFailure,
    `expected Rule 0 failure on topology.input_size, got: ${JSON.stringify(rule0.map((f) => f.field_path))}`,
  )
  assert.strictEqual(sizeFailure.stored, 3, "stored should be the declared size 3")
  assert.strictEqual(sizeFailure.recomputed, 2, "recomputed should be the actual array length 2")

  // hidden_size and output_size should NOT have fired
  const otherSizeFailures = rule0.filter(
    (f) => f.field_path === "topology.hidden_size" || f.field_path === "topology.output_size",
  )
  assert.strictEqual(
    otherSizeFailures.length,
    0,
    `hidden_size and output_size still match their arrays; expected no failures on them. Got: ${JSON.stringify(otherSizeFailures.map((f) => f.field_path))}`,
  )
})
