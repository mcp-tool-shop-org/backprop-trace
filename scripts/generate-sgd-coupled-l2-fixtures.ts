/**
 * v0.13 — Generate the SGD coupled-L2 weight-decay fixture plate (the
 * documented Rule 7 "third branch"). Engine-emitted GOOD goldens + a
 * byte-precise BAD adversarial plate (anti-circularity: bad receipts precede
 * good receipts; Csmith / CompCert lineage).
 *
 * Coupled L2 (PyTorch torch.optim.SGD(weight_decay=lambda)): the decay folds
 * into the GRADIENT before the buffer/update. In the engine's descent-direction
 * storage: grad_eff = gradient - wd*param. DISTINCT from AdamW's DECOUPLED decay
 * (applied to the parameter at the update step, never entering the gradient).
 *
 * GOOD goldens (engine-emitted, byte-reproducible):
 *   - fixtures/sgd-coupled-l2.golden.jsonl              (plain sgd + wd, single)
 *   - fixtures/sgd-momentum-coupled-l2.golden.jsonl     (sgd_momentum + wd, single)
 *   - fixtures/sgd-momentum-coupled-l2.multi-step.jsonl (sgd_momentum + wd, 2 steps)
 *
 * BAD plate (mutate-then-re-emit; meta declares the primary rule):
 *   1. sgd-coupled-l2.bad-decay-dropped.jsonl   → Rule 5  (plain sgd: update/weight_after
 *      computed as if wd=0 — the coupled-L2 term silently dropped)
 *   2. sgd-coupled-l2.bad-as-decoupled.jsonl    → Rule 7  (the AdamW-style mistake: the
 *      decay is NOT folded into the gradient/update, instead applied as a decoupled
 *      (1 - lr*wd) shrink on the parameter — coupled receipt, decoupled math)
 *   3. sgd-coupled-l2.bad-wrong-lambda.jsonl    → Rule 21 (sgd_momentum: optimizer_config.
 *      weight_decay mutated so the stored buffer was computed under a different lambda)
 *
 * Doctrine map additions land in test/reconcile.doctrine.test.ts.
 */

import { writeFileSync } from "node:fs"
import { emitGeneralReceipt } from "../src/emit.js"
import { runGeneralStep, type GeneralInput, type GeneralReceipt, type MomentumState } from "../src/general-engine.js"

const MAZUR_TOPOLOGY = {
  layers: ["input", "hidden", "output"] as const,
  unit_order: { input: ["i1", "i2"], hidden: ["h1", "h2"], output: ["o1", "o2"] },
  parameter_order: [
    "w_i1_h1", "w_i2_h1", "w_i1_h2", "w_i2_h2",
    "w_h1_o1", "w_h2_o1", "w_h1_o2", "w_h2_o2",
    "b_hidden", "b_output",
  ],
  parameters: [
    { id: "w_i1_h1", role: "input_to_hidden_weight" as const, from_unit: "i1", to_unit: "h1" },
    { id: "w_i2_h1", role: "input_to_hidden_weight" as const, from_unit: "i2", to_unit: "h1" },
    { id: "w_i1_h2", role: "input_to_hidden_weight" as const, from_unit: "i1", to_unit: "h2" },
    { id: "w_i2_h2", role: "input_to_hidden_weight" as const, from_unit: "i2", to_unit: "h2" },
    { id: "w_h1_o1", role: "hidden_to_output_weight" as const, from_unit: "h1", to_unit: "o1" },
    { id: "w_h2_o1", role: "hidden_to_output_weight" as const, from_unit: "h2", to_unit: "o1" },
    { id: "w_h1_o2", role: "hidden_to_output_weight" as const, from_unit: "h1", to_unit: "o2" },
    { id: "w_h2_o2", role: "hidden_to_output_weight" as const, from_unit: "h2", to_unit: "o2" },
    { id: "b_hidden", role: "hidden_bias" as const, applies_to_units: ["h1", "h2"] },
    { id: "b_output", role: "output_bias" as const, applies_to_units: ["o1", "o2"] },
  ],
  activation_hidden: "sigmoid" as const,
  activation_output: "sigmoid" as const,
  loss: "half_squared_error" as const,
  bias_sharing: "per_layer" as const,
  input_size: 2,
  hidden_size: 2,
  output_size: 2,
}

