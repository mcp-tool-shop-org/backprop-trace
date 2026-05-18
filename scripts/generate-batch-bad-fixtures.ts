/**
 * v0.9 — Generate the batched observer-mode bad-fixture plate.
 *
 * Four fixtures, each load-bearing for a distinct attack class on batched
 * SGD softmax+CE ingestion. Construction follows the v0.6/v0.7/v0.8
 * mutate-then-re-emit pattern: read the canonical batched golden, apply
 * ONE mutation per fixture, re-emit canonical bytes via emitGeneralReceipt,
 * write the fixture + a sibling .meta.json describing the mutation +
 * targeted rule.
 *
 * Plate (paired rule in parens):
 *
 *   1. batch.bad-reduction-mode-mismatch.jsonl  → Rule 18
 *      Declare reduction="mean" but mutate loss.total to sum(per_sample).
 *      Catches the canonical mean-vs-sum confusion attack (off by factor N).
 *
 *   2. batch.bad-sample-id-missing.jsonl  → Rule 19
 *      Remove one sample_id from loss.per_sample map (declared in
 *      batch.sample_order but absent from the per-sample projection).
 *      Catches incomplete per-sample projections.
 *
 *   3. batch.bad-sample-order-duplicate.jsonl  → Rule 19
 *      Mutate batch.sample_order to contain a duplicate sample_id. Per the
 *      v0.9 lock: "missing, duplicate, or out-of-order sample IDs fail."
 *      Catches duplicate ordering declarations.
 *
 *   4. batch.bad-reduced-gradient-wrong.jsonl  → Rule 14
 *      Perturb updates[0].gradient by a large amount. Per-sample math is
 *      unchanged; the reduced gradient claim drifts. Engine recompute
 *      (Rule 14) catches via the differential check. This fixture proves
 *      that existing Rule 14 generalizes to batched receipts without
 *      change — the v0.6 doctrine "existing rules generalize" holds.
 */

import { readFileSync, writeFileSync } from "node:fs"
import { emitGeneralReceipt } from "../src/emit.js"
import type { GeneralReceipt } from "../src/general-engine.js"

const GOLDEN_PATH = "fixtures/external/pytorch.softmax-ce.batched.golden.jsonl"

function freshGolden(): GeneralReceipt {
  return JSON.parse(readFileSync(GOLDEN_PATH, "utf-8").trim()) as GeneralReceipt
}

function writeBadFixture(
  kind: string,
  receipt: GeneralReceipt,
  mutation: Record<string, unknown>,
  targetedRule: number,
  description: string,
  opts?: { bypassCanonicalEmit?: boolean },
): void {
  receipt.fixture_status = {
    authoring_state:
      "external_imported" as unknown as GeneralReceipt["fixture_status"]["authoring_state"],
    verification_state:
      "expected_to_fail_reconciliation" as unknown as GeneralReceipt["fixture_status"]["verification_state"],
    canonical: false as true,
  }
  const outPath = `fixtures/bad/batch.bad-${kind}.jsonl`
  // Bad fixtures that introduce structural malformations (missing keys in
  // ordered maps, duplicate sample IDs) cannot pass through the canonical
  // emitter — emitOrderedNumberMap throws on missing required keys. For
  // those we bypass canonical emit and JSON.stringify directly. The
  // emitted bytes are still valid JSON the reconciler can parse; they
  // just aren't canonical-byte-stable (which doesn't matter for bad
  // fixtures — their purpose is rule-firing, not byte equality).
  const bytes = opts?.bypassCanonicalEmit
    ? JSON.stringify(receipt) + "\n"
    : emitGeneralReceipt(receipt)
  writeFileSync(outPath, bytes)

  const meta = {
    schema_version: "0.1.0",
    fixture: `batch.bad-${kind}.meta`,
    describes: outPath,
    based_on:
      `Byte-precise mutation of ${GOLDEN_PATH}. ` +
      `v0.9 batched observer-mode adversarial plate — each fixture surfaces a distinct ` +
      `batched attack class with a deterministic mutation.`,
    mutation,
    reconciliation_check_targeted_first: `Rule ${targetedRule}: ${description}`,
    purpose:
      `v0.9 batched observer-mode anti-circularity fixture. Pressure-tests that the named ` +
      `rule fires BEFORE the reconciler consults fixture_status metadata.`,
    v0_9_note:
      `v0.9 ships batched SGD softmax+CE observer-mode ingestion. Rule 18 (batch reduction ` +
      `consistency) and Rule 19 (sample-set coherence) are new gated rules. Adam / AdamW / ` +
      `momentum and per-sample gradients deferred to v0.9.x.`,
  }
  writeFileSync(
    outPath.replace(/\.jsonl$/, ".meta.json"),
    JSON.stringify(meta, null, 2) + "\n",
  )
  console.log(`wrote ${outPath}`)
}

