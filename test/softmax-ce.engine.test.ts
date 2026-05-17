/**
 * v0.5 — softmax+CE general-engine first-run test + byte-equality vs golden.
 *
 * Anti-circularity pin: this test re-runs runGeneralStep on SOFTMAX_CE_INPUT
 * and asserts the emitted bytes are IDENTICAL to fixtures/softmax-ce.golden.jsonl.
 * If a future engine refactor drifts the softmax forward, the CE loss, or
 * the dual_form emission, this test fails BEFORE the golden is regenerated.
 *
 * Mirrors the Mazur / XOR / iris / per-neuron-bias engine tests.
 */

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"
import { runGeneralStep } from "../src/general-engine.js"
import { emitGeneralReceipt } from "../src/emit.js"
import { SOFTMAX_CE_INPUT } from "../src/mazur.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const goldenPath = resolve(__dirname, "../fixtures/softmax-ce.golden.jsonl")

test("runGeneralStep(SOFTMAX_CE_INPUT) emits byte-equal to softmax-ce.golden.jsonl", () => {
  if (!existsSync(goldenPath)) {
    throw new Error(
      `softmax-ce golden missing at ${goldenPath}. Regenerate by running ` +
        `runGeneralStep(SOFTMAX_CE_INPUT) and writing the emitted JSONL to that path.`,
    )
  }
  const goldenBytes = readFileSync(goldenPath, "utf-8")
  const receipt = runGeneralStep(SOFTMAX_CE_INPUT)
  const emitted = emitGeneralReceipt(receipt)
  assert.strictEqual(
    emitted,
    goldenBytes,
    "engine emission must be byte-equal to the shipped golden. If this fails on a Node " +
      "version bump or runtime change, regenerate the softmax-ce golden AND all 7 " +
      "fixtures/bad/softmax-ce.bad-*.jsonl fixtures (via scripts/generate-softmax-ce-bad-fixtures.ts) " +
      "in the same commit. Math.exp + Math.log canaries in test/determinism.math-exp-canary.test.ts " +
      "pin the boundary values that softmax+CE depends on.",
  )
})

test("SOFTMAX_CE_INPUT receipt declares schema_version: 0.3.0", () => {
  const receipt = runGeneralStep(SOFTMAX_CE_INPUT)
  assert.strictEqual(
    receipt.schema_version,
    "0.3.0",
    "softmax+CE receipts must declare schema_version 0.3.0 (the additive-schema path)",
  )
})

test("SOFTMAX_CE_INPUT softmax outputs sum to 1.0 within tolerance", () => {
  const receipt = runGeneralStep(SOFTMAX_CE_INPUT)
  const sum =
    receipt.forward.o1!.out + receipt.forward.o2!.out + receipt.forward.o3!.out
  assert.ok(
    Math.abs(sum - 1.0) < 1e-12,
    `softmax outputs must sum to 1.0 within FP precision; got ${sum}`,
  )
})

test("SOFTMAX_CE_INPUT collapsed signal_value at o1 equals y_o1 - p_o1", () => {
  const receipt = runGeneralStep(SOFTMAX_CE_INPUT)
  const expected = 1 - receipt.forward.o1!.out // y_o1 = 1
  const actual = receipt.backward.output_error_signals.o1!.signal_value
  assert.strictEqual(
    actual,
    expected,
    "collapsed softmax+CE signal at o1 must equal y_o1 - p_o1 (descent direction)",
  )
})

test("SOFTMAX_CE_INPUT dual_form summed_value equals collapsed signal_value (Rule 13c property)", () => {
  const receipt = runGeneralStep(SOFTMAX_CE_INPUT)
  for (const u of receipt.topology.unit_order.output) {
    const sig = receipt.backward.output_error_signals[u]!
    const dual = sig.dual_form!
    assert.strictEqual(
      dual.summed_value,
      sig.signal_value,
      `dual_form.summed_value at output unit '${u}' must equal signal_value; ` +
        `Rule 13c verifies this property at the reconciler boundary`,
    )
  }
})

test("SOFTMAX_CE_INPUT dual_form jacobian_terms multiply consistently (Rule 13a property)", () => {
  const receipt = runGeneralStep(SOFTMAX_CE_INPUT)
  for (const u of receipt.topology.unit_order.output) {
    const sig = receipt.backward.output_error_signals[u]!
    const dual = sig.dual_form!
    for (const term of dual.jacobian_terms) {
      const product = term.factors.reduce((acc, f, i) => (i === 0 ? f.value : acc * f.value), 0)
      assert.strictEqual(
        term.term_value,
        product,
        `jacobian_term at (u='${u}', target='${term.target_unit}'): term_value must equal product of factors`,
      )
    }
  }
})

test("SOFTMAX_CE_INPUT CE loss.per_output[u] equals -y_u * log(p_u) (Rule 12 CE property)", () => {
  const receipt = runGeneralStep(SOFTMAX_CE_INPUT)
  for (const u of receipt.topology.unit_order.output) {
    const y = receipt.targets[u]!
    const p = receipt.forward[u]!.out
    const expected = y === 0 ? 0 : -y * Math.log(p)
    assert.strictEqual(
      receipt.loss.per_output[u],
      expected,
      `loss.per_output['${u}'] must equal -y * log(p) (with y=0 forced to 0)`,
    )
  }
})