const PARAMETERS = {
  w_i1_h1: 0.15, w_i2_h1: 0.20, w_i1_h2: 0.25, w_i2_h2: 0.30,
  w_h1_o1: 0.40, w_h2_o1: 0.45, w_h1_o2: 0.50, w_h2_o2: 0.55,
  b_hidden: 0.35, b_output: 0.60,
}
const INPUTS = { i1: 0.05, i2: 0.10 }
const TARGETS = { o1: 0.01, o2: 0.99 }
const NUMERIC_POLICY = {
  number_encoding: "decimal" as const,
  precision_significant_digits: 9,
  rounding: "round_half_to_even" as const,
  tolerance: { atol: 1e-11, rtol: 1e-7 },
  computation_order: "schema_defined" as const,
  byte_output: {
    format: "jsonl" as const,
    json_key_order: "schema_defined" as const,
    trailing_zero_policy: "pad_to_significant_digits" as const,
    indent: "none" as const,
  },
}
const BIAS_POLICY = {
  mode: "constant" as const,
  reason: "Mazur convention — biases fixed on the step",
  updated_in_step: false,
  reconciliation: "biases constant for coupled-L2 golden",
}
const LR = 0.5
const WD = 0.01
const MU = 0.9
const TRACE_ID = "c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0"

const zeroMomentum = (): Record<string, MomentumState> => {
  const s: Record<string, MomentumState> = {}
  for (const pid of Object.keys(PARAMETERS)) {
    if (pid.startsWith("b_")) continue
    s[pid] = { buffer: 0 }
  }
  return s
}

// --- GOOD: plain sgd + coupled L2 (single step) ----------------------------
const sgdSingle = runGeneralStep({
  topology: MAZUR_TOPOLOGY,
  learning_rate: LR,
  inputs: INPUTS,
  targets: TARGETS,
  parameters_before: PARAMETERS,
  numeric_policy: NUMERIC_POLICY,
  bias_policy: BIAS_POLICY,
  fixture: "sgd-coupled-l2-engine-first-run",
  optimizer_config: { name: "sgd", learning_rate: LR, weight_decay: WD },
})
writeFileSync("fixtures/sgd-coupled-l2.golden.jsonl", emitGeneralReceipt(sgdSingle))
console.log("wrote fixtures/sgd-coupled-l2.golden.jsonl (plain sgd + coupled L2)")

// --- GOOD: sgd_momentum + coupled L2 (single step) -------------------------
const momSingle = runGeneralStep({
  topology: MAZUR_TOPOLOGY,
  learning_rate: LR,
  inputs: INPUTS,
  targets: TARGETS,
  parameters_before: PARAMETERS,
  numeric_policy: NUMERIC_POLICY,
  bias_policy: BIAS_POLICY,
  fixture: "sgd-momentum-coupled-l2-engine-first-run",
  optimizer_config: { name: "sgd_momentum", learning_rate: LR, momentum: MU, weight_decay: WD },
  optimizer_state_before: zeroMomentum(),
})
writeFileSync("fixtures/sgd-momentum-coupled-l2.golden.jsonl", emitGeneralReceipt(momSingle))
console.log("wrote fixtures/sgd-momentum-coupled-l2.golden.jsonl (sgd_momentum + coupled L2)")

