/**
 * Rule 12 (loss formula consistency) test on Mazur half_squared_error.
 *
 * The fixture mutates loss.total from 0.298371109 to 0.298372109 (delta
 * +1e-6, ~1000x scalar tolerance) while leaving per-output loss entries,
 * targets, and forward outputs byte-identical. Rule 12 catches:
 * `loss.total != sum(loss.per_output[*])` under the half_squared_error
 * formula declared by topology.loss.
 *
 * This fixture closes a real v0.4.1 trust gap surfaced by the v0.5 study:
 * prior to v0.4.2, loss.total was schema-validated but never math-checked
 * by any reconciler rule, so a receipt could lie about loss.total and
 * reconcileReceipt would return ok===true.
 */

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"
import { reconcileReceipt, type ReconciliationFailure } from "../src/reconcile.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const fixturePath = resolve(__dirname, "../fixtures/bad/mazur.bad-loss-total.jsonl")

test("mazur.bad-loss-total fires Rule 12 on loss.total vs sum(loss.per_output)", () => {
  assert.ok(
    existsSync(fixturePath),
    `required adversarial fixture missing: ${fixturePath}`,
  )
  const receipt = JSON.parse(readFileSync(fixturePath, "utf-8"))
  const result = reconcileReceipt(receipt)
  assert.strictEqual(result.ok, false, "expected reconcile to fail")
  if (result.ok) return // type narrowing

  const rule12 = result.failures.filter((f: ReconciliationFailure) => f.rule === 12)
  assert.ok(
    rule12.length >= 1,
    `expected at least one Rule 12 failure, got ${result.failures.length} failures: ${JSON.stringify(result.failures.map((f) => ({ rule: f.rule, field_path: f.field_path })))}`,
  )

  const totalFailure = rule12.find((f) => f.field_path === "loss.total")
  assert.ok(
    totalFailure,
    `expected Rule 12 failure on loss.total, got: ${JSON.stringify(rule12.map((f) => f.field_path))}`,
  )

  assert.strictEqual(totalFailure.stored, 0.298372109, "stored should be the mutated total")
  // recomputed is the sum-of-per-output, which is the canonical Mazur 0.298371109
  // (full-double-precision; the receipt's stored per-output entries sum to ~0.2983711091616805)
  assert.ok(
    Math.abs(totalFailure.recomputed - 0.298371109) < 1e-6,
    `recomputed (~${totalFailure.recomputed}) should be close to sum(per_output) = 0.298371109`,
  )

  // CRITICAL: Rule 12 must fire ALONE — no cascade to Rules 1-8 (those are
  // backward-side and independent of loss-side mutations). If any of them
  // fire too, the bad fixture has accidentally mutated more than loss.total.
  const otherRules = result.failures.filter(
    (f: ReconciliationFailure) => f.rule >= 1 && f.rule <= 8,
  )
  assert.strictEqual(
    otherRules.length,
    0,
    `loss.total mutation must not cascade to backward-side rules 1-8; got: ${JSON.stringify(otherRules.map((f) => ({ rule: f.rule, field_path: f.field_path })))}`,
  )
})

test("existing Mazur golden passes Rule 12 cleanly", () => {
  const goldenPath = resolve(__dirname, "../fixtures/mazur.golden.jsonl")
  assert.ok(
    existsSync(goldenPath),
    `required golden fixture missing: ${goldenPath}`,
  )
  const receipt = JSON.parse(readFileSync(goldenPath, "utf-8"))
  const result = reconcileReceipt(receipt)
  assert.strictEqual(
    result.ok,
    true,
    `mazur.golden.jsonl must pass Rule 12 (and all other rules); got: ${JSON.stringify(result.ok === false ? result.failures.map((f) => ({ rule: f.rule, field_path: f.field_path })) : "ok")}`,
  )
})

test("existing XOR golden passes Rule 12 cleanly", () => {
  const goldenPath = resolve(__dirname, "../fixtures/xor.golden.jsonl")
  assert.ok(
    existsSync(goldenPath),
    `required golden fixture missing: ${goldenPath}`,
  )
  const receipt = JSON.parse(readFileSync(goldenPath, "utf-8"))
  const result = reconcileReceipt(receipt)
  assert.strictEqual(
    result.ok,
    true,
    `xor.golden.jsonl must pass Rule 12; got: ${JSON.stringify(result.ok === false ? result.failures.map((f) => ({ rule: f.rule, field_path: f.field_path })) : "ok")}`,
  )
})

