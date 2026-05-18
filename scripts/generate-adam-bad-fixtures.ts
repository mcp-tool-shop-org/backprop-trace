/**
 * v0.9.1 — Generate the Adam + AdamW + multi-step Adam adversarial fixture plate.
 *
 * Ten fixtures, each load-bearing for a distinct attack class on Adam/AdamW
 * observer-mode ingestion. Construction follows the v0.6/v0.7/v0.8/v0.9
 * mutate-then-re-emit pattern: read the canonical Adam golden, apply ONE
 * mutation per fixture, re-emit canonical bytes (or bypass canonical emit
 * for structurally-malformed fixtures), write the fixture + sibling
 * .meta.json describing the mutation + targeted rule.
 *
 * Plate (paired rule in parens, primary listed first; cross-fires noted):
 *
 *   1. adam.bad-bias-correction-omitted.jsonl     → Rule 24
 *      Mutate update value to use biased m/v instead of bias-corrected
 *      m_hat/v_hat. Rule 24 recomputes the update formula and fires.
 *
 *   2. adam.bad-beta-swap.jsonl                    → Rule 22
 *      Swap beta1 (0.9) and beta2 (0.999) in optimizer_config. m_after /
 *      v_after stay at their original values, so the recurrence check
 *      with the swapped betas fails.
 *
 *   3. adam.bad-epsilon-inside-sqrt.jsonl          → Rule 24
 *      Mutate update value to match the sqrt(v_hat + epsilon) formula
 *      instead of sqrt(v_hat) + epsilon (famous TF-vs-Keras-vs-PyTorch
 *      porting bug). Rule 24 fires.
 *
 *   4. adamw.bad-as-coupled-l2.jsonl               → Rule 24 (cross-fires Rule 7)
 *      Mutate AdamW receipt's parameters_after to use weight_before +
 *      update WITHOUT the decoupled-decay term (coupled L2 form). Rule 7's
 *      AdamW branch catches the parameter-update mismatch.
 *
 *   5. adam.bad-engine-recompute-disagrees-adam.jsonl → Rule 14
 *      Perturb updates[0].weight_after by 1e-3. Internal arithmetic
 *      (m, v, update formula) stays consistent; only engine recompute
 *      via Rule 14 catches the divergence. Load-bearing per Fang et al.
 *      2023 PoL spoofing class (arXiv:2208.03567).
 *
 *   6. adam.bad-amsgrad-confusion.jsonl            → Rule 20
 *      Remove state_before from one update (schema-tolerant because
 *      state_before is conditionally required at schema level — the
 *      schema's if/then guards both branches, but at-the-reconciler
 *      Rule 20 surfaces it cleanly).
 *
 *   7. adam.bad-zero-init-state-mismatch.jsonl     → Rule 22
 *      Mutate state_before.m for one parameter to non-zero at t=1.
 *      Adam mandates m_0 = v_0 = 0 (Kingma & Ba 2014 Alg 1 line 1).
 *      Rule 22 fires because m_after no longer matches the recurrence
 *      with the mutated m_before.
 *
 * Multi-step (mutates pytorch.adam.multi-step.golden.jsonl):
 *
 *   8. adam.bad-stale-moment-state.jsonl           → Rule 25
 *      Replace receipts[1] state_before with receipts[0] state_before
 *      (re-using stale state). Rule 25 catches the chain break.
 *
 *   9. adam.bad-timestep-off-by-one.jsonl          → Rule 25
 *      Mutate receipts[1].optimizer_config.t from 2 to 3 (skips ahead).
 *      Rule 25 fires on t monotonicity.
 *
 *  10. adam.bad-hyperparameter-inconstancy.jsonl   → Rule 26
 *      Mutate receipts[1].optimizer_config.beta1 from 0.9 to 0.95.
 *      Rule 26 catches the constancy violation.
 */

import { readFileSync, writeFileSync } from "node:fs"
import { emitGeneralReceipt } from "../src/emit.js"
import type { GeneralReceipt } from "../src/general-engine.js"