// --- GOOD: sgd_momentum + coupled L2 (multi-step, 2 steps) -----------------
// Step 0: zero buffer. Step 1: buffer + params chained from step 0.
const stepInput = (
  step_index: number,
  params: Record<string, number>,
  stateBefore: Record<string, MomentumState>,
): GeneralInput => ({
  topology: MAZUR_TOPOLOGY,
  learning_rate: LR,
  inputs: INPUTS,
  targets: TARGETS,
  parameters_before: params,
  numeric_policy: NUMERIC_POLICY,
  bias_policy: BIAS_POLICY,
  fixture: `sgd-momentum-coupled-l2-multi-step-${step_index}`,
  trace_id: TRACE_ID,
  step_index,
  optimizer_config: { name: "sgd_momentum", learning_rate: LR, momentum: MU, weight_decay: WD },
  optimizer_state_before: stateBefore,
})

const step0 = runGeneralStep(stepInput(0, PARAMETERS, zeroMomentum()))
// Chain: step 1's parameters_before = step 0's parameters_after; state_before =
// step 0's per-parameter state_after.
const step1StateBefore: Record<string, MomentumState> = {}
for (const u of step0.updates) {
  if (u.parameter_id.startsWith("b_")) continue
  step1StateBefore[u.parameter_id] = u.optimizer.state_after as MomentumState
}
const step1 = runGeneralStep(stepInput(1, step0.parameters_after, step1StateBefore))
writeFileSync(
  "fixtures/sgd-momentum-coupled-l2.multi-step.jsonl",
  emitGeneralReceipt(step0) + emitGeneralReceipt(step1),
)
console.log("wrote fixtures/sgd-momentum-coupled-l2.multi-step.jsonl (2-step sgd_momentum + coupled L2)")

// ===========================================================================
// BAD plate
// ===========================================================================

function markBad(r: GeneralReceipt): void {
  r.fixture_status = {
    authoring_state:
      "external_imported" as unknown as GeneralReceipt["fixture_status"]["authoring_state"],
    verification_state:
      "expected_to_fail_reconciliation" as unknown as GeneralReceipt["fixture_status"]["verification_state"],
    canonical: false as true,
  }
}

function writeBad(
  filename: string,
  kind: string,
  receipt: GeneralReceipt,
  mutation: Record<string, unknown>,
  targetedRule: number,
  description: string,
  basedOn: string,
): void {
  markBad(receipt)
  const outPath = `fixtures/bad/${filename}`
  writeFileSync(outPath, emitGeneralReceipt(receipt))
  const meta = {
    schema_version: "0.1.0",
    fixture: `${filename.replace(/\.jsonl$/, "")}.meta`,
    describes: outPath,
    based_on:
      `Byte-precise mutation of ${basedOn}. v0.13 SGD coupled-L2 weight-decay ` +
      `adversarial plate (the documented Rule 7 third branch). Each fixture surfaces a ` +
      `distinct attack class with a deterministic mutation.`,
    mutation,
    reconciliation_check_targeted_first: `Rule ${targetedRule}: ${description}`,
    purpose:
      `v0.13 coupled-L2 anti-circularity fixture (kind: '${kind}'). Pressure-tests that the ` +
      `named rule fires BEFORE the reconciler consults fixture_status metadata.`,
    v0_13_trust_framing:
      `SGD coupled L2 (the Rule 7 third branch) is a STRUCTURAL CONSISTENCY check, NOT a ` +
      `producer-authenticity check. Coupled L2 (grad' = grad + lambda*theta folded into the ` +
      `gradient before the buffer) is DISTINCT from AdamW's DECOUPLED weight decay ` +
      `((1 - lr*wd)*theta applied at the parameter step); conflating them is the exact error ` +
      `this plate guards against. An attacker who controls every byte and recomputes a ` +
      `consistent (g, buffer, update) triple passes trivially — Fang et al. 2023 EuroS&P ` +
      `spoofing class (arXiv:2208.03567).`,
  }
  writeFileSync(outPath.replace(/\.jsonl$/, ".meta.json"), JSON.stringify(meta, null, 2) + "\n")
  console.log(`wrote ${outPath} (Rule ${targetedRule})`)
}

