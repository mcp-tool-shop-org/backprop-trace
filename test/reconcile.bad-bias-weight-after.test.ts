/**
 * Rule 6 reconciliation test on per-neuron bias fixture
 * (bad-bias-weight-after).
 *
 * Per Agent F's contract (consolidator-decision §5):
 *   fixtures/bad/xor.bad-bias-weight-after.jsonl — XOR per-neuron bias
 *   receipt with one bias's update.weight_after mutated above tolerance
 *   while gradient and update remain unchanged.
 *
 * The reconciler must report exactly one Rule 6 failure on the targeted
 * bias parameter (weight_before + update no longer equals stored
 * weight_after).
 *
 * Note: "weight_after" is the v0.3 field name on the Update shape and is
 * reused for bias updates in v0.4 (the field is shared structure across
 * weight + bias kinds). Rule 6 fires on update.weight_after irrespective
 * of update.kind.
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
const fixturePath = resolve(__dirname, "../fixtures/bad/xor.bad-bias-weight-after.jsonl")
const metaPath = resolve(__dirname, "../fixtures/bad/xor.bad-bias-weight-after.meta.json")

test("xor.bad-bias-weight-after fixture fails reconcile with exactly one Rule 6 failure on the targeted bias parameter", (t) => {
  if (!existsSync(fixturePath)) {
    t.skip(
      `TODO upstream (Fixtures agent): fixtures/bad/xor.bad-bias-weight-after.jsonl ` +
        `not yet present. v0.4 contract is per-neuron-bias XOR receipt with one ` +
        `bias update.weight_after mutated above tolerance.`,
    )
    return
  }

  const receipt = JSON.parse(readFileSync(fixturePath, "utf-8"))
  const result = reconcileReceipt(receipt)

  assert.strictEqual(
    result.ok,
    false,
    "reconciler must reject xor.bad-bias-weight-after (Rule 6 mutation must fire)",
  )
  if (result.ok) return

  const rule6 = result.failures.filter((f: ReconciliationFailure) => f.rule === 6)
  assert.strictEqual(
    rule6.length,
    1,
    `exactly one Rule 6 failure expected; got ${rule6.length}: ` +
      JSON.stringify(rule6.map((f) => ({ rule: f.rule, parameter_id: f.parameter_id, field_path: f.field_path }))),
  )

  if (existsSync(metaPath)) {
    const meta = JSON.parse(readFileSync(metaPath, "utf-8")) as {
      mutation?: { parameter_id?: string }
    }
    const expectedParam = meta.mutation?.parameter_id
    if (expectedParam !== undefined) {
      assert.strictEqual(
        rule6[0]!.parameter_id,
        expectedParam,
        `Rule 6 failure must name the targeted bias parameter '${expectedParam}'; ` +
          `got '${rule6[0]!.parameter_id}'`,
      )
    }
  }
})
