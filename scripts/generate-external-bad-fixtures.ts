/**
 * v0.6 — Generate the 8 bad-external fixtures from the
 * fixtures/external/pytorch.softmax-ce.golden.jsonl baseline.
 *
 * The plate (Agent 5's anti-circularity recommendation):
 *   1. bad-shape-not-math           → Rule 12 (CE per_output mutated)
 *   2. bad-framework-spoof          → Rules 0.8 + 11 (softmax output > 1; sum != 1)
 *   3. bad-collapsed-laundered      → Rule 14 (mutated signal_value on collapsed-only;
 *                                              engine recompute disagrees)
 *   4. bad-skip-without-basis       → Rule 15 (skip declared without attestor.skip_basis)
 *   5. bad-attested-mutated-after   → Rule 16 (signed_subject_digest binds to bytes
 *                                              the receipt no longer matches)
 *   6. bad-partial-tamper-internally-consistent → Rule 7 + Rule 14 (parameters_after
 *                                              mutated; Rule 7 catches drift even on
 *                                              ingest path; Rule 14 differential also fires)
 *   7. bad-trusted-source-bad-math  → Rule 0.8 (provenance claims hub trust; out > 1.0)
 *   8. bad-engine-reproduce-disagrees → Rule 14 (forward output drifts beyond
 *                                              differential_tolerance)
 *
 * Each fixture is paired with a .meta.json declaring
 * `reconciliation_check_targeted_first` so the doctrine ratchet test maps
 * fixture → rule.
 */

import { readFileSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { emitGeneralReceipt } from "../src/emit.js"
import { hashReceipt } from "../src/hash.js"
import type { GeneralReceipt } from "../src/general-engine.js"

const goldenText = readFileSync(
  "fixtures/external/pytorch.softmax-ce.golden.jsonl",
  "utf-8",
)

function freshGolden(): GeneralReceipt {
  return JSON.parse(goldenText.trim()) as GeneralReceipt
}

type Bad = {
  kind: string
  ruleRecord: number
  description: string
  mutate: (r: GeneralReceipt) => {
    fieldPath: string
    original: unknown
    mutated: unknown
  }
}

const BADS: Bad[] = [
  // 1. bad-shape-not-math — Rule 12 (CE per_output mutated)
  {
    kind: "shape-not-math",
    ruleRecord: 12,
    description:
      "Sidecar shape is valid; loss.per_output.o1 mutated to claim a different CE value " +
      "than -y_o1 * log(p_o1) for the foreign forward outputs. Rule 12 (cross_entropy_softmax " +
      "branch) fires on the per_output[o1] check. Also Rule 14 fires because the foreign " +
      "claim disagrees with the engine recompute. Both rules catch this independently — " +
      "Rule 12 from internal consistency, Rule 14 from differential.",
    mutate: (r) => {
      const original = r.loss.per_output.o1
      const mutated = original + 0.5
      r.loss.per_output.o1 = mutated
      return { fieldPath: "loss.per_output.o1", original, mutated }
    },
  },

  // 2. bad-framework-spoof — Rules 0.8 + 11
  {
    kind: "framework-spoof",
    ruleRecord: 0, // Rule 0.8 surfaces as rule: 0 with "Rule 0.8" in message
    description:
      "Receipt claims source_framework: pytorch@2.5.0 but forward.o1.out is mutated to 1.5 " +
      "(outside [0,1] probability bounds). Rule 0.8 fires regardless of source_framework " +
      "value — identity metadata cannot mute math gates. Provenance claims do not buy trust.",
    mutate: (r) => {
      const original = r.forward.o1!.out
      const mutated = 1.5
      r.forward.o1!.out = mutated
      return { fieldPath: "forward.o1.out", original, mutated }
    },
  },

  // 3. bad-collapsed-laundered — Rule 14
  {
    kind: "collapsed-laundered",
    ruleRecord: 14,
    description:
      "Sidecar carries collapsed-only softmax+CE (no dual_form). signal_value at o1 is " +
      "mutated by +0.5. Rule 13 is GATED on dual_form — without it, Rule 13c does not fire. " +
      "But Rule 14 (engine-recompute differential) independently recomputes signal_value " +
      "from forward+targets and catches the disagreement. This is the load-bearing defense " +
      "against collapsed-trace laundering — Rule 14 closes the gap Rule 13's GATED design opens.",
    mutate: (r) => {
      // Strip dual_form to mimic a PyTorch trace that emits collapsed-only.
      // Then mutate signal_value.
      const sig = r.backward.output_error_signals.o1!
      delete sig.dual_form
      const original = sig.signal_value
      const mutated = original + 0.5
      sig.signal_value = mutated
      // Also update the factor value so Rule 1 stays clean (factors product
      // == signal_value); we want Rule 14 to be the witness, not Rule 1.
      sig.factors[0]!.value = mutated
      // Strip the other units' dual_form blocks too so the receipt is
      // uniformly collapsed-only.
      for (const u of Object.keys(r.backward.output_error_signals)) {
        delete r.backward.output_error_signals[u]!.dual_form
      }
      return { fieldPath: "backward.output_error_signals.o1.signal_value", original, mutated }
    },
  },

  // 4. bad-skip-without-basis — Rule 15
  {
    kind: "skip-without-basis",
    ruleRecord: 15,
    description:
      "Receipt declares verification_state: 'engine_recompute_skipped_with_basis' but " +
      "omits attestor.skip_basis. Rule 15 fires: skipping the math gate requires naming " +
      "the basis from the closed enum EXTERNAL_TRUST_BASIS on the record. Silent skipping " +
      "is rejected (Leroy's verified-vs-trusted discipline).",
    mutate: (r) => {
      r.fixture_status.verification_state =
        "engine_recompute_skipped_with_basis" as unknown as GeneralReceipt["fixture_status"]["verification_state"]
      // attestor.skip_basis is undefined (we don't add it).
      return {
        fieldPath: "attestor.skip_basis",
        original: undefined,
        mutated: undefined,
      }
    },
  },

  // 5. bad-attested-mutated-after — Rule 16
  {
    kind: "attested-mutated-after",
    ruleRecord: 16,
    description:
      "Receipt declares attestor.signed_subject_digest computed on the canonical receipt " +
      "bytes BEFORE parameters_after.w_x1_h1 is mutated. After the mutation, the recomputed " +
      "digest no longer matches. Rule 16 fires (digest-binding integrity violation; the " +
      "SolarWinds 'signed-but-substituted' analog). Signature *validity* (cosign) is OUT of " +
      "scope; Rule 16 only catches digest-binding integrity within the receipt.",
    mutate: (r) => {
      // 1) Pin a signed_subject_digest computed on the CURRENT (clean) receipt bytes.
      const clone = JSON.parse(JSON.stringify(r)) as GeneralReceipt
      if (clone.attestor) {
        delete (clone.attestor as { signed_subject_digest?: string })
          .signed_subject_digest
      }
      const canonical = emitGeneralReceipt(clone)
      const digest = `sha256:${hashReceipt(canonical)}`
      if (!r.attestor) throw new Error("expected attestor on observer-mode receipt")
      r.attestor.signed_subject_digest = digest

      // 2) Now MUTATE parameters_after.w_x1_h1 so the receipt's bytes change
      //    and the previously-pinned digest no longer matches.
      const original = r.parameters_after.w_x1_h1
      const mutated = original! + 0.001
      r.parameters_after.w_x1_h1 = mutated

      return {
        fieldPath: "parameters_after.w_x1_h1 (mutated after signed_subject_digest pinned)",
        original,
        mutated,
      }
    },
  },

  // 6. bad-partial-tamper-internally-consistent — Rule 7 + Rule 14
  {
    kind: "partial-tamper-internally-consistent",
    ruleRecord: 7,
    description:
      "Receipt's parameters_after.w_x1_h1 is mutated; parameters_before + updates remain " +
      "untouched. Rule 7 (final-state consistency) fires because parameters_after disagrees " +
      "with parameters_before + sum(updates targeting w_x1_h1). Rule 14 ALSO fires because " +
      "the engine recompute produces the un-mutated parameters_after. Doctrine fixture: " +
      "Rule 7 is not weakened by the ingest path; the existing rules apply to observer-mode " +
      "receipts.",
    mutate: (r) => {
      const original = r.parameters_after.w_x1_h1
      const mutated = original! + 0.1
      r.parameters_after.w_x1_h1 = mutated
      return { fieldPath: "parameters_after.w_x1_h1", original, mutated }
    },
  },

  // 7. bad-trusted-source-bad-math — Rule 0.8
  {
    kind: "trusted-source-bad-math",
    ruleRecord: 0,
    description:
      "Receipt's source_framework.information_uri claims a trusted hub URL " +
      "('https://hub.example.com/trusted-models/foo'); forward.o1.out is mutated to 1.05 " +
      "(outside [0,1]). Rule 0.8 fires anyway. Identity metadata (provenance URLs, " +
      "framework names, etc.) CANNOT short-circuit math gates. This fixture exists " +
      "specifically so a future refactor that adds a 'trusted_sources allowlist short-circuit' " +
      "fails at PR-review.",
    mutate: (r) => {
      if (!r.source_framework) throw new Error("expected source_framework")
      r.source_framework.information_uri = "https://hub.example.com/trusted-models/foo"
      const original = r.forward.o1!.out
      const mutated = 1.05
      r.forward.o1!.out = mutated
      return { fieldPath: "forward.o1.out", original, mutated }
    },
  },

  // 8. bad-engine-reproduce-disagrees — Rule 14
  {
    kind: "engine-reproduce-disagrees",
    ruleRecord: 14,
    description:
      "Sidecar carries forward.o1.out drifted by +0.0001 from what the engine would " +
      "compute (within [0,1] so Rule 0.8 passes; sum still ≈ 1.0 within tolerance so " +
      "Rule 11 passes). But the differential tolerance is {atol:1e-6, rtol:1e-4}, so " +
      "the 1e-4 drift beyond engine recompute fires Rule 14. Catches genuine cross-impl " +
      "disagreement (foreign framework's FP precision drifted vs backprop-trace engine).",
    mutate: (r) => {
      const original = r.forward.o1!.out
      // 1e-4 drift — well above default differential_tolerance atol=1e-6, rtol=1e-4 * |0.42|.
      const mutated = original + 1e-3
      r.forward.o1!.out = mutated
      // Re-normalize the other outputs so Rule 11 (sum) still passes.
      const others = ["o2", "o3"] as const
      const drift = 1e-3 / others.length
      for (const u of others) {
        r.forward[u]!.out = r.forward[u]!.out - drift
      }
      return { fieldPath: "forward.o1.out (drift outside differential_tolerance)", original, mutated }
    },
  },
]

for (const bad of BADS) {
  const receipt = freshGolden()
  // All bad fixtures mark as deliberately corrupted (override the
  // engine_recompute_matched_within_tolerance the good fixture carries).
  // EXCEPT bad-skip-without-basis which deliberately sets a different
  // verification_state — its mutate handler will overwrite below.
  receipt.fixture_status = {
    authoring_state:
      "external_imported" as unknown as GeneralReceipt["fixture_status"]["authoring_state"],
    verification_state:
      "expected_to_fail_reconciliation" as unknown as GeneralReceipt["fixture_status"]["verification_state"],
    canonical: false as true,
  }
  receipt.fixture = `external.bad-${bad.kind}`

  const mutation = bad.mutate(receipt)
  const bytes = emitGeneralReceipt(receipt)
  const outPath = `fixtures/bad/external.bad-${bad.kind}.jsonl`
  writeFileSync(outPath, bytes)

  const meta = {
    schema_version: "0.1.0",
    fixture: `external.bad-${bad.kind}.meta`,
    describes: `fixtures/bad/external.bad-${bad.kind}.jsonl`,
    based_on:
      "Byte-precise mutation of fixtures/external/pytorch.softmax-ce.golden.jsonl. " +
      "Differs in fixture_status (deliberately_corrupted / expected_to_fail_reconciliation) " +
      "and the targeted v0.6 external-ingestion field(s) described below.",
    mutation: {
      field_path: mutation.fieldPath,
      original: mutation.original ?? null,
      mutated: mutation.mutated ?? null,
      kind: "v0_6_external_ingestion_targeted_mutation",
      description: bad.description,
    },
    reconciliation_check_targeted_first:
      bad.ruleRecord === 0
        ? `Rule 0 (Rule 0.8 probability-bounds sub-check): forward[output].out MUST be in [0, 1] when topology.activation_output === 'softmax' — identity claims (source_framework, information_uri) cannot mute the math gate.`
        : `Rule ${bad.ruleRecord}: ${bad.description.split(".")[0]}.`,
    purpose:
      "Anti-circularity (Csmith/CompCert lineage) for the v0.6 external trace " +
      "ingestion: observer-mode receipts cannot launder bad math by virtue of being imported. " +
      "Rule 14 (engine-recompute differential) is the load-bearing defense; Rules 0.8/11/12 " +
      "still fire on observer receipts; Rules 15/16 enforce skip-basis and digest-binding " +
      "integrity. This fixture isolates the targeted rule as far as the ingest-path " +
      "interleaving allows.",
    v0_6_note:
      "v0.6 ships external trace ingestion: schema v0.4.0 additive (source_framework + " +
      "attestor + extended fixture_status enums), Rules 14/15/16 new, `bp import pytorch` " +
      "CLI subcommand. The 8-fixture plate exercises every new rule plus the doctrine " +
      "ratchet against trust-laundering attack classes.",
  }
  writeFileSync(
    outPath.replace(/\.jsonl$/, ".meta.json"),
    JSON.stringify(meta, null, 2) + "\n",
  )
  console.log(`wrote ${outPath}`)
}
// Silence unused warning for the createHash import (kept for symmetry with
// the good-fixture generator; not used at this layer).
void createHash
