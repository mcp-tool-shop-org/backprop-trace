/**
 * v1.0 hero fixture — engine + reconcile + verify-general test for the
 * recognizable 9-px -> 16-ReLU -> 4-softmax glyph classifier.
 *
 * The hero is the "yes, this is real ML" companion to the toy Mazur 2-2-2:
 * a real multi-class image classifier (a downscaled handwritten-glyph
 * recognizer) sized clearly beyond a toy — 9 pixel inputs, 16 ReLU hidden
 * units, a 4-class softmax head, cross-entropy loss. No engine change and no
 * schema change: it validates against the same v0.3.0 receipt schema the
 * shipped softmax-ce fixture uses.
 *
 * Anti-circularity pin: this test re-derives the golden from the same
 * deterministic construction the generator uses and asserts byte-equality
 * against fixtures/hero-classifier.golden.jsonl. If a future engine refactor
 * drifts the ReLU forward, the softmax, the CE loss, or the emission, this
 * fails BEFORE the golden is regenerated.
 *
 * Assertions:
 *   1. golden reconciles ok:true (the full single-step rule set)
 *   2. verify-general engine-reproduce is byte-equal (the canonical claim)
 *   3. softmax outputs sum to 1.0 within FP precision
 *   4. golden re-emits byte-identically (regression pin)
 *   5. the multi-step variant reconciles ok:true (Rules 9/10 chain coherence)
 *   6. the multi-step CE loss decreases (the net is actually learning)
 *
 * Mirrors test/softmax-ce.engine.test.ts.
 */

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"
import { runGeneralStep } from "../src/general-engine.js"
import type { GeneralInput, NumericPolicy, BiasPolicy } from "../src/general-engine.js"
import type { GeneralReceipt } from "../src/general-engine.js"
import type { Topology } from "../src/topology.js"
import { emitGeneralReceipt } from "../src/emit.js"
import { reconcileReceipt, reconcileMultiStep } from "../src/reconcile.js"
import { verifyGeneralEngineReproduces } from "../src/verify-engine.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, "..")
const goldenPath = resolve(repoRoot, "fixtures/hero-classifier.golden.jsonl")
const multiStepPath = resolve(repoRoot, "fixtures/hero-classifier.multi-step.jsonl")

// ---------------------------------------------------------------------------
// Reconstruct HERO_INPUT exactly as scripts/generate-hero-classifier-fixtures.ts
// does. Kept in lockstep with the generator — both produce the same canonical
// topology, weights, sample, and policies. This is the anti-circularity
// source: the test re-derives the receipt rather than parsing the golden as
// ground truth.
// ---------------------------------------------------------------------------
const NUMERIC_POLICY: NumericPolicy = {
  number_encoding: "decimal",
  precision_significant_digits: 9,
  rounding: "round_half_to_even",
  tolerance: { atol: 1e-11, rtol: 1e-7 },
  computation_order: "schema_defined",
  byte_output: {
    format: "jsonl",
    json_key_order: "schema_defined",
    trailing_zero_policy: "pad_to_significant_digits",
    indent: "none",
  },
}

const BIAS_POLICY: BiasPolicy = {
  mode: "constant",
  reason:
    "hero fixture pins biases as constant on step 1 to keep the engine in scope of the v0.5 softmax+CE doctrine (bias updates exercised elsewhere)",
  updated_in_step: false,
  reconciliation:
    "parameters_after[bias_id] === parameters_before[bias_id] for every bias parameter",
}

const INPUT_UNITS: string[] = []
for (let r = 0; r < 3; r++) {
  for (let c = 0; c < 3; c++) INPUT_UNITS.push(`px_${r}${c}`)
}
const HIDDEN_UNITS: string[] = Array.from({ length: 16 }, (_, i) => `h${i + 1}`)
const OUTPUT_UNITS = ["o_one", "o_four", "o_seven", "o_blank"] as const

type Param = Topology["parameters"][number]
const parameters: Param[] = []
const parameter_order: string[] = []
for (const h of HIDDEN_UNITS) {
  for (const px of INPUT_UNITS) {
    const id = `w_${px}_${h}`
    parameters.push({ id, role: "input_to_hidden_weight", from_unit: px, to_unit: h })
    parameter_order.push(id)
  }
}
for (const o of OUTPUT_UNITS) {
  for (const h of HIDDEN_UNITS) {
    const id = `w_${h}_${o}`
    parameters.push({ id, role: "hidden_to_output_weight", from_unit: h, to_unit: o })
    parameter_order.push(id)
  }
}
parameters.push({ id: "b_hidden", role: "hidden_bias", applies_to_units: [...HIDDEN_UNITS] })
parameters.push({ id: "b_output", role: "output_bias", applies_to_units: [...OUTPUT_UNITS] })
parameter_order.push("b_hidden", "b_output")

