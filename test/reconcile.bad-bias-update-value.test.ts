/**
 * Rule 5 reconciliation test on per-neuron bias fixture
 * (bad-bias-update-value).
 *
 * Per Agent F's contract (consolidator-decision §5):
 *   fixtures/bad/xor.bad-bias-update-value.jsonl — XOR per-neuron bias
 *   receipt with one bias-update value mutated above tolerance.
 *
 * The reconciler must report exactly one Rule 5 failure on the targeted
 * bias parameter. Rule 6 may or may not cascade (depends on engine's
 * stored-vs-recompute choice — see bad-update-value Mazur test for
 * parallel discussion).
 *
 * Skip behavior: missing fixture => test.skip with upstream TODO note.
 */

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"
import { reconcileReceipt, type ReconciliationFailure } from "../src/reconcile.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const fixturePath = resolve(__dirname, "../fixtures/bad/xor.bad-bias-update-value.jsonl")
const metaPath = resolve(__dirname, "../fixtures/bad/xor.bad-bias-update-value.meta.json")

test("xor.bad-bias-update-value fixture fails reconcile with exactly one Rule 5 failure on the targeted bias parameter", (t) => {
  if (!existsSync(fixturePath)) {
    t.skip(
      `TODO upstream (Fixtures agent): fixtures/bad/xor.bad-bias-update-value.jsonl ` +
        `not yet present. v0.4 contract is per-neuron-bias XOR receipt with one ` +
        `bias update value mutated above tolerance.`,
    )
    return
  }

  const receipt = JSON.parse(readFileSync(fixturePath, "utf-8"))
  const result = reconcileReceipt(receipt)

  assert.strictEqual(
    result.ok,
    false,
    "reconciler must reject xor.bad-bias-update-value (Rule 5 mutation must fire)",
  )
  if (result.ok) return

  const rule5 = result.failures.filter((f: ReconciliationFailure) => f.rule === 5)
  assert.strictEqual(
    rule5.length,
    1,
    `exactly one Rule 5 failure expected; got ${rule5.length}: ` +
      JSON.stringify(rule5.map((f) => ({ rule: f.rule, parameter_id: f.parameter_id, field_path: f.field_path }))),
  )

  if (existsSync(metaPath)) {
    const meta = JSON.parse(readFileSync(metaPath, "utf-8")) as {
      mutation?: { parameter_id?: string }
    }
    const expectedParam = meta.mutation?.parameter_id
    if (expectedParam !== undefined) {
      assert.strictEqual(
        rule5[0]!.parameter_id,
        expectedParam,
        `Rule 5 failure must name the targeted bias parameter '${expectedParam}'; ` +
          `got '${rule5[0]!.parameter_id}'`,
      )
    }
  }
})
