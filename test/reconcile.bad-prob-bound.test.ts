/**
 * Rule 0.8 (probability bounds) test for softmax+CE receipts.
 *
 * Rule 0.8 is a SUB-CHECK of Rule 0 (structural) — failures use rule: 0
 * with the message naming "Rule 0.8" — so the doctrine ratchet (which
 * scans integer rule numbers) sees Rule 0 with a paired
 * softmax-ce.bad-prob-bound fixture and is satisfied.
 *
 * The fixture mutates forward.o1.out from 0.417135813 to -0.01 (outside the
 * [0, 1] probability range). Under topology.activation_output='softmax',
 * Rule 0.8 fires inside checkRule0Structural BEFORE any numeric rule gets
 * a chance to run (Rule 0 short-circuits via the failures.length > 0
 * branch in reconcileReceipt).
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
  "../fixtures/bad/softmax-ce.bad-prob-bound.jsonl",
)
const goldenPath = resolve(__dirname, "../fixtures/softmax-ce.golden.jsonl")

test(
  "softmax-ce.bad-prob-bound fires Rule 0.8 (probability bounds) on forward.o1.out",
  (t) => {
    if (!existsSync(fixturePath)) {
      t.skip("fixture not present")
      return
    }
    const receipt = JSON.parse(readFileSync(fixturePath, "utf-8"))
    const result = reconcileReceipt(receipt)
    assert.strictEqual(result.ok, false, "expected reconcile to fail")
    if (result.ok) return

    // Rule 0.8 surfaces as rule: 0 with "Rule 0.8" in the message.
    const rule0 = result.failures.filter(
      (f: ReconciliationFailure) => f.rule === 0,
    )
    assert.ok(
      rule0.length >= 1,
      `expected at least one Rule 0 failure (Rule 0.8 sub-check); got ${result.failures.length} failures`,
    )

    const probBoundFailure = rule0.find(
      (f) => f.field_path === "forward.o1.out",
    )
    assert.ok(
      probBoundFailure,
      `expected Rule 0 failure on forward.o1.out (Rule 0.8); got: ${JSON.stringify(rule0.map((f) => f.field_path))}`,
    )
    assert.match(
      probBoundFailure.message ?? "",
      /Rule 0\.8 \(probability bounds\)/,
      `Rule 0.8 sub-check message must name itself; got: ${probBoundFailure.message}`,
    )

    // Rule 0 short-circuits — no numeric rules should fire.
    const numericRules = result.failures.filter(
      (f: ReconciliationFailure) => f.rule > 0,
    )
    assert.strictEqual(
      numericRules.length,
      0,
      `Rule 0.8 must short-circuit BEFORE numeric rules fire; got: ${JSON.stringify(
        numericRules.map((f) => ({ rule: f.rule, field_path: f.field_path })),
      )}`,
    )
  },
)

test("softmax-ce golden passes Rule 0.8 cleanly (every output in [0, 1])", () => {
  if (!existsSync(goldenPath)) return
  const receipt = JSON.parse(readFileSync(goldenPath, "utf-8"))
  const result = reconcileReceipt(receipt)
  assert.strictEqual(
    result.ok,
    true,
    `softmax-ce.golden.jsonl must pass Rule 0.8; got: ${JSON.stringify(
      result.ok === false ? result.failures.map((f) => ({ rule: f.rule, field_path: f.field_path, message: f.message })) : "ok",
    )}`,
  )
})
