/**
 * v1.0 hero fixture — a RECOGNIZABLE dense multi-class classifier training
 * step, byte-reproducible on CPU.
 *
 * The "hello world" Mazur 2-2-2 net proves the math is right but reads as a
 * toy. This generator emits the canonical hero: a real, non-trivial image
 * classifier sized clearly beyond a toy —
 *
 *     9 pixel inputs  ->  16 ReLU hidden units  ->  4-class softmax  + CE loss
 *
 * The task is a downscaled handwritten-glyph recognizer. The 9 inputs are a
 * 3x3 pixel patch (row-major px_00..px_22), each pixel in {0.0, 1.0}. The
 * single training sample is a clean vertical stroke down the centre column —
 * a downscaled digit "1":
 *
 *     . # .          px_00=0 px_01=1 px_02=0
 *     . # .   <==>   px_10=0 px_11=1 px_12=0
 *     . # .          px_20=0 px_21=1 px_22=0
 *
 * The four output classes are the glyph hypotheses {one, four, seven, blank};
 * the one-hot target is `o_one`. So a cold reviewer reads the input as an
 * actual tiny glyph and the output as an actual classification — "yes, this
 * is real ML", not just a 2-2-2 arithmetic fixture.
 *
 * Architecture sizing (clearly beyond toy):
 *   - 9 inputs >= 8, 16 hidden >= 16, 4 outputs in [3, 10]  (all in scope)
 *   - 9*16 + 16*4 = 144 + 64 = 208 weights + 2 per-layer biases = 210 params
 *
 * Engine scope: single-hidden-layer input->hidden->output, with relu hidden +
 * softmax output + cross_entropy_softmax loss. No engine change, no schema
 * change — this validates against the same v0.3.0 receipt schema the shipped
 * softmax-ce.golden.jsonl uses, and reconciles ok:true through the full gate
 * (Rules 1-13 on the single step; Rules 9/10 multi-step on the 3-step variant).
 *
 * Determinism: the weights are NOT random noise — they are clean, signed,
 * interpretable decimals derived from the pixel/unit indices (see makeWeight),
 * so the receipt is readable and the net is non-degenerate (the centre-column
 * pixels drive `o_one`'s logit up; the softmax favourite is `o_one` but is not
 * saturated, so the CE loss at step 1 is meaningfully > 0).
 *
 * Reproducibility: this script reads NO files, only TS source. Running it from
 * a clean checkout reproduces both fixtures byte-for-byte. If V8 Math.exp /
 * Math.log drift, the determinism canaries in
 * test/determinism.math-exp-canary.test.ts fire BEFORE this output drifts.
 *
 *   npx tsx scripts/generate-hero-classifier-fixtures.ts
 *
 * Outputs:
 *   fixtures/hero-classifier.golden.jsonl            (single canonical step)
 *   fixtures/hero-classifier.multi-step.jsonl        (3-step chained run)
 */

import { writeFileSync } from "node:fs"
import { runGeneralStep } from "../src/general-engine.js"
import { emitGeneralReceipt } from "../src/emit.js"
import type { GeneralInput, NumericPolicy, BiasPolicy } from "../src/general-engine.js"
import type { Topology } from "../src/topology.js"

// ---------------------------------------------------------------------------
// Shared policies — identical to the v0.5 softmax+CE policies the shipped
// softmax-ce fixture uses. The widened tolerance ({atol: 1e-11, rtol: 1e-7})
// accommodates the softmax (subtract-max/exp/sum/divide) + CE log() chains.
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

// ---------------------------------------------------------------------------
// Topology declaration — built programmatically so the 208 weights iterate in
// a single canonical order (grouped by hidden unit for input->hidden, then by
// output unit for hidden->output) with NO chance of a hand-transcription drift
// between `parameters[]` and `parameter_order`.
// ---------------------------------------------------------------------------

// 3x3 pixel patch, row-major: px_00, px_01, px_02, px_10, ... px_22.
const INPUT_UNITS: string[] = []
for (let r = 0; r < 3; r++) {
  for (let c = 0; c < 3; c++) {
    INPUT_UNITS.push(`px_${r}${c}`)
  }
}

const HIDDEN_UNITS: string[] = Array.from({ length: 16 }, (_, i) => `h${i + 1}`)

// Four glyph-hypothesis classes. `o_one` is the correct class for the sample.
const OUTPUT_UNITS = ["o_one", "o_four", "o_seven", "o_blank"] as const

type Param = Topology["parameters"][number]
const parameters: Param[] = []
const parameter_order: string[] = []

// input -> hidden weights, grouped by hidden unit (h1's nine, then h2's, ...)
for (const h of HIDDEN_UNITS) {
  for (const px of INPUT_UNITS) {
    const id = `w_${px}_${h}`
    parameters.push({ id, role: "input_to_hidden_weight", from_unit: px, to_unit: h })
    parameter_order.push(id)
  }
}
// hidden -> output weights, grouped by output unit
for (const o of OUTPUT_UNITS) {
  for (const h of HIDDEN_UNITS) {
    const id = `w_${h}_${o}`
    parameters.push({ id, role: "hidden_to_output_weight", from_unit: h, to_unit: o })
    parameter_order.push(id)
  }
}
// per-layer biases last
parameters.push({ id: "b_hidden", role: "hidden_bias", applies_to_units: [...HIDDEN_UNITS] })
parameters.push({ id: "b_output", role: "output_bias", applies_to_units: [...OUTPUT_UNITS] })
parameter_order.push("b_hidden", "b_output")

