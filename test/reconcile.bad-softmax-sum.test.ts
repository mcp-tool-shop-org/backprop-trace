/**
 * Rule 11 (softmax normalization) test.
 *
 * The fixture mutates forward.o2.out by +0.1 (from 0.256049895 to
 * 0.356049895). Each individual output stays in [0, 1] (Rule 0.8 passes)
 * but sum(forward[output].out) ≈ 1.1 instead of 1.0. Rule 11 fires on the
 * sum mismatch.
 *
 * Tolerance choice on the v0.5 softmax+CE policy is {atol: 1e-11, rtol:
 * 1e-7}, so a +0.1 mutation is ~10^8 × tolerance — well above any
 * cascading-effect threshold for unrelated rules. The test asserts that
 * Rule 11 fires on the sum field; cascades into Rule 12 / 13c are
 * acceptable but not asserted.
 */

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"
import { reconcileReceipt, type ReconciliationFailure } from "../src/reconcile.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const fixturePath = resolve(
  __dirname,
  "../fixtures/bad/softmax-ce.bad-softmax-sum.jsonl",
)

test("softmax-ce.bad-softmax-sum fires Rule 11 (softmax normalization)", (t) => {
  if (!existsSync(fixturePath)) {
    t.skip("fixture not present")
    return
  }
  const receipt = JSON.parse(readFileSync(fixturePath, "utf-8"))
  const result = reconcileReceipt(receipt)
  assert.strictEqual(result.ok, false, "expected reconcile to fail")
  if (result.ok) return

  const rule11 = result.failures.filter(
    (f: ReconciliationFailure) => f.rule === 11,
  )
  assert.strictEqual(
    rule11.length,
    1,
    `expected exactly one Rule 11 failure (sum != 1); got ${rule11.length}: ${JSON.stringify(rule11.map((f) => f.field_path))}`,
  )
  const fail = rule11[0]!
  assert.match(
    fail.field_path,
    /forward\[output_units\]\.out \(sum\)/,
    `Rule 11 field_path must name the sum site; got: ${fail.field_path}`,
  )
  assert.match(
    fail.message ?? "",
    /Rule 11 \(softmax normalization\)/,
    `Rule 11 message must name itself; got: ${fail.message}`,
  )
  // Sum should be ~1.1 (the +0.1 mutation).
  assert.ok(
    Math.abs(fail.stored - 1.1) < 1e-6,
    `Rule 11 stored sum should be ~1.1; got ${fail.stored}`,
  )
  assert.strictEqual(
    fail.recomputed,
    1.0,
    "Rule 11 recomputed should be exactly 1.0 (the normalization target)",
  )
})