// ============================================================================
// Fixture 1: bad-reduction-mode-mismatch → Rule 18
// ============================================================================
{
  const receipt = freshGolden()
  receipt.fixture = "batch.bad-reduction-mode-mismatch"
  // The declared reduction stays "mean" but the loss.total is mutated to
  // sum(per_sample). Rule 18 recomputes mean(per_sample) and finds the
  // declared total is off by a factor of N=4.
  const perSampleTotal = receipt.loss.per_sample!
  const declaredReduction = receipt.batch!.reduction // "mean"
  const sumOfPerSample = Object.values(perSampleTotal).reduce((a, b) => a + b, 0)
  const originalTotal = receipt.loss.total
  receipt.loss.total = sumOfPerSample // claims "mean" but emits sum

  writeBadFixture(
    "reduction-mode-mismatch",
    receipt,
    {
      kind: "mutate_loss_total_to_sum_while_declaring_mean",
      field_path: "loss.total",
      declared_reduction: declaredReduction,
      original_loss_total_under_mean: originalTotal,
      mutated_loss_total_as_sum: sumOfPerSample,
      sample_count: receipt.batch!.size,
      note:
        `Canonical mean-vs-sum confusion. reduction declared as "${declaredReduction}" but ` +
        `loss.total emitted as sum(per_sample) (off by factor of N=${receipt.batch!.size}). ` +
        `Rule 18 catches this structurally without engine recompute.`,
    },
    18,
    "Batch reduction consistency violation — loss.total claims reduction='mean' but value equals sum(loss.per_sample.values()).",
  )
}

// ============================================================================
// Fixture 2: bad-sample-id-missing → Rule 19
// ============================================================================
{
  const receipt = freshGolden()
  receipt.fixture = "batch.bad-sample-id-missing"
  const sampleOrder = receipt.batch!.sample_order
  const droppedId = sampleOrder[sampleOrder.length - 1]! // drop last sample
  const originalPerSampleKeys = Object.keys(receipt.loss.per_sample!)
  // Remove the dropped sample's entry from loss.per_sample.
  // Keep batch.sample_order unchanged (still declares the missing ID).
  // Rule 19 fires on the key-set mismatch.
  const mutatedPerSample = { ...receipt.loss.per_sample! }
  delete mutatedPerSample[droppedId]
  receipt.loss.per_sample = mutatedPerSample

  writeBadFixture(
    "sample-id-missing",
    receipt,
    {
      kind: "remove_sample_from_loss_per_sample_map_while_declared_in_sample_order",
      field_path: `loss.per_sample.${droppedId}`,
      dropped_sample_id: droppedId,
      batch_sample_order: sampleOrder,
      original_per_sample_keys: originalPerSampleKeys,
      mutated_per_sample_keys: Object.keys(receipt.loss.per_sample!),
      note:
        `loss.per_sample is missing sample_id "${droppedId}" declared in batch.sample_order. ` +
        `Rule 19 catches incomplete per-sample projections (per-sample maps' key set must equal ` +
        `batch.sample_order set).`,
    },
    19,
    "Sample-set coherence violation — loss.per_sample missing sample_id declared in batch.sample_order.",
    { bypassCanonicalEmit: true },
  )
}