const ADAM_GOLDEN_PATH = "fixtures/external/pytorch.adam.golden.jsonl"
const ADAMW_GOLDEN_PATH = "fixtures/external/pytorch.adamw.golden.jsonl"
const ADAM_MULTI_GOLDEN_PATH =
  "fixtures/external/pytorch.adam.multi-step.golden.jsonl"

function freshAdam(): GeneralReceipt {
  return JSON.parse(
    readFileSync(ADAM_GOLDEN_PATH, "utf-8").trim(),
  ) as GeneralReceipt
}

function freshAdamW(): GeneralReceipt {
  return JSON.parse(
    readFileSync(ADAMW_GOLDEN_PATH, "utf-8").trim(),
  ) as GeneralReceipt
}

function freshAdamMulti(): GeneralReceipt[] {
  return readFileSync(ADAM_MULTI_GOLDEN_PATH, "utf-8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as GeneralReceipt)
}

function writeSingleBadFixture(
  filename: string,
  kind: string,
  receipt: GeneralReceipt,
  mutation: Record<string, unknown>,
  targetedRule: number,
  description: string,
  opts?: { bypassCanonicalEmit?: boolean; basedOn?: string },
): void {
  receipt.fixture_status = {
    authoring_state:
      "external_imported" as unknown as GeneralReceipt["fixture_status"]["authoring_state"],
    verification_state:
      "expected_to_fail_reconciliation" as unknown as GeneralReceipt["fixture_status"]["verification_state"],
    canonical: false as true,
  }
  const outPath = `fixtures/bad/${filename}`
  const bytes = opts?.bypassCanonicalEmit
    ? JSON.stringify(receipt) + "\n"
    : emitGeneralReceipt(receipt)
  writeFileSync(outPath, bytes)

  const meta = {
    schema_version: "0.1.0",
    fixture: `${filename.replace(/\.jsonl$/, "")}.meta`,
    describes: outPath,
    based_on:
      `Byte-precise mutation of ${opts?.basedOn ?? ADAM_GOLDEN_PATH}. ` +
      `v0.9.1 Adam/AdamW adversarial plate — each fixture surfaces a distinct ` +
      `attack class with a deterministic mutation.`,
    mutation,
    reconciliation_check_targeted_first: `Rule ${targetedRule}: ${description}`,
    purpose:
      `v0.9.1 Adam/AdamW anti-circularity fixture (kind: '${kind}'). Pressure-tests that the ` +
      `named rule fires BEFORE the reconciler consults fixture_status metadata.`,
    v0_9_1_trust_framing:
      `Adam-rule trust framing (load-bearing): Rules 22, 23, 24 are STRUCTURAL CONSISTENCY ` +
      `checks, NOT producer-authenticity checks. An attacker who controls every byte of the ` +
      `sidecar and recomputes a consistent (g, m, v, update) quadruple passes Rules 22-24 ` +
      `trivially — analogous to Rule 17's bundle-integrity caveat and the Fang et al. 2023 ` +
      `EuroS&P spoofing class against Proof-of-Learning (arXiv:2208.03567).`,
  }
  writeFileSync(
    outPath.replace(/\.jsonl$/, ".meta.json"),
    JSON.stringify(meta, null, 2) + "\n",
  )
  console.log(`wrote ${outPath}`)
}

function writeMultiStepBadFixture(
  filename: string,
  kind: string,
  receipts: GeneralReceipt[],
  mutation: Record<string, unknown>,
  targetedRule: number,
  description: string,
): void {
  for (const r of receipts) {
    r.fixture_status = {
      authoring_state:
        "external_imported" as unknown as GeneralReceipt["fixture_status"]["authoring_state"],
      verification_state:
        "expected_to_fail_reconciliation" as unknown as GeneralReceipt["fixture_status"]["verification_state"],
      canonical: false as true,
    }
  }
  const outPath = `fixtures/bad/${filename}`
  const bytes = receipts.map((r) => emitGeneralReceipt(r)).join("")
  writeFileSync(outPath, bytes)

  const meta = {
    schema_version: "0.1.0",
    fixture: `${filename.replace(/\.jsonl$/, "")}.meta`,
    describes: outPath,
    based_on:
      `Byte-precise mutation of ${ADAM_MULTI_GOLDEN_PATH}. ` +
      `v0.9.1 Adam multi-step adversarial plate.`,
    mutation,
    reconciliation_check_targeted_first: `Rule ${targetedRule}: ${description}`,
    purpose:
      `v0.9.1 Adam multi-step anti-circularity fixture (kind: '${kind}'). Pressure-tests that ` +
      `the named multi-step rule fires BEFORE the reconciler consults fixture_status metadata.`,
    v0_9_1_trust_framing:
      `Adam multi-step rules 25 (state chain) + 26 (config constancy) are STRUCTURAL ` +
      `consistency checks. Producer-authenticity caveat per Rule 17 / Fang et al. 2023 applies.`,
  }
  writeFileSync(
    outPath.replace(/\.jsonl$/, ".meta.json"),
    JSON.stringify(meta, null, 2) + "\n",
  )
  console.log(`wrote ${outPath}`)
}

// ============================================================================
// 1. adam.bad-bias-correction-omitted → Rule 24
// ============================================================================
{
  const r = freshAdam()
  r.fixture = "adam.bad-bias-correction-omitted"
  // Replace update with the value computed using biased m/v directly (no
  // bias correction). Rule 24 recomputes expected = lr * m_hat / (sqrt(v_hat) + eps)
  // and finds the stored value matches the un-corrected lr * m / (sqrt(v) + eps) instead.
  const targetIdx = 0
  const u = r.updates[targetIdx]!
  const opt = u.optimizer
  const m = opt.state_after!.m
  const v = opt.state_after!.v
  const lr = opt.learning_rate
  const epsilon = r.optimizer_config!.epsilon!
  const originalUpdate = u.update
  // Un-corrected (biased) update: uses raw m, v instead of m_hat, v_hat
  const biasedUpdate = (lr * m) / (Math.sqrt(v) + epsilon)
  u.update = biasedUpdate
  // For Rule 6 to not cascade-fire, also update weight_after consistently
  u.weight_after = u.weight_before + biasedUpdate
  r.parameters_after[u.parameter_id] = u.weight_after

  writeSingleBadFixture(
    "adam.bad-bias-correction-omitted.jsonl",
    "bias-correction-omitted",
    r,
    {
      kind: "mutate_update_to_use_biased_m_v_instead_of_bias_corrected_m_hat_v_hat",
      field_path: `updates[${targetIdx}].update`,
      parameter_id: u.parameter_id,
      original_update_with_bias_correction: originalUpdate,
      mutated_update_without_bias_correction: biasedUpdate,
      explanation:
        `Adam's update formula REQUIRES bias-corrected m_hat = m / (1 - beta1^t) and ` +
        `v_hat = v / (1 - beta2^t). Omitting bias correction (using raw m, v directly) ` +
        `under-scales early updates by a factor of (1 - beta^t). Rule 24 catches this.`,
    },
    24,
    "Adam parameter update inconsistent — stored update matches biased (un-corrected) m/v instead of bias-corrected m_hat/v_hat formula.",
  )
}

// ============================================================================
// 2. adam.bad-beta-swap → Rule 22
// ============================================================================
{
  const r = freshAdam()
  r.fixture = "adam.bad-beta-swap"
  const originalBeta1 = r.optimizer_config!.beta1!
  const originalBeta2 = r.optimizer_config!.beta2!
  r.optimizer_config!.beta1 = originalBeta2 // 0.999
  r.optimizer_config!.beta2 = originalBeta1 // 0.9
  // m_after / v_after stay at their original values (computed under
  // original betas). Rule 22a re-derives m_after using the swapped beta1
  // and finds disagreement. Rule 22b likewise.

  writeSingleBadFixture(
    "adam.bad-beta-swap.jsonl",
    "beta-swap",
    r,
    {
      kind: "swap_beta1_and_beta2_in_optimizer_config",
      field_path: "optimizer_config.{beta1,beta2}",
      original_beta1: originalBeta1,
      original_beta2: originalBeta2,
      mutated_beta1: originalBeta2,
      mutated_beta2: originalBeta1,
      explanation:
        `beta1 (first-moment decay) and beta2 (second-moment decay) swap. ` +
        `Kingma & Ba 2014 defaults: beta1=0.9, beta2=0.999. Swapping makes the ` +
        `first-moment decay slower than second-moment, which is the opposite of Adam's design. ` +
        `Rule 22a/22b detect the recurrence mismatch (m_after computed under swapped beta1 ` +
        `no longer matches the stored value).`,
    },
    22,
    "Adam moment recurrence violation — m_after/v_after were computed under original betas, but optimizer_config now declares swapped betas.",
  )
}

// ============================================================================
// 3. adam.bad-epsilon-inside-sqrt → Rule 24
// ============================================================================
{
  const r = freshAdam()
  r.fixture = "adam.bad-epsilon-inside-sqrt"
  const targetIdx = 0
  const u = r.updates[targetIdx]!
  const opt = u.optimizer
  const lr = opt.learning_rate
  const beta1 = r.optimizer_config!.beta1!
  const beta2 = r.optimizer_config!.beta2!
  const epsilon = r.optimizer_config!.epsilon!
  const t = r.optimizer_config!.t!
  const mHat = opt.state_after!.m / (1 - Math.pow(beta1, t))
  const vHat = opt.state_after!.v / (1 - Math.pow(beta2, t))
  const originalUpdate = u.update // lr * m_hat / (sqrt(v_hat) + epsilon)
  // Mutate to wrong form: lr * m_hat / sqrt(v_hat + epsilon)
  const wrongFormUpdate = (lr * mHat) / Math.sqrt(vHat + epsilon)
  u.update = wrongFormUpdate
  u.weight_after = u.weight_before + wrongFormUpdate
  r.parameters_after[u.parameter_id] = u.weight_after

  writeSingleBadFixture(
    "adam.bad-epsilon-inside-sqrt.jsonl",
    "epsilon-inside-sqrt",
    r,
    {
      kind: "mutate_update_to_apply_epsilon_inside_sqrt_not_outside",
      field_path: `updates[${targetIdx}].update`,
      parameter_id: u.parameter_id,
      original_update_pytorch_convention: originalUpdate,
      mutated_update_tf_legacy_convention: wrongFormUpdate,
      explanation:
        `Famous porting bug: PyTorch (and Kingma & Ba 2014 Alg 1 line 13) places epsilon ` +
        `OUTSIDE the sqrt: update = lr * m_hat / (sqrt(v_hat) + epsilon). Some TensorFlow ` +
        `versions and naive implementations apply epsilon inside: update = lr * m_hat / ` +
        `sqrt(v_hat + epsilon). The two diverge by O(epsilon) at small v_hat. v0.9.1 ` +
        `pins the PyTorch convention; Rule 24 catches the wrong placement.`,
    },
    24,
    "Adam parameter update inconsistent — stored update matches epsilon-inside-sqrt form, not PyTorch convention (epsilon outside).",
  )
}

// ============================================================================
// 4. adamw.bad-as-coupled-l2 → Rule 24 (cross-fires Rule 7)
// ============================================================================
{
  const r = freshAdamW()
  r.fixture = "adamw.bad-as-coupled-l2"
  const targetIdx = 0
  const u = r.updates[targetIdx]!
  // Mutate parameters_after to use SGD-style w_after = w_before + update
  // (forgetting the decoupled weight-decay term). For AdamW this is the
  // coupled-L2 vs decoupled distinction: when omitting the decoupled term
  // at the parameter step, the result LOOKS like Adam-with-no-weight-decay
  // instead of AdamW. Rule 7's AdamW branch catches this.
  const originalAfter = r.parameters_after[u.parameter_id]
  const wrongAfter = u.weight_before + u.update // no (1 - lr*wd) factor
  r.parameters_after[u.parameter_id] = wrongAfter
  u.weight_after = wrongAfter

  writeSingleBadFixture(
    "adamw.bad-as-coupled-l2.jsonl",
    "as-coupled-l2",
    r,
    {
      kind: "drop_decoupled_weight_decay_term_at_parameter_step",
      field_path: `updates[${targetIdx}].weight_after`,
      parameter_id: u.parameter_id,
      original_after_with_decoupled_decay: originalAfter,
      mutated_after_without_decoupled_decay: wrongAfter,
      explanation:
        `AdamW (Loshchilov & Hutter 2017 arXiv:1711.05101 Alg 2 line 12) applies decoupled ` +
        `weight decay DIRECTLY to the parameter at the parameter-update step: ` +
        `w_after = (1 - lr*wd) * w_before + update. Dropping the (1 - lr*wd) factor produces ` +
        `the SAME math as Adam with no weight decay (and NOT the same as Adam with coupled L2; ` +
        `coupled L2 folds wd into the gradient before the moment update). This bad fixture ` +
        `documents the most common AdamW porting mistake. Rule 7's AdamW branch catches it; ` +
        `Rule 24 may also cross-fire.`,
    },
    24,
    "AdamW decoupled weight-decay omitted — parameters_after computed as w_before + update (Adam-style) instead of (1 - lr*wd) * w_before + update (AdamW-style; Loshchilov & Hutter 2017 Alg 2 line 12).",
    { basedOn: ADAMW_GOLDEN_PATH },
  )
}

// ============================================================================
// 5. adam.bad-engine-recompute-disagrees-adam → Rule 14
// ============================================================================
{
  const r = freshAdam()
  r.fixture = "adam.bad-engine-recompute-disagrees-adam"
  const targetIdx = 0
  const u = r.updates[targetIdx]!
  // Perturb weight_after by a large delta. Internal arithmetic (m_after,
  // v_after, update formula) stays consistent — so Rules 20, 22, 23, 24
  // all pass. Only Rule 14's engine recompute catches the divergence.
  // This is the load-bearing fixture per Fang et al. 2023 PoL spoofing
  // class: structural consistency is necessary but NOT sufficient.
  const originalAfter = u.weight_after
  const mutatedAfter = originalAfter + 1e-3
  u.weight_after = mutatedAfter
  r.parameters_after[u.parameter_id] = mutatedAfter

  writeSingleBadFixture(
    "adam.bad-engine-recompute-disagrees-adam.jsonl",
    "engine-recompute-disagrees-adam",
    r,
    {
      kind: "perturb_weight_after_internal_arithmetic_stays_consistent",
      field_path: `updates[${targetIdx}].weight_after`,
      parameter_id: u.parameter_id,
      original_weight_after: originalAfter,
      mutated_weight_after: mutatedAfter,
      perturbation: 1e-3,
      explanation:
        `Per-update arithmetic (m_after, v_after, bias-corrected m_hat/v_hat, update formula) ` +
        `is internally consistent — Rules 20, 22, 23, 24 all pass. Only Rule 14's engine ` +
        `recompute catches the divergence. This load-bearing fixture proves that Adam-rule ` +
        `structural consistency is NECESSARY but NOT SUFFICIENT for producer authenticity; ` +
        `engine recompute (Rule 14) is the second line of defense and the Fang et al. 2023 ` +
        `PoL spoofing class (arXiv:2208.03567) maps directly here.`,
    },
    14,
    "Engine recompute differential — Adam-internal arithmetic consistent but weight_after stored value diverges from engine recomputation.",
  )
}

// ============================================================================
// 6. adam.bad-amsgrad-confusion → Rule 20
// ============================================================================
{
  const r = freshAdam()
  r.fixture = "adam.bad-amsgrad-confusion"
  const targetIdx = 0
  const u = r.updates[targetIdx]!
  // Drop state_before from one update entry. The schema's if/then guards
  // require state_before/state_after when optimizer.name in {adam, adamw};
  // schema validation may catch this first as a structural error, BUT
  // Rule 20 also catches it independently. Both rules surface the missing
  // shape. We label this "amsgrad-confusion" because it represents the
  // class of "operator claims Adam but ships state shape that doesn't
  // match Adam's required (m, v) pair" — including the AMSGrad case where
  // the operator wants to ship a third state field (max_v) but the schema
  // rejects extra fields (additionalProperties:false on AdamState).
  const originalStateBefore = u.optimizer.state_before
  delete (u.optimizer as { state_before?: unknown }).state_before

  writeSingleBadFixture(
    "adam.bad-amsgrad-confusion.jsonl",
    "amsgrad-confusion",
    r,
    {
      kind: "drop_state_before_from_one_adam_update",
      field_path: `updates[${targetIdx}].optimizer.state_before`,
      parameter_id: u.parameter_id,
      original_state_before: originalStateBefore as unknown,
      explanation:
        `Adam/AdamW updates REQUIRE state_before and state_after blocks per receipt.v0.5.0 ` +
        `schema (conditional if/then guard) and Rule 20. Dropping state_before represents the ` +
        `class of "operator claims Adam but ships state shape that doesn't match Adam's required ` +
        `(m, v) pair" — including the AMSGrad case where the operator wants a third state field ` +
        `(max_v / v_hat_max) but Adam's AdamState is closed-shape (additionalProperties:false). ` +
        `Rule 20 catches the missing state_before structurally.`,
    },
    20,
    "Optimizer-state shape consistency — Adam/AdamW update missing required state_before block.",
    { bypassCanonicalEmit: true },
  )
}

// ============================================================================
// 7. adam.bad-zero-init-state-mismatch → Rule 22
// ============================================================================
{
  const r = freshAdam()
  r.fixture = "adam.bad-zero-init-state-mismatch"
  const targetIdx = 0
  const u = r.updates[targetIdx]!
  // At t=1, Adam mandates m_0 = v_0 = 0 (Kingma & Ba 2014 Alg 1 line 1).
  // Mutate state_before.m to non-zero. m_after stays at its original
  // value (computed under the zero-init recurrence), so Rule 22a now sees
  // m_after != beta1 * (non-zero) + (1 - beta1) * gradient.
  const originalMBefore = u.optimizer.state_before!.m
  u.optimizer.state_before!.m = 0.5

  writeSingleBadFixture(
    "adam.bad-zero-init-state-mismatch.jsonl",
    "zero-init-state-mismatch",
    r,
    {
      kind: "set_state_before_m_to_nonzero_at_t_eq_1",
      field_path: `updates[${targetIdx}].optimizer.state_before.m`,
      parameter_id: u.parameter_id,
      original_m_before: originalMBefore,
      mutated_m_before: 0.5,
      t_value: r.optimizer_config!.t,
      explanation:
        `Adam initializes m_0 = v_0 = 0 (Kingma & Ba 2014 arXiv:1412.6980 Alg 1 line 1). ` +
        `At t=1 the FIRST step's state_before MUST be (m: 0, v: 0). Mutating m_before to ` +
        `non-zero contradicts the initialization. Rule 22a recomputes m_after = beta1 * ` +
        `state_before.m + (1 - beta1) * gradient with the mutated state_before and finds ` +
        `disagreement with the stored m_after (which was computed under the zero-init).`,
    },
    22,
    "Adam moment recurrence violation — state_before.m mutated to non-zero at t=1; m_after stored value derived from the zero-init recurrence no longer matches.",
  )
}

// ============================================================================
// MULTI-STEP fixtures (mutate pytorch.adam.multi-step.golden.jsonl)
// ============================================================================

// 8. adam.bad-stale-moment-state → Rule 25
{
  const receipts = freshAdamMulti()
  receipts[1]!.fixture = "adam.bad-stale-moment-state-step-1"
  // Replace receipts[1] state_before with receipts[0] state_before
  // (re-using stale state from step 0 instead of step 0's state_after).
  // Rule 25 catches: receipts[1].state_before != receipts[0].state_after.
  const targetParamId = receipts[1]!.updates[0]!.parameter_id
  const stepZeroBefore = receipts[0]!.updates.find(
    (u) => u.parameter_id === targetParamId,
  )!.optimizer.state_before!
  const originalStepOneBefore =
    receipts[1]!.updates[0]!.optimizer.state_before!
  receipts[1]!.updates[0]!.optimizer.state_before = {
    m: stepZeroBefore.m,
    v: stepZeroBefore.v,
  }

  writeMultiStepBadFixture(
    "adam.bad-stale-moment-state.jsonl",
    "stale-moment-state",
    receipts,
    {
      kind: "reuse_step_0_state_before_at_step_1_breaking_state_chain",
      field_path: `receipts[1].updates[0].optimizer.state_before`,
      parameter_id: targetParamId,
      step_0_state_before: stepZeroBefore,
      original_step_1_state_before: originalStepOneBefore,
      mutated_step_1_state_before: receipts[1]!.updates[0]!.optimizer.state_before,
      explanation:
        `Multi-step Adam requires every parameter's state to chain forward unbroken: ` +
        `receipts[k+1].updates[u].optimizer.state_before == receipts[k].updates[u].optimizer.state_after. ` +
        `Mutating step 1's state_before to step 0's state_before (instead of step 0's state_after) ` +
        `breaks the chain. Rule 25 catches the discrepancy.`,
    },
    25,
    "Optimizer-state chain broken — receipts[1].state_before does not match receipts[0].state_after for the same parameter.",
  )
}

// 9. adam.bad-timestep-off-by-one → Rule 25
{
  const receipts = freshAdamMulti()
  receipts[1]!.fixture = "adam.bad-timestep-off-by-one-step-1"
  // Mutate receipts[1].optimizer_config.t from 2 to 3 (skip ahead by one).
  // Rule 25 catches the t monotonicity violation (expected receipts[0].t + 1 = 2).
  const originalT = receipts[1]!.optimizer_config!.t
  receipts[1]!.optimizer_config!.t = 3

  writeMultiStepBadFixture(
    "adam.bad-timestep-off-by-one.jsonl",
    "timestep-off-by-one",
    receipts,
    {
      kind: "advance_t_by_2_instead_of_1_at_step_1",
      field_path: `receipts[1].optimizer_config.t`,
      original_t: originalT,
      mutated_t: 3,
      explanation:
        `Adam timestep MUST advance by exactly 1 per training step (Kingma & Ba 2014 Alg 1: ` +
        `t <- t + 1 once per step). Mutating step 1's t from 2 to 3 skips a step. Rule 25 ` +
        `catches the monotonicity violation (expected receipts[1].t == receipts[0].t + 1 = 2; ` +
        `got 3).`,
    },
    25,
    "Optimizer-state chain — receipts[1].optimizer_config.t advanced by 2 instead of 1; t monotonicity broken.",
  )
}

// 10. adam.bad-hyperparameter-inconstancy → Rule 26
{
  const receipts = freshAdamMulti()
  receipts[1]!.fixture = "adam.bad-hyperparameter-inconstancy-step-1"
  // Mutate receipts[1].optimizer_config.beta1 from 0.9 to 0.95.
  // Rule 26 catches the constancy violation (beta1 must be identical across bundle).
  const originalBeta1 = receipts[1]!.optimizer_config!.beta1
  receipts[1]!.optimizer_config!.beta1 = 0.95

  writeMultiStepBadFixture(
    "adam.bad-hyperparameter-inconstancy.jsonl",
    "hyperparameter-inconstancy",
    receipts,
    {
      kind: "drift_beta1_from_0_9_to_0_95_at_step_1",
      field_path: `receipts[1].optimizer_config.beta1`,
      original_beta1: originalBeta1,
      mutated_beta1: 0.95,
      explanation:
        `Adam hyperparameters {name, beta1, beta2, epsilon, weight_decay} MUST be IDENTICAL ` +
        `across all receipts in a multi-step bundle. learning_rate is EXCLUDED (LR schedules ` +
        `are legitimate). Drifting beta1 from 0.9 to 0.95 at step 1 violates the constancy ` +
        `invariant. Rule 26 catches this — analog of Rule 10 for trace identity. ` +
        `(NOTE: Rule 22 may ALSO fire on step 1 because m_after stored value at step 1 was ` +
        `computed under the original beta1=0.9, not the mutated 0.95.)`,
    },
    26,
    "Optimizer-config constancy — receipts[1].optimizer_config.beta1 (0.95) differs from receipts[0].optimizer_config.beta1 (0.9); hyperparameters must be identical across bundle.",
  )
}

console.log(`\n--- adam adversarial plate complete (10 bad fixtures) ---`)