const HERO_TOPOLOGY: Topology = {
  layers: ["input", "hidden", "output"],
  unit_order: { input: INPUT_UNITS, hidden: HIDDEN_UNITS, output: [...OUTPUT_UNITS] },
  parameter_order,
  parameters,
  activation_hidden: "relu",
  activation_output: "softmax",
  loss: "cross_entropy_softmax",
  bias_sharing: "per_layer",
  input_size: 9,
  hidden_size: 16,
  output_size: 4,
}

function round3(x: number): number {
  return Math.round(x * 1000) / 1000
}
function inputHiddenWeight(pxIndex: number, hIndex: number): number {
  const isCentreColumn = pxIndex % 3 === 1
  const base = 0.02 * (((pxIndex * 7 + hIndex * 3) % 11) - 5)
  const tilt = isCentreColumn ? 0.06 : 0.0
  return round3(base + tilt)
}
function hiddenOutputWeight(hIndex: number, oIndex: number): number {
  const base = 0.03 * (((hIndex * 5 + oIndex * 2) % 9) - 4)
  const correctClassTilt = oIndex === 0 ? 0.05 : 0.0
  return round3(base + correctClassTilt)
}

const INPUTS: Record<string, number> = {}
for (const px of INPUT_UNITS) INPUTS[px] = 0.0
INPUTS["px_01"] = 1.0
INPUTS["px_11"] = 1.0
INPUTS["px_21"] = 1.0

const TARGETS: Record<string, number> = { o_one: 1.0, o_four: 0.0, o_seven: 0.0, o_blank: 0.0 }

const PARAMETERS_BEFORE: Record<string, number> = {}
for (let h = 0; h < HIDDEN_UNITS.length; h++) {
  for (let p = 0; p < INPUT_UNITS.length; p++) {
    PARAMETERS_BEFORE[`w_${INPUT_UNITS[p]}_${HIDDEN_UNITS[h]}`] = inputHiddenWeight(p, h)
  }
}
for (let o = 0; o < OUTPUT_UNITS.length; o++) {
  for (let h = 0; h < HIDDEN_UNITS.length; h++) {
    PARAMETERS_BEFORE[`w_${HIDDEN_UNITS[h]}_${OUTPUT_UNITS[o]}`] = hiddenOutputWeight(h, o)
  }
}
PARAMETERS_BEFORE["b_hidden"] = 0.1
PARAMETERS_BEFORE["b_output"] = 0.0

const HERO_INPUT: GeneralInput = {
  topology: HERO_TOPOLOGY,
  learning_rate: 0.1,
  inputs: INPUTS,
  targets: TARGETS,
  parameters_before: PARAMETERS_BEFORE,
  numeric_policy: NUMERIC_POLICY,
  bias_policy: BIAS_POLICY,
  fixture: "hero-classifier-engine-first-run",
  metadata: {
    source:
      "scripts/generate-hero-classifier-fixtures.ts HERO_INPUT (9-px -> 16-ReLU -> 4-softmax glyph classifier; sample = centre-column stroke 'one')",
    url_reference: "https://www.deeplearningbook.org/contents/mlp.html",
    gradient_convention: "descent_direction",
  },
}

function requireGolden(path: string): string {
  if (!existsSync(path)) {
    throw new Error(
      `hero golden missing at ${path}. Regenerate via ` +
        `npx tsx scripts/generate-hero-classifier-fixtures.ts`,
    )
  }
  return readFileSync(path, "utf-8")
}

// ---------------------------------------------------------------------------

test("hero golden re-emits byte-identically from the engine (anti-circularity pin)", () => {
  const goldenBytes = requireGolden(goldenPath)
  const receipt = runGeneralStep(HERO_INPUT)
  const emitted = emitGeneralReceipt(receipt)
  assert.strictEqual(
    emitted,
    goldenBytes,
    "engine emission must be byte-equal to the shipped hero golden. If this fails on a " +
      "Node version bump or engine change, regenerate via " +
      "scripts/generate-hero-classifier-fixtures.ts in the same commit. Math.exp + Math.log " +
      "canaries in test/determinism.math-exp-canary.test.ts pin the boundary values softmax+CE " +
      "depends on.",
  )
})

test("hero golden reconciles ok:true (full single-step rule set)", () => {
  const parsed: unknown = JSON.parse(requireGolden(goldenPath).trim())
  const result = reconcileReceipt(parsed)
  assert.ok(
    result.ok,
    result.ok
      ? ""
      : `hero golden must reconcile clean; failures: ${JSON.stringify(result.failures, null, 2)}`,
  )
})