// 1. decay-dropped (plain sgd) → Rule 5
//    The update + weight_after are recomputed as if weight_decay were 0
//    (update = lr*gradient, dropping the coupled-L2 grad_eff fold). The
//    optimizer_config still declares weight_decay=WD, so Rule 5 recomputes
//    lr*(gradient - wd*param) and the stored no-decay update disagrees.
{
  const r = JSON.parse(emitGeneralReceipt(sgdSingle)) as GeneralReceipt
  r.fixture = "sgd-coupled-l2.bad-decay-dropped"
  const idx = r.updates.findIndex((u) => !u.parameter_id.startsWith("b_"))
  const u = r.updates[idx]!
  const lr = u.optimizer.learning_rate
  const originalUpdate = u.update
  const noDecayUpdate = lr * u.gradient // drops the -wd*param fold
  u.update = noDecayUpdate
  u.weight_after = u.weight_before + noDecayUpdate
  r.parameters_after[u.parameter_id] = u.weight_after
  writeBad(
    "sgd-coupled-l2.bad-decay-dropped.jsonl",
    "decay-dropped",
    r,
    {
      kind: "recompute_update_as_if_weight_decay_zero",
      field_path: `updates[${idx}].update`,
      parameter_id: u.parameter_id,
      declared_weight_decay: WD,
      original_update_with_coupled_l2: originalUpdate,
      mutated_update_no_decay: noDecayUpdate,
      explanation:
        `optimizer_config.weight_decay declares lambda=${WD} (coupled L2). The correct update ` +
        `folds the decay into the effective descent gradient: grad_eff = gradient - wd*param, ` +
        `update = lr*grad_eff. This mutation drops the decay term — update = lr*gradient (the ` +
        `wd=0 path). Rule 5 recomputes lr*(gradient - wd*weight_before) and the stored no-decay ` +
        `update disagrees. This is the most common coupled-L2 omission: declaring weight_decay ` +
        `but never actually applying it.`,
    },
    5,
    "Update value inconsistent with coupled-L2 — declared weight_decay > 0 but update == lr*gradient (decay term dropped) instead of lr*(gradient - wd*weight_before).",
    "fixtures/sgd-coupled-l2.golden.jsonl",
  )
}