const HERO_TOPOLOGY: Topology = {
  layers: ["input", "hidden", "output"],
  unit_order: {
    input: INPUT_UNITS,
    hidden: HIDDEN_UNITS,
    output: [...OUTPUT_UNITS],
  },
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

// ---------------------------------------------------------------------------
// Deterministic, interpretable weights. NOT random noise — each weight is a
// small signed decimal on a clean grid so the receipt reads cleanly and the
// net is non-degenerate. All values are exact 3-decimal multiples of 0.001 so
// they round-trip exactly through the 9-sig-fig canonical formatter.
// ---------------------------------------------------------------------------

// The sample glyph: vertical stroke down the centre column (a downscaled "1").
//   px_01, px_11, px_21 = 1.0 ; all other pixels = 0.0
const INPUTS: Record<string, number> = {}
for (const px of INPUT_UNITS) INPUTS[px] = 0.0
INPUTS["px_01"] = 1.0
INPUTS["px_11"] = 1.0
INPUTS["px_21"] = 1.0

// One-hot target: the glyph is a "1".
const TARGETS: Record<string, number> = {
  o_one: 1.0,
  o_four: 0.0,
  o_seven: 0.0,
  o_blank: 0.0,
}

// Input->hidden weight: a small alternating-sign value on a clean grid,
// indexed by (pixel position, hidden unit). The centre column gets a positive
// tilt so the stroke produces a positive pre-activation in the early hidden
// units (keeping several hidden units alive through the ReLU rather than all
// dead — a degenerate all-zero hidden layer would make the fixture boring).
function inputHiddenWeight(pxIndex: number, hIndex: number): number {
  const isCentreColumn = pxIndex % 3 === 1 // px_01, px_11, px_21
  const base = 0.02 * (((pxIndex * 7 + hIndex * 3) % 11) - 5) // in {-0.10 .. +0.10}
  const tilt = isCentreColumn ? 0.06 : 0.0
  return round3(base + tilt)
}

// Hidden->output weight: a small signed value indexed by (hidden unit, output
// class). The `o_one` class gets a positive bias toward the early hidden units
// so the correct class wins the softmax without saturating it.
function hiddenOutputWeight(hIndex: number, oIndex: number): number {
  const base = 0.03 * (((hIndex * 5 + oIndex * 2) % 9) - 4) // in {-0.12 .. +0.12}
  const correctClassTilt = oIndex === 0 ? 0.05 : 0.0 // o_one is index 0
  return round3(base + correctClassTilt)
}

function round3(x: number): number {
  return Math.round(x * 1000) / 1000
}

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

// ---------------------------------------------------------------------------
// Emit the single canonical step.
// ---------------------------------------------------------------------------
const step = runGeneralStep(HERO_INPUT)
writeFileSync("fixtures/hero-classifier.golden.jsonl", emitGeneralReceipt(step))
console.log("wrote fixtures/hero-classifier.golden.jsonl (1 record)")

const softmaxSum =
  step.forward.o_one!.out +
  step.forward.o_four!.out +
  step.forward.o_seven!.out +
  step.forward.o_blank!.out
console.log(`  softmax sum (should be ~1.0): ${softmaxSum}`)
console.log(
  `  p(o_one)=${step.forward.o_one!.out.toFixed(6)} ` +
    `p(o_four)=${step.forward.o_four!.out.toFixed(6)} ` +
    `p(o_seven)=${step.forward.o_seven!.out.toFixed(6)} ` +
    `p(o_blank)=${step.forward.o_blank!.out.toFixed(6)}`,
)
const aliveHidden = HIDDEN_UNITS.filter((h) => step.forward[h]!.out > 0).length
console.log(`  hidden units alive through ReLU: ${aliveHidden}/16`)
console.log(`  CE loss (step 1): ${step.loss.total}`)

// ---------------------------------------------------------------------------
// Multi-step variant — 3 chained steps proving Rules 9 (chain continuity) and
// 10 (trace coherence). Each step trains on the SAME glyph; step N's
// parameters_before == step N-1's parameters_after byte-for-byte. The CE loss
// should decrease step over step (the net learns the glyph).
// ---------------------------------------------------------------------------
const TRACE_ID = "00112233445566778899aabbccddeeff"
const records: string[] = []
let prevAfter = HERO_INPUT.parameters_before
const losses: number[] = []
for (let i = 0; i < 3; i++) {
  const s = runGeneralStep({
    ...HERO_INPUT,
    parameters_before: prevAfter,
    trace_id: TRACE_ID,
    step_index: i,
    fixture: `hero-classifier-multi-step-step-${i}`,
    metadata: {
      source:
        `scripts/generate-hero-classifier-fixtures.ts (9-px -> 16-ReLU -> 4-softmax glyph classifier; multi-step, step ${i})`,
      url_reference: "https://www.deeplearningbook.org/contents/mlp.html",
      gradient_convention: "descent_direction",
    },
  })
  records.push(emitGeneralReceipt(s))
  losses.push(s.loss.total)
  prevAfter = s.parameters_after
}
writeFileSync("fixtures/hero-classifier.multi-step.jsonl", records.join(""))
console.log("wrote fixtures/hero-classifier.multi-step.jsonl (3 records)")
console.log(`  CE loss over steps: ${losses.map((l) => l.toFixed(6)).join(" -> ")}`)
console.log(
  `  monotone decreasing (net is learning the glyph): ${losses[0]! > losses[1]! && losses[1]! > losses[2]!}`,
)