test("existing iris golden passes Rule 12 cleanly", () => {
  const goldenPath = resolve(__dirname, "../fixtures/iris.golden.jsonl")
  assert.ok(
    existsSync(goldenPath),
    `required golden fixture missing: ${goldenPath}`,
  )
  const receipt = JSON.parse(readFileSync(goldenPath, "utf-8"))
  const result = reconcileReceipt(receipt)
  assert.strictEqual(
    result.ok,
    true,
    `iris.golden.jsonl must pass Rule 12; got: ${JSON.stringify(result.ok === false ? result.failures.map((f) => ({ rule: f.rule, field_path: f.field_path })) : "ok")}`,
  )
})

test("existing xor-per-neuron-bias golden passes Rule 12 cleanly", () => {
  const goldenPath = resolve(__dirname, "../fixtures/xor-per-neuron-bias.golden.jsonl")
  assert.ok(
    existsSync(goldenPath),
    `required golden fixture missing: ${goldenPath}`,
  )
  const receipt = JSON.parse(readFileSync(goldenPath, "utf-8"))
  const result = reconcileReceipt(receipt)
  assert.strictEqual(
    result.ok,
    true,
    `xor-per-neuron-bias.golden.jsonl must pass Rule 12; got: ${JSON.stringify(result.ok === false ? result.failures.map((f) => ({ rule: f.rule, field_path: f.field_path })) : "ok")}`,
  )
})

// ===========================================================================
// G-018: Rule 12 loss-component coherence.
//
// When topology.unit_order.output is present, Rule 12 MUST assert that
// loss.per_output's KEY SET equals the output-unit set — a MISSING per_output
// entry (a dropped loss component) OR an EXTRA per_output entry must FAIL.
// Mirrors Rule 19's sample-set coherence check.
//
// The soundness hole (pre-G-018): the Rule 12 per-output loop iterates over
// Object.keys(loss.per_output), so a DROPPED component is simply never
// visited. An attacker who drops one loss component AND adjusts loss.total to
// match the reduced sum produces a fully self-consistent receipt that
// reconciles ok:true — the dropped component goes UNVERIFIED. These tests pin
// the closed behavior: the dropped/extra component is now caught structurally,
// independent of whether loss.total was also tampered to stay consistent.
//
// Receipts are built by deep-cloning a golden that DECLARES
// topology.unit_order.output (iris = half_squared_error; softmax-ce =
// cross_entropy_softmax) and mutating only the per_output key set.
// ===========================================================================

test("G-018: half_squared_error — dropped per_output component (total adjusted to stay consistent) is REJECTED", () => {
  const goldenPath = resolve(__dirname, "../fixtures/iris.golden.jsonl")
  assert.ok(
    existsSync(goldenPath),
    `required golden fixture missing: ${goldenPath}`,
  )
  const receipt = JSON.parse(readFileSync(goldenPath, "utf-8")) as {
    loss: { per_output: Record<string, number>; total: number }
    topology: { unit_order: { output: string[] } }
  }
  // Sanity: golden declares unit_order.output (the gate for this check).
  assert.ok(
    Array.isArray(receipt.topology.unit_order.output) &&
      receipt.topology.unit_order.output.length > 0,
    "iris golden must declare topology.unit_order.output for this test to be meaningful",
  )
  const dropUnit = receipt.topology.unit_order.output[receipt.topology.unit_order.output.length - 1]!
  const droppedValue = receipt.loss.per_output[dropUnit]!
  delete receipt.loss.per_output[dropUnit]
  // Adjust total so the remaining-sum check would PASS — isolating the
  // coherence check from the loss.total total check. Without G-018 this
  // self-consistent receipt reconciles ok:true (the soundness hole).
  receipt.loss.total = receipt.loss.total - droppedValue

  const result = reconcileReceipt(receipt)
  assert.strictEqual(
    result.ok,
    false,
    `dropping per_output component ${JSON.stringify(dropUnit)} and adjusting loss.total to match must be REJECTED ` +
      `(a dropped loss component must not go unverified)`,
  )
  if (result.ok) return // type narrowing
  const rule12 = result.failures.filter((f: ReconciliationFailure) => f.rule === 12)
  assert.ok(
    rule12.length >= 1,
    `expected a Rule 12 coherence failure for the dropped component, got: ${JSON.stringify(
      result.failures.map((f) => ({ rule: f.rule, field_path: f.field_path })),
    )}`,
  )
  const missingFailure = rule12.find(
    (f) => typeof f.field_path === "string" && f.field_path.includes(dropUnit),
  )
  assert.ok(
    missingFailure,
    `expected a Rule 12 failure naming the missing unit ${JSON.stringify(dropUnit)}, got: ${JSON.stringify(
      rule12.map((f) => f.field_path),
    )}`,
  )
})