// 2. as-decoupled (plain sgd) → Rule 7
//    The AdamW-style mistake: the update is left at the NO-DECAY value
//    (update = lr*gradient), and the decay is instead applied as a DECOUPLED
//    (1 - lr*wd) shrink on the parameter: weight_after = (1 - lr*wd)*before + update.
//    But the optimizer is plain "sgd" (coupled L2), which has NO AdamW branch —
//    Rule 7 recomputes weight_after = before + update and the decoupled value
//    disagrees. (Rule 5 also cross-fires on the no-decay update; Rule 7 is the
//    parameter-step landing of the decoupled-vs-coupled confusion, mirroring the
//    AdamW as-coupled-l2 fixture's Rule 7 framing.)
{
  const r = JSON.parse(emitGeneralReceipt(sgdSingle)) as GeneralReceipt
  r.fixture = "sgd-coupled-l2.bad-as-decoupled"
  const idx = r.updates.findIndex((u) => !u.parameter_id.startsWith("b_"))
  const u = r.updates[idx]!
  const lr = u.optimizer.learning_rate
  const originalUpdate = u.update
  const originalAfter = u.weight_after
  // No-decay update (decay NOT in the gradient) ...
  const noDecayUpdate = lr * u.gradient
  // ... then a DECOUPLED shrink on the parameter (the AdamW formula, wrong here).
  const decoupledAfter = (1 - lr * WD) * u.weight_before + noDecayUpdate
  u.update = noDecayUpdate
  u.weight_after = decoupledAfter
  r.parameters_after[u.parameter_id] = decoupledAfter
  writeBad(
    "sgd-coupled-l2.bad-as-decoupled.jsonl",
    "as-decoupled",
    r,
    {
      kind: "apply_decoupled_adamw_shrink_instead_of_coupled_l2",
      field_path: `parameters_after.${u.parameter_id}`,
      parameter_id: u.parameter_id,
      declared_weight_decay: WD,
      original_update_coupled: originalUpdate,
      original_weight_after_coupled: originalAfter,
      mutated_update_no_decay: noDecayUpdate,
      mutated_weight_after_decoupled: decoupledAfter,
      explanation:
        `The AdamW mistake: instead of folding the decay into the gradient (coupled L2, ` +
        `update = lr*(gradient - wd*param)), this receipt leaves the update at the no-decay ` +
        `value (lr*gradient) and applies a DECOUPLED (1 - lr*wd) shrink to the parameter at the ` +
        `update step (weight_after = (1 - lr*wd)*weight_before + update). But the optimizer is ` +
        `plain 'sgd' — there is NO AdamW decoupled branch for it. Rule 7 recomputes ` +
        `weight_after = weight_before + update (SGD/coupled) and the decoupled value disagrees. ` +
        `This is precisely the coupled-vs-decoupled conflation the AdamW docs warn against, in ` +
        `reverse: applying decoupled math to a coupled optimizer.`,
    },
    7,
    "Final-state consistency — parameters_after applies a DECOUPLED (1 - lr*wd) shrink (the AdamW formula), but plain SGD coupled L2 requires weight_after = weight_before + update (decay lives in the gradient/update, not a separate parameter-step term).",
    "fixtures/sgd-coupled-l2.golden.jsonl",
  )
}

// 3. wrong-lambda (sgd_momentum) → Rule 21
//    optimizer_config.weight_decay is mutated to a DIFFERENT value than the
//    buffer was computed under. The buffer_after was computed with WD=0.01;
//    declaring weight_decay=0.05 makes Rule 21a recompute
//    buffer_after = mu*buffer_before + (1-tau)*(gradient - 0.05*param), which
//    disagrees with the stored buffer (computed under wd=0.01).
{
  const r = JSON.parse(emitGeneralReceipt(momSingle)) as GeneralReceipt
  r.fixture = "sgd-momentum-coupled-l2.bad-wrong-lambda"
  const originalWd = r.optimizer_config!.weight_decay
  const wrongWd = 0.05
  r.optimizer_config!.weight_decay = wrongWd
  writeBad(
    "sgd-momentum-coupled-l2.bad-wrong-lambda.jsonl",
    "wrong-lambda",
    r,
    {
      kind: "swap_optimizer_config_weight_decay_from_0_01_to_0_05",
      field_path: "optimizer_config.weight_decay",
      original_weight_decay: originalWd,
      mutated_weight_decay: wrongWd,
      explanation:
        `The buffer_after on every weight update was computed under coupled-L2 lambda=${WD} ` +
        `(grad_eff = gradient - 0.01*param). Mutating optimizer_config.weight_decay to 0.05 ` +
        `makes Rule 21a recompute buffer_after = mu*buffer_before + (1-dampening)*(gradient - ` +
        `0.05*param), which disagrees with the stored buffer (computed under 0.01). Rule 21a ` +
        `catches the wrong lambda — analogous to the momentum coefficient-swapped fixture, but ` +
        `on the weight_decay hyperparameter.`,
    },
    21,
    "SGD momentum buffer recurrence — buffer_after was computed under coupled-L2 lambda=0.01 but optimizer_config.weight_decay declares 0.05; the decay-augmented recurrence disagrees.",
    "fixtures/sgd-momentum-coupled-l2.golden.jsonl",
  )
}

console.log("\n--- SGD coupled-L2 fixture plate complete (3 good goldens + 3 bad fixtures) ---")
