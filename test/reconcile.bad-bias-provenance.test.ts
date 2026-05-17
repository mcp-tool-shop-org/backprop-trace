/**
 * Rule 8 reconciliation test on per-neuron bias fixture
 * (bad-bias-provenance).
 *
 * Per Agent F's contract (consolidator-decision §5):
 *   fixtures/bad/xor.bad-bias-provenance.jsonl — XOR per-neuron bias
 *   receipt with one factor's `from`-path value mutated so the referenced
 *   field disagrees with factor.value (provenance broken).
 *
 * The reconciler must report exactly one Rule 8 failure on the targeted
 * bias parameter.
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
const fixturePath = resolve(__dirname, "../fixtures/bad/xor.bad-bias-provenance.jsonl")
const metaPath = resolve(__dirname, "../fixtures/bad/xor.bad-bias-provenance.meta.json")

test("xor.bad-bias-provenance fixture fails reconcile with exactly one Rule 8 failure on the targeted bias parameter", (t) => {
  if (!existsSync(fixturePath)) {
    t.skip(
      `TODO upstream (Fixtures agent): fixtures/bad/xor.bad-bias-provenance.jsonl ` +
        `not yet present. v0.4 contract is per-neuron-bias XOR receipt with one ` +
        `bias factor.from provenance reference broken.`,
    )
    return
  }

  const receipt = JSON.parse(readFileSync(fixturePath, "utf-8"))
  const result = reconcileReceipt(receipt)

  assert.strictEqual(
    result.ok,
    false,
    "reconciler must reject xor.bad-bias-provenance (Rule 8 mutation must fire)",
  )
  if (result.ok) return

  const rule8 = result.failures.filter((f: ReconciliationFailure) => f.rule === 8)
  assert.strictEqual(
    rule8.length,
    1,
    `exactly one Rule 8 failure expected; got ${rule8.length}: ` +
      JSON.stringify(rule8.map((f) => ({ rule: f.rule, parameter_id: f.parameter_id, field_path: f.field_path }))),
  )

  if (existsSync(metaPath)) {
    const meta = JSON.parse(readFileSync(metaPath, "utf-8")) as {
      mutation?: { parameter_id?: string }
    }
    const expectedParam = meta.mutation?.parameter_id
    if (expectedParam !== undefined) {
      assert.strictEqual(
        rule8[0]!.parameter_id,
        expectedParam,
        `Rule 8 failure must name the targeted bias parameter '${expectedParam}'; ` +
          `got '${rule8[0]!.parameter_id}'`,
      )
    }
  }
})
