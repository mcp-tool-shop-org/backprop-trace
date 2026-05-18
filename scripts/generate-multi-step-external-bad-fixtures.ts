/**
 * v0.8 — Generate the multi-step observer-mode bad-fixture plate.
 *
 * Five fixtures, each load-bearing for a different attack class on
 * multi-step external ingestion. Construction follows the v0.6/v0.7
 * mutate-then-re-emit pattern: read the canonical 3-step PyTorch golden,
 * apply ONE mutation per fixture, re-emit canonical bytes, write the
 * fixture + a sibling .meta.json describing the mutation + targeted rule.
 *
 * Plate (paired rule in parens, GATED status noted):
 *
 *   1. multi-step-external.bad-step-index-gap.jsonl  → Rule 10
 *        Drop the middle step. Sequence becomes [0, 2] instead of [0, 1, 2].
 *        Rule 10 fires on dense+monotonic check; Rule 9 may also fire on
 *        the chain break across the gap.
 *
 *   2. multi-step-external.bad-chain-break-cross-step-internally-consistent.jsonl  → Rule 9
 *        Regenerate step 1 with mutated parameters_before. Each step is
 *        individually internally consistent (Rule 14 differential passes
 *        per-step because forward/loss/backward/updates were derived from
 *        the mutated weights), but Rule 9 fires because step 1's
 *        parameters_before ≠ step 0's parameters_after. Load-bearing for
 *        proving Rule 9 still necessary on the observer-mode path.
 *
 *   3. multi-step-external.bad-fabricated-mid-step.jsonl  → Rule 9
 *        Replace step 1 entirely with a fabricated step from completely
 *        different initial parameters. Internally consistent (engine
 *        produced it), chain to step 2 broken. Rule 9 fires.
 *
 *   4. multi-step-external.bad-cross-trace-splice.jsonl  → Rule 17
 *        Mutate `step 1.metadata.source` to indicate the step was
 *        spliced from a different training run. Canonical bytes change;
 *        recomputed bundle_root_digest no longer matches declared.
 *        Rule 17 fires on bundle-integrity recompute mismatch.
 *        NOTE: Rule 17 is a BUNDLE INTEGRITY check, NOT producer-
 *        authenticity. An attacker who controls all receipt bytes AND
 *        recomputes the bundle digest passes Rule 17 trivially — this
 *        fixture catches the "splice without recomputing bundle root"
 *        accident/sloppy-attacker case, which is the realistic threat
 *        model for the v0.8 layer.
 *
 *   5. multi-step-external.bad-bundle-digest-tampered.jsonl  → Rule 17
 *        Directly mutate receipt[1].attestor.bundle_root_digest to a
 *        different sha256 hash, leaving the other receipts' digests
 *        unchanged. Rule 17 fires on value-consistency check (digests
 *        differ across receipts in the bundle).
 *
 * All fixtures map to FILENAME_KIND_TO_RULE in test/reconcile.doctrine.test.ts.
 * Generators are reproducible — re-runs produce byte-identical output.
 */

import { readFileSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { runGeneralStep } from "../src/general-engine.js"
import { emitGeneralReceipt } from "../src/emit.js"
import type { GeneralReceipt, GeneralInput } from "../src/general-engine.js"

const GOLDEN_PATH = "fixtures/external/pytorch.softmax-ce.multi-step.golden.jsonl"
const SIDECAR_PATH = "fixtures/external/pytorch.softmax-ce.multi-step.sidecar.jsonl"

function freshGolden(): GeneralReceipt[] {
  const text = readFileSync(GOLDEN_PATH, "utf-8").trim()
  return text.split("\n").map((line) => JSON.parse(line) as GeneralReceipt)
}

function computeBundleDigest(receipts: GeneralReceipt[]): string {
  // Two-pass canonical emit, mirroring buildObserverReceiptStreamFromSidecar:
  // strip bundle_root_digest from each, emit, concatenate, sha256.
  const parts: string[] = []
  for (const r of receipts) {
    const stripped = JSON.parse(JSON.stringify(r)) as GeneralReceipt
    if (stripped.attestor) delete (stripped.attestor as { bundle_root_digest?: string }).bundle_root_digest
    parts.push(emitGeneralReceipt(stripped))
  }
  const bytes = parts.join("")
  return `sha256:${createHash("sha256").update(bytes, "utf8").digest("hex")}`
}

function writeBadFixture(
  kind: string,
  receipts: GeneralReceipt[],
  mutation: Record<string, unknown>,
  targetedRule: number,
  description: string,
): void {
  // Tag every receipt's fixture_status as expected_to_fail_reconciliation
  // — anti-circularity ratchet (the reconciler MUST detect the failure
  // before consulting fixture_status).
  for (const r of receipts) {
    r.fixture_status = {
      authoring_state:
        "external_imported" as unknown as GeneralReceipt["fixture_status"]["authoring_state"],
      verification_state:
        "expected_to_fail_reconciliation" as unknown as GeneralReceipt["fixture_status"]["verification_state"],
      canonical: false as true,
    }
  }
  const outPath = `fixtures/bad/multi-step-external.bad-${kind}.jsonl`
  const bytes = receipts.map((r) => emitGeneralReceipt(r)).join("")
  writeFileSync(outPath, bytes)

  const meta = {
    schema_version: "0.1.0",
    fixture: `multi-step-external.bad-${kind}.meta`,
    describes: outPath,
    based_on:
      `Byte-precise mutation of ${GOLDEN_PATH}. ` +
      `v0.8 multi-step observer-mode adversarial plate — each fixture surfaces a distinct ` +
      `cross-step attack class with a deterministic mutation.`,
    mutation,
    reconciliation_check_targeted_first: `Rule ${targetedRule}: ${description}`,
    purpose:
      `v0.8 multi-step observer-mode anti-circularity fixture. Pressure-tests that the named ` +
      `cross-step rule fires BEFORE the reconciler consults fixture_status metadata. The ` +
      `multi-step bundle is run through reconcileMultiStep, which composes per-receipt ` +
      `Rules 1-8 + cross-record Rules 9, 10, 17.`,
    v0_8_note:
      `v0.8 ships multi-step observer-mode ingestion (bp import {pytorch,jax,tensorflow} multi). ` +
      `Rule 17 is a BUNDLE INTEGRITY check (not producer-authenticity): catches accidental ` +
      `splice / post-binding mutation / heterogeneous bundle binding. For producer-identity, ` +
      `combine bundle_root_digest with Rule 16 signed_subject_digest or external signature.`,
  }
  writeFileSync(
    outPath.replace(/\.jsonl$/, ".meta.json"),
    JSON.stringify(meta, null, 2) + "\n",
  )
  console.log(`wrote ${outPath}`)
}

// --- Helper for fixtures #2, #3: regenerate a step via runGeneralStep ----
// with mutated parameters_before so each step is internally consistent.

function regenerateStepWithMutation(
  template: GeneralReceipt,
  mutatedParametersBefore: Record<string, number>,
  stepIndex: number,
): GeneralReceipt {
  const input: GeneralInput = {
    topology: template.topology,
    learning_rate: template.learning_rate,
    inputs: template.inputs,
    targets: template.targets,
    parameters_before: mutatedParametersBefore,
    numeric_policy: template.numeric_policy,
    bias_policy: template.bias_policy,
    fixture: template.fixture,
    metadata: template.metadata,
  }
  const fresh = runGeneralStep(input)
  // Stitch back the observer-mode fields the engine doesn't produce.
  return {
    ...fresh,
    schema_version: "0.4.0",
    fixture: template.fixture,
    step: stepIndex + 1,
    trace_id: template.trace_id,
    step_index: stepIndex,
    fixture_status: template.fixture_status,
    source_framework: template.source_framework,
    attestor: template.attestor,
    metadata: template.metadata,
  }
}

// =============================================================================
// Fixture 1: bad-step-index-gap (Rule 10)
// =============================================================================
{
  const receipts = freshGolden()
  // Drop the middle step. Bundle becomes [receipt[0], receipt[2]] — step_index
  // sequence [0, 2] violates dense + monotonic. The declared bundle_root_digest
  // on the remaining receipts ALSO becomes stale (it was computed over 3
  // receipts, now only 2 are present), so Rule 17 may fire too. Primary target:
  // Rule 10.
  const dropped = receipts[1]!
  const remaining = [receipts[0]!, receipts[2]!]
  writeBadFixture(
    "step-index-gap",
    remaining,
    {
      kind: "drop_middle_record",
      removed_step_index: 1,
      removed_step_fixture: dropped.fixture,
      sequence_before: [0, 1, 2],
      sequence_after: [0, 2],
    },
    10,
    "Multi-step trace identity violation — step_index sequence [0, 2] is not dense + monotonic from 0.",
  )
}

// =============================================================================
// Fixture 2: bad-chain-break-cross-step-internally-consistent (Rule 9)
// =============================================================================
{
  const receipts = freshGolden()
  // Regenerate step 1 with mutated parameters_before. The mutation: perturb
  // w_x1_h1 by 0.05 (within float range, well outside numeric tolerance).
  // Each step remains internally consistent because runGeneralStep recomputes
  // forward/loss/backward/updates/parameters_after from the mutated weights.
  // Rule 14 still passes per-step (engine matches claim — it produced both).
  // Rule 9 fires because receipt[1].parameters_before.w_x1_h1 = original + 0.05,
  // but receipt[0].parameters_after.w_x1_h1 = original (unchanged).
  const original = receipts[1]!.parameters_before.w_x1_h1!
  const mutatedParametersBefore = {
    ...receipts[1]!.parameters_before,
    w_x1_h1: original + 0.05,
  }
  const newStep1 = regenerateStepWithMutation(receipts[1]!, mutatedParametersBefore, 1)
  receipts[1] = newStep1
  writeBadFixture(
    "chain-break-cross-step-internally-consistent",
    receipts,
    {
      kind: "regenerate_step_with_mutated_parameters_before",
      step_index_mutated: 1,
      field_perturbed: "parameters_before.w_x1_h1",
      original_value: original,
      mutated_value: original + 0.05,
      delta: 0.05,
      note:
        "Each step remains internally consistent (Rule 14 passes per-step) because the engine " +
        "recomputed forward/loss/backward/updates from the mutated weights. Rule 9 fires on " +
        "the cross-step chain because parameters_before[1] no longer equals parameters_after[0].",
    },
    9,
    "Multi-step parameter chain violation — parameters_before[1] ≠ parameters_after[0] (step 1 internally consistent but cross-step chain broken).",
  )
}

// =============================================================================
// Fixture 3: bad-fabricated-mid-step (Rule 9)
// =============================================================================
{
  const receipts = freshGolden()
  // Replace step 1 entirely with a step generated from completely different
  // initial parameters — not perturbed from step 0's parameters_after, but
  // wholly fabricated. Engine produces it (internally consistent), but it has
  // no lineage to step 0. Rule 9 fires hard.
  const fabricatedParametersBefore = {
    w_x1_h1: 0.99, w_x2_h1: 0.88, w_x1_h2: 0.77, w_x2_h2: 0.66,
    w_h1_o1: 0.55, w_h2_o1: 0.44,
    w_h1_o2: 0.33, w_h2_o2: 0.22,
    w_h1_o3: 0.11, w_h2_o3: 0.05,
    b_hidden: 0.07, b_output: 0.17,
  }
  const fabricatedStep1 = regenerateStepWithMutation(receipts[1]!, fabricatedParametersBefore, 1)
  receipts[1] = fabricatedStep1
  writeBadFixture(
    "fabricated-mid-step",
    receipts,
    {
      kind: "replace_step_with_engine_generated_step_from_independent_parameters",
      step_index_mutated: 1,
      fabricated_parameters_before: fabricatedParametersBefore,
      note:
        "Step 1 is internally consistent (engine produced it) but has no lineage to step 0. " +
        "Rule 9 fires because parameters_before[1] differs from parameters_after[0] in every weight.",
    },
    9,
    "Multi-step parameter chain violation — fabricated step 1 has parameters_before from independent random initialization, not lineage from step 0.",
  )
}

// =============================================================================
// Fixture 4: bad-cross-trace-splice (Rule 17)
// =============================================================================
{
  const receipts = freshGolden()
  // Mutate receipt[1].metadata.source to indicate the step was spliced from
  // a different training run. This changes canonical bytes (metadata.source
  // is emitted) without affecting any math rule. The declared bundle_root_digest
  // on every receipt was computed over the ORIGINAL bytes; after the mutation,
  // the recomputed digest differs. Rule 17 (c) recompute-mismatch fires.
  //
  // NOTE on threat-model honesty: Rule 17 is BUNDLE INTEGRITY, NOT producer-
  // authenticity. An attacker who controls all receipt bytes AND recomputes
  // the bundle digest passes Rule 17 trivially. This fixture catches the
  // "splice without recomputing bundle root" case (the realistic accident /
  // sloppy-attacker threat model). The actual cross-trace-splice attack name
  // is kept for clarity; the failure mode tested here is the integrity check.
  const originalSource = receipts[1]!.metadata.source
  const splicedSource = `${originalSource} [SPLICED FROM ANOTHER TRACE]`
  receipts[1]!.metadata = {
    ...receipts[1]!.metadata,
    source: splicedSource,
  }
  // Recompute what the digest WOULD be (for the meta file diagnostic).
  const recomputedDigest = computeBundleDigest(receipts)
  const declaredDigest = receipts[0]!.attestor!.bundle_root_digest!

  writeBadFixture(
    "cross-trace-splice",
    receipts,
    {
      kind: "mutate_metadata_source_without_recomputing_bundle_digest",
      step_index_mutated: 1,
      field_changed: "receipt[1].metadata.source",
      original_value: originalSource,
      mutated_value: splicedSource,
      declared_bundle_root_digest: declaredDigest,
      recomputed_bundle_root_digest: recomputedDigest,
      note:
        "Canonical bytes of receipt[1] changed via metadata.source mutation, but the declared " +
        "bundle_root_digest on every receipt was not recomputed. Rule 17 (c) recompute check " +
        "fires because recomputed digest no longer matches declared. THREAT MODEL CAVEAT: Rule " +
        "17 is bundle-integrity, not producer-authenticity — an attacker who controls all " +
        "receipt bytes AND recomputes the bundle digest passes Rule 17 trivially. This fixture " +
        "catches the 'splice without recomputing' case (the realistic accident / sloppy-attacker " +
        "threat model).",
    },
    17,
    "Trace-bundle binding recompute mismatch — receipt bytes mutated after bundle digest was bound; the integrity layer fires (not authentication).",
  )
}

// =============================================================================
// Fixture 5: bad-bundle-digest-tampered (Rule 17)
// =============================================================================
{
  const receipts = freshGolden()
  // Directly tamper receipt[1].attestor.bundle_root_digest — replace with a
  // different sha256 hash. Rule 17 (b) value-consistency check fires because
  // digests now differ across receipts in the same bundle.
  const originalDigest = receipts[1]!.attestor!.bundle_root_digest!
  const tamperedDigest = `sha256:${"0".repeat(64)}`
  receipts[1]!.attestor!.bundle_root_digest = tamperedDigest

  writeBadFixture(
    "bundle-digest-tampered",
    receipts,
    {
      kind: "mutate_receipt_bundle_root_digest_directly",
      step_index_mutated: 1,
      field_changed: "receipt[1].attestor.bundle_root_digest",
      original_value: originalDigest,
      mutated_value: tamperedDigest,
      note:
        "receipt[1].attestor.bundle_root_digest replaced with a zero hash; other receipts retain " +
        "the original digest. Rule 17 (b) value-consistency check fires because all receipts in " +
        "a bundle must declare the same bundle_root_digest value.",
    },
    17,
    "Trace-bundle binding value mismatch — bundle_root_digest differs across receipts in the same bundle.",
  )
}