test("G-018: half_squared_error — EXTRA per_output component (value 0, total consistent) is REJECTED", () => {
  const goldenPath = resolve(__dirname, "../fixtures/iris.golden.jsonl")
  assert.ok(
    existsSync(goldenPath),
    `required golden fixture missing: ${goldenPath}`,
  )
  const receipt = JSON.parse(readFileSync(goldenPath, "utf-8")) as {
    loss: { per_output: Record<string, number>; total: number }
  }
  // Add a phantom component with value 0 so the total stays consistent. The
  // key is NOT in topology.unit_order.output, so coherence must reject it.
  receipt.loss.per_output["o_phantom"] = 0

  const result = reconcileReceipt(receipt)
  assert.strictEqual(
    result.ok,
    false,
    "an EXTRA per_output key not present in topology.unit_order.output must be REJECTED",
  )
  if (result.ok) return
  const extraFailure = result.failures.find(
    (f: ReconciliationFailure) =>
      f.rule === 12 && typeof f.field_path === "string" && f.field_path.includes("o_phantom"),
  )
  assert.ok(
    extraFailure,
    `expected a Rule 12 failure naming the extra unit "o_phantom", got: ${JSON.stringify(
      result.failures.map((f) => ({ rule: f.rule, field_path: f.field_path })),
    )}`,
  )
})

test("G-018: cross_entropy_softmax — dropped per_output component (total adjusted) is REJECTED", () => {
  const goldenPath = resolve(__dirname, "../fixtures/softmax-ce.golden.jsonl")
  assert.ok(
    existsSync(goldenPath),
    `required golden fixture missing: ${goldenPath}`,
  )
  const receipt = JSON.parse(readFileSync(goldenPath, "utf-8")) as {
    loss: { per_output: Record<string, number>; total: number }
    topology: { unit_order: { output: string[] }; loss?: string }
  }
  assert.strictEqual(
    receipt.topology.loss,
    "cross_entropy_softmax",
    "softmax-ce golden must declare cross_entropy_softmax for the CE-branch coherence test",
  )
  const dropUnit = receipt.topology.unit_order.output[receipt.topology.unit_order.output.length - 1]!
  const droppedValue = receipt.loss.per_output[dropUnit]!
  delete receipt.loss.per_output[dropUnit]
  receipt.loss.total = receipt.loss.total - droppedValue

  const result = reconcileReceipt(receipt)
  assert.strictEqual(
    result.ok,
    false,
    `cross_entropy_softmax: dropping per_output component ${JSON.stringify(dropUnit)} and adjusting loss.total ` +
      `must be REJECTED (the CE branch must enforce loss-component coherence too)`,
  )
  if (result.ok) return
  const missingFailure = result.failures.find(
    (f: ReconciliationFailure) =>
      f.rule === 12 && typeof f.field_path === "string" && f.field_path.includes(dropUnit),
  )
  assert.ok(
    missingFailure,
    `expected a Rule 12 failure naming the missing unit ${JSON.stringify(dropUnit)}, got: ${JSON.stringify(
      result.failures.map((f) => ({ rule: f.rule, field_path: f.field_path })),
    )}`,
  )
})

test("G-018: golden WITH unit_order.output but complete per_output set still passes (no false positive)", () => {
  // Regression guard: the coherence check must NOT fire on a well-formed
  // receipt whose per_output keys exactly equal topology.unit_order.output.
  for (const name of ["iris.golden.jsonl", "softmax-ce.golden.jsonl"]) {
    const goldenPath = resolve(__dirname, `../fixtures/${name}`)
    assert.ok(existsSync(goldenPath), `required golden fixture missing: ${goldenPath}`)
    const receipt = JSON.parse(readFileSync(goldenPath, "utf-8"))
    const result = reconcileReceipt(receipt)
    assert.strictEqual(
      result.ok,
      true,
      `${name} (complete per_output set) must still pass Rule 12 coherence; got: ${JSON.stringify(
        result.ok === false ? result.failures.map((f) => ({ rule: f.rule, field_path: f.field_path })) : "ok",
      )}`,
    )
  }
})
