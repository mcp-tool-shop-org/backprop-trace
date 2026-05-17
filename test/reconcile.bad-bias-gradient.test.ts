/**
 * Rule 4 reconciliation test on per-neuron bias fixture
 * (bad-bias-gradient).
 *
 * Per Agent F's contract (consolidator-decision §5):
 *   fixtures/bad/xor.bad-bias-gradient.jsonl — XOR per-neuron bias receipt
 *   with one bias-parameter gradient mutated above tolerance.
 *
 * The reconciler must report exactly one Rule 4 failure on the targeted
 * bias parameter. Other rules may cascade (e.g., Rule 5 on the same update),
 * but the SINGLE Rule 4 failure invariant is what proves the bias-gradient
 * path is exercised, not the weight-gradient path.
 *
 * Skip behavior: if the Fixtures agent hasn't shipped the file yet, the
 * test skips rather than fails — the Tests agent's contract is to land
 * tests that come to life when upstream agents complete their slices.
 */

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"
import { reconcileReceipt, type ReconciliationFailure } from "../src/reconcile.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const fixturePath = resolve(__dirname, "../fixtures/bad/xor.bad-bias-gradient.jsonl")
const metaPath = resolve(__dirname, "../fixtures/bad/xor.bad-bias-gradient.meta.json")

test("xor.bad-bias-gradient fixture fails reconcile with exactly one Rule 4 failure on the targeted bias parameter", (t) => {
  if (!existsSync(fixturePath)) {
    t.skip(
      `TODO upstream (Fixtures agent): fixtures/bad/xor.bad-bias-gradient.jsonl ` +
        `not yet present. v0.4 contract is per-neuron-bias XOR receipt with one ` +
        `bias gradient mutated above tolerance.`,
    )
    return
  }

  const receipt = JSON.parse(readFileSync(fixturePath, "utf-8"))
  const result = reconcileReceipt(receipt)

  assert.strictEqual(
    result.ok,
    false,
    "reconciler must reject xor.bad-bias-gradient (Rule 4 mutation must fire)",
  )
  if (result.ok) return // narrow

  const rule4 = result.failures.filter((f: ReconciliationFailure) => f.rule === 4)
  assert.strictEqual(
    rule4.length,
    1,
    `exactly one Rule 4 failure expected on the targeted bias; got ${rule4.length}: ` +
      JSON.stringify(rule4.map((f) => ({ rule: f.rule, parameter_id: f.parameter_id, field_path: f.field_path }))),
  )

  // If the meta declares the expected parameter_id, assert on it.
  if (existsSync(metaPath)) {
    const meta = JSON.parse(readFileSync(metaPath, "utf-8")) as {
      mutation?: { parameter_id?: string }
    }
    const expectedParam = meta.mutation?.parameter_id
    if (expectedParam !== undefined) {
      assert.strictEqual(
        rule4[0]!.parameter_id,
        expectedParam,
        `Rule 4 failure must name the targeted bias parameter '${expectedParam}'; ` +
          `got '${rule4[0]!.parameter_id}'`,
      )
    }
  }
})