test("hero golden passes verify-general engine-reproduce (byte-equal)", () => {
  const parsed = JSON.parse(requireGolden(goldenPath).trim()) as GeneralReceipt
  const result = verifyGeneralEngineReproduces(parsed)
  assert.ok(
    result.matches,
    result.matches
      ? ""
      : `engine reproduction must byte-equal the receipt; first differing byte at index ${
          (result as { firstDifferingByte: number }).firstDifferingByte
        }`,
  )
})

test("hero declares schema_version 0.3.0 (the softmax+CE additive-schema path)", () => {
  const receipt = runGeneralStep(HERO_INPUT)
  assert.strictEqual(receipt.schema_version, "0.3.0")
})

test("hero is sized beyond a toy: 9 inputs, 16 hidden, 4 outputs, 210 parameters", () => {
  const receipt = runGeneralStep(HERO_INPUT)
  assert.strictEqual(receipt.topology.input_size, 9)
  assert.strictEqual(receipt.topology.hidden_size, 16)
  assert.strictEqual(receipt.topology.output_size, 4)
  // 9*16 + 16*4 weights + 2 biases
  assert.strictEqual(receipt.topology.parameter_order.length, 9 * 16 + 16 * 4 + 2)
  assert.strictEqual(receipt.topology.activation_hidden, "relu")
  assert.strictEqual(receipt.topology.activation_output, "softmax")
  assert.strictEqual(receipt.topology.loss, "cross_entropy_softmax")
})

test("hero softmax outputs sum to 1.0 within FP precision", () => {
  const receipt = runGeneralStep(HERO_INPUT)
  let sum = 0
  for (const o of OUTPUT_UNITS) sum += receipt.forward[o]!.out
  assert.ok(
    Math.abs(sum - 1.0) < 1e-12,
    `softmax outputs must sum to 1.0 within FP precision; got ${sum}`,
  )
})

test("hero ReLU hidden layer has live units (gradient actually flows)", () => {
  const receipt = runGeneralStep(HERO_INPUT)
  const alive = HIDDEN_UNITS.filter((h) => receipt.forward[h]!.out > 0).length
  // A degenerate all-dead ReLU hidden layer would make the fixture vacuous —
  // assert at least one unit is active so the backward pass exercises real
  // ReLU subgradient routing (out > 0 ? 1 : 0).
  assert.ok(alive >= 1, `expected at least one live ReLU hidden unit; got ${alive}/16`)
  // ReLU outputs are non-negative by construction (max(0, net)).
  for (const h of HIDDEN_UNITS) {
    assert.ok(receipt.forward[h]!.out >= 0, `ReLU output for ${h} must be >= 0`)
  }
})

test("hero correct class o_one is the softmax favourite but not saturated", () => {
  const receipt = runGeneralStep(HERO_INPUT)
  const p = (u: string) => receipt.forward[u]!.out
  for (const o of OUTPUT_UNITS) {
    if (o === "o_one") continue
    assert.ok(p("o_one") > p(o), `p(o_one)=${p("o_one")} must exceed p(${o})=${p(o)}`)
  }
  // Not collapsed to 1.0 — the CE loss at step 1 must be a meaningful > 0.
  assert.ok(p("o_one") < 0.9, `p(o_one)=${p("o_one")} should not be saturated`)
  assert.ok(receipt.loss.total > 0, "CE loss at step 1 must be meaningfully > 0")
})

test("hero CE loss.per_output[u] equals -y_u * log(p_u) (Rule 12 CE property)", () => {
  const receipt = runGeneralStep(HERO_INPUT)
  for (const u of OUTPUT_UNITS) {
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

test("hero multi-step variant reconciles ok:true (Rules 9/10 chain coherence)", () => {
  if (!existsSync(multiStepPath)) {
    throw new Error(
      `hero multi-step golden missing at ${multiStepPath}. Regenerate via ` +
        `npx tsx scripts/generate-hero-classifier-fixtures.ts`,
    )
  }
  const lines = readFileSync(multiStepPath, "utf-8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
  assert.strictEqual(lines.length, 3, "multi-step hero must have exactly 3 records")
  const receipts = lines.map((l) => JSON.parse(l) as unknown)
  const result = reconcileMultiStep(receipts)
  assert.ok(
    result.ok,
    result.ok
      ? ""
      : `hero multi-step must reconcile clean; failures: ${JSON.stringify(result.failures, null, 2)}`,
  )
})

test("hero multi-step CE loss decreases step over step (the net learns the glyph)", () => {
  const lines = readFileSync(multiStepPath, "utf-8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
  const losses = lines.map((l) => (JSON.parse(l) as GeneralReceipt).loss.total)
  assert.ok(
    losses[0]! > losses[1]! && losses[1]! > losses[2]!,
    `CE loss must decrease across steps; got ${losses.join(" -> ")}`,
  )
})
