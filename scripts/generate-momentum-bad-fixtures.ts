/**
 * v0.9.2 — Generate the classical PyTorch-style SGD momentum adversarial
 * fixture plate. Six fixtures: 5 user-locked + 1 Fang-analog Rule-14 fixture
 * (matches v0.9.1 Adam plate's load-bearing Fang spoofing pattern).
 *
 * Mutate-then-re-emit pattern (per v0.6/v0.7/v0.8/v0.9.1 precedent). Each
 * fixture mutates ONE field; meta file declares the primary rule; bypass
 * canonical emit when structural malformations preclude canonical emission.
 *
 * Plate:
 *   1. momentum.bad-coefficient-omitted.jsonl      → Rule 20 (mu missing from config)
 *   2. momentum.bad-coefficient-swapped.jsonl      → Rule 21 (mu wrong value; recurrence breaks)
 *   3. momentum.bad-formula-mismatch.jsonl         → Rule 21 (update uses unrecognized form;
 *      scope-agnostic phrasing covers the Nesterov-deferred case)
 *   4. momentum-multi-step.bad-stale-buffer.jsonl  → Rule 25 (chain break, value-mutation)
 *   5. momentum-multi-step.bad-buffer-drop.jsonl   → Rule 20 (chain break, structural drop)
 *   6. momentum.bad-engine-recompute-disagrees-momentum.jsonl → Rule 14 (Fang-analog;
 *      internally consistent buffer + update, weight_after perturbed)
 *
 * Doctrine map additions are landed alongside in
 * test/reconcile.doctrine.test.ts (FILENAME_KIND_TO_RULE block).
 */

import { readFileSync, writeFileSync } from "node:fs"
import { emitGeneralReceipt } from "../src/emit.js"
import type { GeneralReceipt } from "../src/general-engine.js"

const SINGLE_GOLDEN_PATH = "fixtures/external/pytorch.sgd-momentum.golden.jsonl"
const MULTI_GOLDEN_PATH = "fixtures/external/pytorch.sgd-momentum.multi-step.golden.jsonl"
// v0.9.3 — Nesterov-specific source goldens.
const NESTEROV_SINGLE_GOLDEN_PATH = "fixtures/external/pytorch.sgd-momentum.nesterov.golden.jsonl"
const NESTEROV_MULTI_GOLDEN_PATH = "fixtures/external/pytorch.sgd-momentum.nesterov.multi-step.golden.jsonl"

function freshSingle(): GeneralReceipt {
  return JSON.parse(
    readFileSync(SINGLE_GOLDEN_PATH, "utf-8").trim(),
  ) as GeneralReceipt
}

