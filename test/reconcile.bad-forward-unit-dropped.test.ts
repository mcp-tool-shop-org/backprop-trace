/**
 * Rule 0.9 (forward-map completeness) regression test.
 *
 * Closes the gated-rule omission hole: an engine-side softmax+CE receipt (Rule
 * 14 off by design) that DROPS one output unit from `forward` while keeping it
 * declared in topology.unit_order.output — and keeping its loss.per_output
 * entry (o3's target is 0, so its CE component is legitimately 0 and G-018
 * loss-component coherence stays satisfied) — used to reconcile ok:true even
 * though the surviving forward outputs (o1=0.5, o2=0.3) do NOT sum to 1.0.
 *
 * Pre-fix, the three gated forward-side rules each silently skipped the missing
 * unit:
 *   - Rule 11 (softmax normalization): anyMissing branch -> bare return.
 *   - Rule 0.8 (probability bounds): `if (!f || typeof f.out !== "number") continue`.
 *   - Rule 12 (cross_entropy_softmax): missing .out -> totalReconstructable=false, continue.
 * Schema validation does not catch it either (ForwardMap is an open
 * additionalProperties map). Rule 0.9 fails it CLOSED: when unit_order.output is
 * present, the forward key set MUST EQUAL unit_order.hidden ∪ output. Rule 0
 * short-circuits, so it fires before the numeric rules can skip o3.
 *
 * The contrast sub-test proves Rule 0.9 targets the OMISSION specifically: when
 * the dropped unit is re-added (the same non-normalized 0.9-sum distribution,
 * all three units present), Rule 0.9 no longer fires and Rule 11 correctly
 * catches the normalization violation instead.
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
  "../fixtures/bad/softmax-ce.bad-forward-unit-dropped.jsonl",
)

test("softmax-ce.bad-forward-unit-dropped fires Rule 0.9 (forward completeness) on the dropped output unit", (t) => {
  if (!existsSync(fixturePath)) {
    t.skip("fixture not present")
    return
  }
  const receipt = JSON.parse(readFileSync(fixturePath, "utf-8"))
  const result = reconcileReceipt(receipt)

  // The core of the hole: this receipt MUST be rejected. Pre-fix it returned
  // ok:true (a dropped softmax output unit laundered a non-normalized
  // distribution past Rules 0.8/11/12).
  assert.strictEqual(
    result.ok,
    false,
    "expected reconcile to FAIL — a dropped softmax output unit must not reconcile ok:true",
  )
  if (result.ok) return

  // Rule 0.9 is a Rule 0 sub-check (failure record uses rule: 0 with "Rule 0.9"
  // in the message). It must fire on the missing output unit o3.
  const forwardCompleteness = result.failures.filter(
    (f: ReconciliationFailure) =>
      f.rule === 0 && /Rule 0\.9 \(forward completeness\)/.test(f.message ?? ""),
  )
  assert.strictEqual(
    forwardCompleteness.length,
    1,
    `expected exactly one Rule 0.9 forward-completeness failure (the dropped o3); got ${forwardCompleteness.length}: ` +
      `${JSON.stringify(forwardCompleteness.map((f) => f.field_path))}`,
  )
  const fail = forwardCompleteness[0]!
  assert.strictEqual(
    fail.field_path,
    "forward.o3",
    `Rule 0.9 field_path must name the dropped unit; got: ${fail.field_path}`,
  )
  assert.strictEqual(
    fail.parameter_id,
    "o3",
    `Rule 0.9 parameter_id must name the dropped unit; got: ${fail.parameter_id}`,
  )
  assert.match(
    fail.message ?? "",
    /key set must EQUAL/i,
    `Rule 0.9 message must state the key-set-EQUAL contract; got: ${fail.message}`,
  )

  // Rule 0 short-circuits: the numeric rules (incl. the silently-skipping
  // Rules 11/12) never run on the rejected receipt, so the omission cannot
  // launder a clean PASS.
  const numericRulesFired = result.failures.filter(
    (f: ReconciliationFailure) => f.rule > 0,
  )
  assert.strictEqual(
    numericRulesFired.length,
    0,
    `Rule 0 (structural) must short-circuit before numeric rules; got numeric failures: ` +
      `${JSON.stringify(numericRulesFired.map((f) => ({ rule: f.rule, field: f.field_path })))}`,
  )
})

test("contrast: re-adding the dropped unit (non-normalized, all present) shifts the catch from Rule 0.9 to Rule 11", (t) => {
  if (!existsSync(fixturePath)) {
    t.skip("fixture not present")
    return
  }
  const receipt = JSON.parse(readFileSync(fixturePath, "utf-8"))
  // Re-add o3 with the value the dropped fixture removed (0.1). Now all three
  // output units are present but the distribution still sums to 0.9 != 1.0.
  receipt.forward.o3 = { net: 0.630595278, out: 0.1 }
  const result = reconcileReceipt(receipt)

  assert.strictEqual(
    result.ok,
    false,
    "a non-normalized softmax distribution (sum 0.9) must still fail even with all units present",
  )
  if (result.ok) return

  // Rule 0.9 must NOT fire now — the forward key set is complete.
  const forwardCompleteness = result.failures.filter(
    (f: ReconciliationFailure) =>
      f.rule === 0 && /Rule 0\.9 \(forward completeness\)/.test(f.message ?? ""),
  )
  assert.strictEqual(
    forwardCompleteness.length,
    0,
    `Rule 0.9 must NOT fire when every declared forward unit is present; got: ` +
      `${JSON.stringify(forwardCompleteness.map((f) => f.field_path))}`,
  )

  // Rule 11 (softmax normalization) is the rule that catches the underlying
  // normalization violation once the unit set is complete.
  const rule11 = result.failures.filter(
    (f: ReconciliationFailure) => f.rule === 11,
  )
  assert.ok(
    rule11.length >= 1,
    `expected Rule 11 (softmax normalization) to fire on the sum != 1.0; got rules: ` +
      `${JSON.stringify(result.failures.map((f) => f.rule))}`,
  )
})