// ============================================================================
// Fixture 3: bad-sample-order-duplicate → Rule 19
// ============================================================================
{
  const receipt = freshGolden()
  receipt.fixture = "batch.bad-sample-order-duplicate"
  const original = [...receipt.batch!.sample_order]
  // Mutate sample_order to contain a duplicate (replace last with first).
  // Schema's uniqueItems would catch this at validation time, but Rule 19
  // re-checks as defense in depth — schema and reconciler agree.
  const mutated = [...original]
  mutated[mutated.length - 1] = mutated[0]!
  receipt.batch!.sample_order = mutated

  writeBadFixture(
    "sample-order-duplicate",
    receipt,
    {
      kind: "mutate_batch_sample_order_to_contain_duplicate",
      field_path: `batch.sample_order[${mutated.length - 1}]`,
      original_sample_order: original,
      mutated_sample_order: mutated,
      note:
        `batch.sample_order contains a duplicate sample_id. Per-sample projections cannot ` +
        `be derived by iterating an unambiguous order. Rule 19's defense-in-depth check fires ` +
        `(schema's uniqueItems also rejects this at validation; this fixture proves both layers ` +
        `agree). NOTE: Ajv validation rejects this at schema layer (uniqueItems), so the ` +
        `reconciler may report Rule 0 (structural) instead of Rule 19. Both routes catch the attack.`,
    },
    19,
    "Sample-set coherence violation — batch.sample_order contains duplicate sample_ids.",
    { bypassCanonicalEmit: true },
  )
}

// ============================================================================
// Fixture 4: bad-reduced-gradient-wrong → Rule 14
// ============================================================================
{
  const receipt = freshGolden()
  receipt.fixture = "batch.bad-reduced-gradient-wrong"
  // Perturb the first weight update's gradient by a large amount. Per-sample
  // math is unchanged (per_sample[*].forward / loss are correct). Engine
  // recompute (Rule 14) will recompute the reduced gradient from per-sample
  // and find it doesn't match the mutated claim.
  const targetUpd = receipt.updates[0]!
  const originalGradient = targetUpd.gradient
  const perturbation = 0.1 // well outside numeric tolerance
  targetUpd.gradient = originalGradient + perturbation
  // Also update the factor that mirrors the gradient (single-factor
  // decomposition) so Rule 4 still passes — Rule 14 is the load-bearing catch.
  targetUpd.optimizer.factors[0]!.value = targetUpd.gradient
  // Don't update `update` or `weight_after` — those would propagate; we want
  // the reduced gradient claim to be the visibly-wrong field.
  // (Note: Rule 5 might fire on `update != -lr * gradient` since we changed
  // gradient but not update. That's fine cross-fire — Rule 14 is the primary
  // target for this fixture's targeted rule annotation.)

  writeBadFixture(
    "reduced-gradient-wrong",
    receipt,
    {
      kind: "perturb_updates_0_gradient_by_0_1_keeping_per_sample_unchanged",
      field_path: `updates[0].gradient (parameter_id=${targetUpd.parameter_id})`,
      original_gradient: originalGradient,
      mutated_gradient: targetUpd.gradient,
      perturbation,
      note:
        `Per-sample forward + per-sample loss are unchanged (engine can recompute them ` +
        `from per_sample[*].inputs and they match). The reduced gradient at updates[0].gradient ` +
        `is mutated. Engine recompute via runBatchedGeneralStep produces a different reduced ` +
        `gradient — Rule 14 fires on the differential. This fixture proves the v0.6 doctrine ` +
        `"existing rules generalize without changes" holds for batched receipts: Rule 14 catches ` +
        `batched gradient mistakes without modification.`,
    },
    14,
    "Engine-recompute differential — reduced gradient claim does not match engine-recomputed reduced gradient.",
  )
}