function freshMulti(): GeneralReceipt[] {
  return readFileSync(MULTI_GOLDEN_PATH, "utf-8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as GeneralReceipt)
}

function freshNesterovSingle(): GeneralReceipt {
  return JSON.parse(
    readFileSync(NESTEROV_SINGLE_GOLDEN_PATH, "utf-8").trim(),
  ) as GeneralReceipt
}

function freshNesterovMulti(): GeneralReceipt[] {
  return readFileSync(NESTEROV_MULTI_GOLDEN_PATH, "utf-8")
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
      `Byte-precise mutation of ${opts?.basedOn ?? SINGLE_GOLDEN_PATH}. ` +
      `v0.9.2 classical PyTorch-style SGD momentum adversarial plate — each fixture ` +
      `surfaces a distinct attack class with a deterministic mutation. v0.9.2 ships ` +
      `CLASSICAL ONLY — Nesterov + dampening RESERVED for v0.9.3, SGD coupled L2 ` +
      `deferred to v0.10.`,
    mutation,
    reconciliation_check_targeted_first: `Rule ${targetedRule}: ${description}`,
    purpose:
      `v0.9.2 momentum anti-circularity fixture (kind: '${kind}'). Pressure-tests that the ` +
      `named rule fires BEFORE the reconciler consults fixture_status metadata.`,
    v0_9_2_trust_framing:
      `Rule 21 (classical PyTorch-style SGD momentum) is a STRUCTURAL CONSISTENCY check, ` +
      `NOT a producer-authenticity check. An attacker who controls every byte of the sidecar ` +
      `and recomputes a consistent (g, buffer, update) triple passes Rule 21 trivially — ` +
      `analogous to Rule 17's bundle-integrity caveat, Rules 22-24's Adam caveat, and the ` +
      `Fang et al. 2023 EuroS&P spoofing class against Proof-of-Learning (arXiv:2208.03567).`,
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
  opts?: { bypassCanonicalEmit?: boolean },
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
  const bytes = opts?.bypassCanonicalEmit
    ? receipts.map((r) => JSON.stringify(r)).join("\n") + "\n"
    : receipts.map((r) => emitGeneralReceipt(r)).join("")
  writeFileSync(outPath, bytes)

  const meta = {
    schema_version: "0.1.0",
    fixture: `${filename.replace(/\.jsonl$/, "")}.meta`,
    describes: outPath,
    based_on:
      `Byte-precise mutation of ${MULTI_GOLDEN_PATH}. ` +
      `v0.9.2 classical PyTorch-style SGD momentum multi-step adversarial plate.`,
    mutation,
    reconciliation_check_targeted_first: `Rule ${targetedRule}: ${description}`,
    purpose:
      `v0.9.2 momentum multi-step anti-circularity fixture (kind: '${kind}'). Pressure-tests ` +
      `that the named multi-step rule fires BEFORE the reconciler consults fixture_status metadata.`,
    v0_9_2_trust_framing:
      `Rule 25 (multi-step optimizer-state chain — momentum buffer chain) is a STRUCTURAL ` +
      `consistency check. Producer-authenticity caveat per Rule 17 / Fang et al. 2023 applies.`,
  }
  writeFileSync(
    outPath.replace(/\.jsonl$/, ".meta.json"),
    JSON.stringify(meta, null, 2) + "\n",
  )
  console.log(`wrote ${outPath}`)
}

// ============================================================================
// 1. momentum.bad-coefficient-omitted → Rule 20
// ============================================================================
{
  const r = freshSingle()
  r.fixture = "momentum.bad-coefficient-omitted"
  const originalMu = r.optimizer_config!.momentum
  // Drop momentum from optimizer_config. Schema's allOf-if/then requires it
  // when name === sgd_momentum; reconciler Rule 20 catches it independently.
  delete (r.optimizer_config as { momentum?: unknown }).momentum

  writeSingleBadFixture(
    "momentum.bad-coefficient-omitted.jsonl",
    "coefficient-omitted",
    r,
    {
      kind: "delete_optimizer_config_momentum",
      field_path: "optimizer_config.momentum",
      original_momentum: originalMu,
      explanation:
        `Classical PyTorch-style SGD momentum REQUIRES the momentum coefficient mu in ` +
        `optimizer_config (Sutskever et al. 2013 / PyTorch torch.optim.SGD). Dropping ` +
        `optimizer_config.momentum entirely means the recurrence buffer_t = mu * buffer_{t-1} ` +
        `+ gradient cannot be recomputed. Rule 20 catches the missing hyperparameter ` +
        `structurally.`,
    },
    20,
    "Optimizer-state shape consistency — optimizer_config.momentum is REQUIRED when name === 'sgd_momentum' but absent. Classical PyTorch-style recurrence cannot be recomputed without mu.",
    { bypassCanonicalEmit: true },
  )
}

// ============================================================================
// 2. momentum.bad-coefficient-swapped → Rule 21
// ============================================================================
//
// Uses step 2 (step_index=1) from the multi-step golden as the SOURCE
// (single-step fixture extracted from a mid-stream record). At step 1,
// buffer_before is NON-ZERO (carried forward from step 0's state_after).
// This is load-bearing — at step 0 (with buffer_before=0), the recurrence
// is `mu * 0 + gradient = gradient` regardless of mu, so a mu mutation
// would NOT fire Rule 21 at step 0. The fixture deliberately uses a step
// where the mu coefficient actually drives buffer_after's value.
{
  const multiReceipts = freshMulti()
  // Extract receipts[1] as a single-step fixture. Strip multi-step metadata
  // (trace_id, step_index) and bundle binding (attestor.bundle_root_digest)
  // so the receipt validates as single-step; step_index=1 is preserved as
  // the single 'step' field via the receipt-emit path's existing handling.
  const r = multiReceipts[1]!
  delete (r as { trace_id?: unknown }).trace_id
  delete (r as { step_index?: unknown }).step_index
  if (r.attestor) {
    delete (r.attestor as { bundle_root_digest?: unknown }).bundle_root_digest
  }
  r.fixture = "momentum.bad-coefficient-swapped"
  const originalMu = r.optimizer_config!.momentum
  // Mutate mu from 0.9 → 0.99 (close numeric sibling — another popular momentum
  // default; analogous to Adam's beta-swap). buffer_after stays at value
  // computed under mu=0.9 at THIS step (where buffer_before is non-zero
  // from the prior step's state_after); recurrence check with stored
  // mu=0.99 fails.
  r.optimizer_config!.momentum = 0.99

  writeSingleBadFixture(
    "momentum.bad-coefficient-swapped.jsonl",
    "coefficient-swapped",
    r,
    {
      kind: "swap_optimizer_config_momentum_from_0_9_to_0_99_at_non_zero_buffer_step",
      field_path: "optimizer_config.momentum",
      original_momentum: originalMu,
      mutated_momentum: 0.99,
      source_step_index: 1,
      explanation:
        `Mu drifts from 0.9 (production default per Sutskever 2013 / PyTorch) to 0.99 ` +
        `(another popular default). Source receipt is step_index=1 from the multi-step golden ` +
        `(extracted as single-step) so buffer_before is NON-ZERO — at step 0, buffer_before=0 ` +
        `would make the recurrence 'mu * 0 + gradient = gradient' independent of mu, so the ` +
        `mu mutation wouldn't fire Rule 21. At step 1, buffer_after was computed under the ` +
        `original mu; the recurrence check with the stored mu now fails: ` +
        `buffer_after != 0.99 * buffer_before + gradient. Rule 21a catches the mismatch ` +
        `(parallel to Adam's beta-swap fixture).`,
    },
    21,
    "Classical PyTorch-style SGD momentum buffer recurrence violated — buffer_after was computed under prior mu, not stored mu.",
    { basedOn: MULTI_GOLDEN_PATH },
  )
}

// ============================================================================
// 3. momentum.bad-formula-mismatch → Rule 21
// ============================================================================
{
  const r = freshSingle()
  r.fixture = "momentum.bad-formula-mismatch"
  const targetIdx = 0
  const u = r.updates[targetIdx]!
  const opt = u.optimizer
  const lr = opt.learning_rate
  const mu = r.optimizer_config!.momentum!
  const bufAfter = (opt.state_after as { buffer: number }).buffer
  const grad = u.gradient
  const originalUpdate = u.update
  // Mutate update to Nesterov-look-ahead form: lr * (mu * buf_after + gradient).
  // Scope-agnostic phrasing: "stored update matches a momentum variant the v0.9.2
  // reconciler does not recognize." When v0.9.3 lands Nesterov, this fixture
  // becomes "Nesterov-form used while classical declared" (same mutation,
  // same field_path, same Rule 21 firing).
  const wrongUpdate = lr * (mu * bufAfter + grad)
  u.update = wrongUpdate
  u.weight_after = u.weight_before + wrongUpdate
  r.parameters_after[u.parameter_id] = u.weight_after

  writeSingleBadFixture(
    "momentum.bad-formula-mismatch.jsonl",
    "formula-mismatch",
    r,
    {
      kind: "mutate_update_to_match_a_momentum_variant_v0_9_2_does_not_recognize",
      field_path: `updates[${targetIdx}].update`,
      parameter_id: u.parameter_id,
      original_update_classical: originalUpdate,
      mutated_update_unrecognized_variant: wrongUpdate,
      explanation:
        `v0.9.2 ships CLASSICAL PyTorch-style SGD momentum ONLY: update = lr * buffer_after ` +
        `(descent direction). Stored update matches a different momentum variant — likely the ` +
        `Nesterov look-ahead form -lr * (mu * buf_after + gradient) (Sutskever et al. 2013 ICML ` +
        `lookahead form), RESERVED for v0.9.3. v0.9.2 reconciler does NOT recognize this variant; ` +
        `Rule 21b catches the mismatch. When v0.9.3 lands Nesterov, this fixture becomes ` +
        `"Nesterov-form used while classical declared" — the mutation, field_path, and Rule 21 ` +
        `firing all stay identical.`,
    },
    21,
    "Classical PyTorch-style SGD momentum parameter update violated — stored update matches a momentum variant the v0.9.2 reconciler does not recognize (likely Nesterov look-ahead form, RESERVED for v0.9.3).",
  )
}

// ============================================================================
// 4. momentum-multi-step.bad-stale-buffer → Rule 25
// ============================================================================
{
  const receipts = freshMulti()
  receipts[1]!.fixture = "momentum-multi-step.bad-stale-buffer-step-1"
  // Replace receipts[1].state_before.buffer with receipts[0].state_before.buffer
  // (re-using stale state from step 0 instead of step 0's state_after).
  // Rule 25 catches: receipts[1].state_before.buffer != receipts[0].state_after.buffer.
  const targetParamId = receipts[1]!.updates[0]!.parameter_id
  const stepZeroBefore = (
    receipts[0]!.updates.find((u) => u.parameter_id === targetParamId)!.optimizer
      .state_before as { buffer: number }
  ).buffer
  const originalStepOneBefore = (
    receipts[1]!.updates[0]!.optimizer.state_before as { buffer: number }
  ).buffer
  receipts[1]!.updates[0]!.optimizer.state_before = { buffer: stepZeroBefore }

  writeMultiStepBadFixture(
    "momentum-multi-step.bad-stale-buffer.jsonl",
    "stale-buffer",
    receipts,
    {
      kind: "reuse_step_0_state_before_buffer_at_step_1_breaking_chain",
      field_path: `receipts[1].updates[0].optimizer.state_before.buffer`,
      parameter_id: targetParamId,
      step_0_state_before_buffer: stepZeroBefore,
      original_step_1_state_before_buffer: originalStepOneBefore,
      mutated_step_1_state_before_buffer: stepZeroBefore,
      explanation:
        `Multi-step classical PyTorch-style SGD momentum requires every parameter's buffer to ` +
        `chain forward unbroken: receipts[k+1].state_before.buffer == receipts[k].state_after.buffer. ` +
        `Mutating step 1's state_before.buffer to step 0's state_before.buffer (instead of step 0's ` +
        `state_after.buffer) breaks the chain. Rule 25 catches the discrepancy (Rule 9 analog for ` +
        `optimizer state).`,
    },
    25,
    "Optimizer-state chain broken — receipts[1].state_before.buffer does not match receipts[0].state_after.buffer for the same parameter.",
  )
}

// ============================================================================
// 5. momentum-multi-step.bad-buffer-drop → Rule 20
// ============================================================================
{
  const receipts = freshMulti()
  receipts[1]!.fixture = "momentum-multi-step.bad-buffer-drop-step-1"
  // Delete buffer from receipts[1].state_before entirely (structural drop, distinct from
  // value-mutation #4). Schema's MomentumState requires buffer; Rule 20's state-shape
  // check catches the missing field.
  const targetParamId = receipts[1]!.updates[0]!.parameter_id
  const originalBuf = (
    receipts[1]!.updates[0]!.optimizer.state_before as { buffer: number }
  ).buffer
  delete (receipts[1]!.updates[0]!.optimizer.state_before as { buffer?: number }).buffer

  writeMultiStepBadFixture(
    "momentum-multi-step.bad-buffer-drop.jsonl",
    "buffer-drop",
    receipts,
    {
      kind: "drop_state_before_buffer_field_structurally",
      field_path: `receipts[1].updates[0].optimizer.state_before.buffer`,
      parameter_id: targetParamId,
      original_buffer: originalBuf,
      explanation:
        `Structural drop (distinct from #4's value mutation): the buffer field is REMOVED from ` +
        `state_before entirely. MomentumState is closed-shape ({buffer} required); Rule 20's ` +
        `state-shape consistency check catches the missing field. Parallel to Adam's ` +
        `bad-amsgrad-confusion (which drops state_before structurally).`,
    },
    20,
    "Optimizer-state shape consistency — receipts[1].updates[0].optimizer.state_before missing required 'buffer' field for sgd_momentum.",
    { bypassCanonicalEmit: true },
  )
}

// ============================================================================
// 6. momentum.bad-engine-recompute-disagrees-momentum → Rule 14
// ============================================================================
{
  const r = freshSingle()
  r.fixture = "momentum.bad-engine-recompute-disagrees-momentum"
  const targetIdx = 0
  const u = r.updates[targetIdx]!
  // Perturb weight_after by 1e-3. buffer_after, momentum, update formula all
  // stay internally consistent — Rules 20, 21 pass. Only Rule 14's engine
  // recompute catches the divergence. Load-bearing per Fang et al. 2023 PoL
  // spoofing class: structural consistency is necessary but NOT sufficient.
  const originalAfter = u.weight_after
  const mutatedAfter = originalAfter + 1e-3
  u.weight_after = mutatedAfter
  r.parameters_after[u.parameter_id] = mutatedAfter

  writeSingleBadFixture(
    "momentum.bad-engine-recompute-disagrees-momentum.jsonl",
    "engine-recompute-disagrees-momentum",
    r,
    {
      kind: "perturb_weight_after_internal_arithmetic_stays_consistent",
      field_path: `updates[${targetIdx}].weight_after`,
      parameter_id: u.parameter_id,
      original_weight_after: originalAfter,
      mutated_weight_after: mutatedAfter,
      perturbation: 1e-3,
      explanation:
        `Per-update arithmetic (buffer recurrence, update formula) is internally consistent — ` +
        `Rules 20, 21 all pass. Only Rule 14's engine recompute catches the divergence. ` +
        `Load-bearing fixture: classical PyTorch-style SGD momentum's structural consistency ` +
        `(Rule 21) is NECESSARY but NOT SUFFICIENT for producer authenticity; engine recompute ` +
        `(Rule 14) is the second line of defense and the Fang et al. 2023 PoL spoofing class ` +
        `(arXiv:2208.03567) maps directly here (parallel to v0.9.1's ` +
        `adam.bad-engine-recompute-disagrees-adam fixture).`,
    },
    14,
    "Engine recompute differential — momentum-internal arithmetic consistent but weight_after stored value diverges from engine recomputation.",
  )
}

// ============================================================================
// v0.9.3 NEW: rename momentum.bad-formula-mismatch → momentum.bad-nesterov-flag-mismatch
// ============================================================================
//
// The v0.9.2 fixture's mutation: classical-declared receipt (nesterov absent
// = false), update mutated to Nesterov-look-ahead form. Under v0.9.2 this
// fired Rule 21b (then 21b, scope-agnostic phrasing "update matches a
// momentum variant the reconciler does not recognize"). Under v0.9.3 with
// Nesterov as a recognized branch, the more precise framing is
// "declared nesterov=false but emitted Nesterov-form update." Same byte
// mutation; new meta + new filename. v0.9.2 generator script explicitly
// forward-compat-authored this rename (see line 248 of the v0.9.2 script's
// `formula-mismatch` block).
//
// Also: DELETE the v0.9.2 fixture file + its meta so the doctrine test
// doesn't pick up stale `bad-formula-mismatch` entries.

import { unlinkSync, existsSync } from "node:fs"

{
  const v092Single = "fixtures/bad/momentum.bad-formula-mismatch.jsonl"
  const v092Meta = "fixtures/bad/momentum.bad-formula-mismatch.meta.json"
  if (existsSync(v092Single)) {
    unlinkSync(v092Single)
    console.log(`deleted ${v092Single} (renamed to momentum.bad-nesterov-flag-mismatch)`)
  }
  if (existsSync(v092Meta)) {
    unlinkSync(v092Meta)
    console.log(`deleted ${v092Meta} (renamed to momentum.bad-nesterov-flag-mismatch.meta.json)`)
  }

  const r = freshSingle()
  r.fixture = "momentum.bad-nesterov-flag-mismatch"
  const targetIdx = 0
  const u = r.updates[targetIdx]!
  const opt = u.optimizer
  const lr = opt.learning_rate
  const mu = r.optimizer_config!.momentum!
  const bufAfter = (opt.state_after as { buffer: number }).buffer
  const grad = u.gradient
  const originalUpdate = u.update
  // Same mutation as v0.9.2: update mutated to Nesterov-look-ahead form
  //   update = lr * (gradient + mu * buffer_after)
  // Receipt declares classical (no nesterov flag → defaults to false).
  // Under v0.9.3, Rule 21b ("effective gradient direction") fires:
  // declared nesterov=false → expected effective = buffer_after; stored
  // update / lr = (gradient + mu * buffer_after) → Nesterov-form mismatch.
  const lookaheadUpdate = lr * (grad + mu * bufAfter)
  u.update = lookaheadUpdate
  u.weight_after = u.weight_before + lookaheadUpdate
  r.parameters_after[u.parameter_id] = u.weight_after

  writeSingleBadFixture(
    "momentum.bad-nesterov-flag-mismatch.jsonl",
    "nesterov-flag-mismatch",
    r,
    {
      kind: "mutate_update_to_nesterov_lookahead_form_while_declaring_classical",
      field_path: `updates[${targetIdx}].update`,
      parameter_id: u.parameter_id,
      original_update_classical: originalUpdate,
      mutated_update_nesterov_lookahead: lookaheadUpdate,
      explanation:
        `Receipt declares optimizer_config.nesterov absent (= false; classical PyTorch-style); ` +
        `stored update matches the Nesterov look-ahead form lr * (gradient + mu * buffer_after). ` +
        `v0.9.3 Rule 21b ("effective gradient direction") catches this classical-vs-Nesterov ` +
        `confusion bug: declared classical, emitted Nesterov form. This fixture was named ` +
        `momentum.bad-formula-mismatch in v0.9.2 (with scope-agnostic "unrecognized variant" ` +
        `framing because Nesterov wasn't recognized yet); renamed and reframed in v0.9.3 now ` +
        `that Nesterov is a first-class branch. Same byte mutation; the v0.9.2 generator ` +
        `script's scope-agnostic phrasing was explicitly forward-compat-authored to support ` +
        `this rename.`,
    },
    21,
    "Classical-vs-Nesterov confusion — receipt declares nesterov=false (or absent) but stored update matches the Nesterov look-ahead form lr * (gradient + mu * buffer_after) instead of classical lr * buffer_after. Rule 21b fires.",
  )
}

// ============================================================================
// 7 (v0.9.3). momentum.bad-nesterov-formula-mismatch → Rule 21b
// ============================================================================
//
// Inverse of #6 above: declares nesterov=true, emits classical-form update.
// MUST source from step_index=1 of the multi-step Nesterov golden — at
// step 0 with zero-init buffer, the Nesterov-vs-classical effective values
// differ by only mu * gradient (small but visible); step 1+ amplifies the
// signal because buffer_before is non-zero.
{
  const multiReceipts = freshNesterovMulti()
  const r = multiReceipts[1]!
  delete (r as { trace_id?: unknown }).trace_id
  delete (r as { step_index?: unknown }).step_index
  if (r.attestor) {
    delete (r.attestor as { bundle_root_digest?: unknown }).bundle_root_digest
  }
  r.fixture = "momentum.bad-nesterov-formula-mismatch"
  const targetIdx = 0
  const u = r.updates[targetIdx]!
  const opt = u.optimizer
  const lr = opt.learning_rate
  const bufAfter = (opt.state_after as { buffer: number }).buffer
  const originalUpdate = u.update
  // Mutate update to classical form: lr * buffer_after (drops the Nesterov
  // lookahead term). Receipt still declares nesterov=true. Rule 21b catches:
  // declared nesterov=true → expected effective = gradient + mu * buffer_after;
  // stored update / lr = buffer_after → classical-form mismatch.
  const classicalUpdate = lr * bufAfter
  u.update = classicalUpdate
  u.weight_after = u.weight_before + classicalUpdate
  r.parameters_after[u.parameter_id] = u.weight_after

  writeSingleBadFixture(
    "momentum.bad-nesterov-formula-mismatch.jsonl",
    "nesterov-formula-mismatch",
    r,
    {
      kind: "mutate_update_to_classical_form_while_declaring_nesterov",
      field_path: `updates[${targetIdx}].update`,
      parameter_id: u.parameter_id,
      source_step_index: 1,
      original_update_nesterov_lookahead: originalUpdate,
      mutated_update_classical: classicalUpdate,
      explanation:
        `Receipt declares optimizer_config.nesterov=true; stored update matches the CLASSICAL ` +
        `form lr * buffer_after (drops the Nesterov lookahead term lr * mu * buffer_after). ` +
        `Source receipt is step_index=1 from the multi-step Nesterov golden (extracted as ` +
        `single-step) so buffer_before is non-zero — at step 0 with buffer_before=0, the ` +
        `Nesterov-vs-classical divergence is only mu * gradient (small but visible); step 1+ ` +
        `amplifies the signal. Rule 21b fires: declared nesterov=true → expected effective = ` +
        `gradient + mu * buffer_after; stored implies effective = buffer_after.`,
    },
    21,
    "Classical-vs-Nesterov confusion — receipt declares nesterov=true but stored update matches the classical form lr * buffer_after instead of Nesterov lookahead lr * (gradient + mu * buffer_after). Rule 21b fires.",
    { basedOn: NESTEROV_MULTI_GOLDEN_PATH },
  )
}

// ============================================================================
// 8 (v0.9.3). momentum.bad-dampening-ignored → Rule 21a
// ============================================================================
//
// Declares dampening=0.1 but emits buffer_after computed WITHOUT the (1-tau)
// factor on gradient (uses the classical recurrence mu * buf_before + gradient).
// Step 0 source is fine — the (1-tau) factor on gradient is visible at any
// step, including zero-init buffer_before (mu * 0 + 0.9*g vs mu * 0 + g
// differ by 0.1*g; clearly detectable).
{
  // Source: fresh single-step classical golden, mutate to declare dampening=0.1
  // (which would normally cause the recurrence to use (1-0.1)*g = 0.9*g) but
  // KEEP the buffer_after computed under classical (no dampening, so buf_after
  // = mu * 0 + 1.0*g = g). Rule 21a catches: expected buf_after = mu * 0 + 0.9*g
  // = 0.9*g; stored buf_after = g; mismatch by 0.1*g.
  const r = freshSingle()
  r.fixture = "momentum.bad-dampening-ignored"
  const DECLARED_DAMPENING = 0.1
  // Mutate optimizer_config to declare dampening=0.1 + bump schema_version
  // (since dampening>0 requires v0.7.0).
  r.optimizer_config!.dampening = DECLARED_DAMPENING
  r.schema_version = "0.7.0"
  const targetIdx = 0
  const u = r.updates[targetIdx]!
  const opt = u.optimizer
  const originalBufAfter = (opt.state_after as { buffer: number }).buffer

  writeSingleBadFixture(
    "momentum.bad-dampening-ignored.jsonl",
    "dampening-ignored",
    r,
    {
      kind: "declare_dampening_0_1_but_keep_buffer_after_computed_without_1_minus_tau_factor",
      field_path: `optimizer_config.dampening (or updates[${targetIdx}].optimizer.state_after.buffer)`,
      parameter_id: u.parameter_id,
      declared_dampening: DECLARED_DAMPENING,
      stored_buffer_after: originalBufAfter,
      explanation:
        `Receipt declares dampening=0.1 in optimizer_config but stored buffer_after equals ` +
        `mu * buffer_before + gradient (the dampening=0 recurrence) instead of mu * buffer_before + ` +
        `(1 - 0.1) * gradient. Rule 21a fires: expected = mu * buffer_before + 0.9 * gradient; ` +
        `stored = mu * buffer_before + gradient; mismatch by 0.1 * gradient. Catches the ` +
        `"declared dampening but didn't actually apply it" porting bug.`,
    },
    21,
    "PyTorch-style SGD momentum buffer recurrence — declared dampening=0.1 but buffer_after computed without the (1-tau) factor on gradient.",
  )
}

// ============================================================================
// 9 (v0.9.3). momentum-multi-step.bad-nesterov-flag-inconstancy → Rule 26
// ============================================================================
//
// nesterov=true at step 0, nesterov=false (absent) at step 1. Rule 26's
// constancy key list for sgd_momentum already includes `nesterov` (set up
// in v0.9.2 anticipating v0.9.3); this fixture activates that test coverage.
{
  const receipts = freshNesterovMulti()
  // Bump schema_version on receipts that have nesterov=true (v0.9.3 dispatch).
  // Step 0 keeps nesterov=true ("0.7.0"); step 1 drops nesterov → reverts to
  // classical schema ("0.6.0"). Rule 26 catches the inconstancy at step 1.
  receipts[1]!.fixture = "momentum-multi-step.bad-nesterov-flag-inconstancy-step-1"
  const originalNesterov = receipts[1]!.optimizer_config!.nesterov
  delete (receipts[1]!.optimizer_config as { nesterov?: unknown }).nesterov
  // Schema version dispatch: if nesterov is now absent (and dampening absent
  // = 0), the receipt should declare "0.6.0" instead of "0.7.0". But this
  // is a BAD fixture — the mutation creates structural inconsistency, so
  // schema_version stays at the emit-time "0.7.0" (which v0.7.0 schema
  // accepts since nesterov is now absent = default false).
  // No schema_version change needed (the original step 1 was emitted at
  // "0.7.0"; classical-with-no-flags also validates against v0.7.0 since
  // v0.7.0 is a superset of v0.6.0).

  writeMultiStepBadFixture(
    "momentum-multi-step.bad-nesterov-flag-inconstancy.jsonl",
    "nesterov-flag-inconstancy",
    receipts,
    {
      kind: "drop_nesterov_flag_at_step_1_while_step_0_declared_nesterov_true",
      field_path: `receipts[1].optimizer_config.nesterov`,
      original_step_1_nesterov: originalNesterov,
      mutated_step_1_nesterov: "absent (treated as false)",
      explanation:
        `Receipts[0] declares nesterov=true; receipts[1] drops the nesterov flag (defaults to ` +
        `false = classical). Rule 26 catches the inconstancy: nesterov is in sgd_momentum's ` +
        `constancy key list (set up in v0.9.2 anticipating v0.9.3). A training run cannot ` +
        `switch optimizer variants mid-stream — Sutskever 2013 / PyTorch convention assumes ` +
        `consistent optimizer config across steps (LR is the only legitimately-scheduled hyperparameter).`,
    },
    26,
    "Multi-step optimizer-config inconstancy — receipts[1].optimizer_config.nesterov differs from receipts[0] (dropped from true → absent/false).",
  )
}

console.log(`\n--- momentum adversarial plate complete (v0.9.3: 9 bad fixtures = 6 v0.9.2 + 3 v0.9.3 new + 1 v0.9.2 renamed) ---`)
