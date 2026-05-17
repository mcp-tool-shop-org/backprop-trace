/**
 * v0.5 — Generate the 7 bad softmax+CE fixtures by surgically mutating the
 * canonical golden (fixtures/softmax-ce.golden.jsonl).
 *
 * For each bad fixture:
 *   1. Read the golden, JSON.parse.
 *   2. Set fixture_status to deliberately_corrupted / expected_to_fail_reconciliation / canonical: false.
 *   3. Apply a SINGLE targeted mutation per the v0.5 Csmith plate.
 *   4. Re-emit via emitGeneralReceipt (canonical bytes preserved for every
 *      non-mutated field).
 *   5. Write fixtures/bad/softmax-ce.bad-<kind>.jsonl + the sibling meta file.
 *
 * The 7 fixtures (rule attribution per v0.5 reconciler):
 *   1. bad-prob-bound:        forward.o1.out = -0.0100000000 → Rule 0 (0.8 sub-check, short-circuits)
 *   2. bad-softmax-sum:       forward.o2.out += 0.100 → Rule 11 (sum != 1) + cascades
 *   3. bad-ce-per-output:     loss.per_output.o1 += 0.100 → Rule 12 (CE per-output)
 *   4. bad-ce-total:          loss.total += 0.100 → Rule 12 (CE total)
 *   5. bad-dual-term:         dual_form.o1.jacobian_terms[0].term_value mutated → Rules 13a + 13b
 *   6. bad-dual-sum:          dual_form.o1.summed_value mutated → Rules 13b + 13c
 *   7. bad-collapsed-vs-dual: dual_form.o1.{terms,summed_value} mutated self-consistently → Rule 13c alone
 */

import { readFileSync, writeFileSync } from "node:fs"
import { emitGeneralReceipt } from "../src/emit.js"
import type { GeneralReceipt } from "../src/general-engine.js"

const goldenText = readFileSync("fixtures/softmax-ce.golden.jsonl", "utf-8")

type Bad = {
  kind: string
  ruleRecord: number
  mutate: (r: GeneralReceipt) => {
    fieldPath: string
    original: unknown
    mutated: unknown
    description: string
  }
}

function freshGolden(): GeneralReceipt {
  return JSON.parse(goldenText.trim()) as GeneralReceipt
}

const BADS: Bad[] = [
  // 1. bad-prob-bound — Rule 0.8 (sub-check of Rule 0). forward.o1.out outside [0,1].
  {
    kind: "prob-bound",
    ruleRecord: 0,
    mutate: (r) => {
      const original = r.forward.o1!.out
      const mutated = -0.01
      r.forward.o1!.out = mutated
      return {
        fieldPath: "forward.o1.out",
        original,
        mutated,
        description:
          "Mutated forward.o1.out from 0.417135813 to -0.01 (outside the [0, 1] probability range). " +
          "Under topology.activation_output='softmax', Rule 0.8 (probability bounds, a sub-check " +
          "of Rule 0) fires on each output.out that falls outside [0, 1]. Rule 0 short-circuits, " +
          "so this fires before any numeric rule (1-13) gets a chance to also fail.",
      }
    },
  },
  // 2. bad-softmax-sum — Rule 11. forward.o2.out += 0.1; sum now ≠ 1.
  {
    kind: "softmax-sum",
    ruleRecord: 11,
    mutate: (r) => {
      const original = r.forward.o2!.out
      const mutated = original + 0.1 // now in [0,1] still (was 0.256, now 0.356); sum != 1
      r.forward.o2!.out = mutated
      return {
        fieldPath: "forward.o2.out",
        original,
        mutated,
        description:
          "Mutated forward.o2.out by +0.1 (from 0.256049895 to 0.356049895). Each individual " +
          "value stays in [0, 1] (Rule 0.8 passes), but sum(forward[output].out) now ≈ 1.1 " +
          "instead of 1.0. Rule 11 (softmax normalization) fires. Cascades into Rules 12 / 13c " +
          "since p_o2 was used to compute loss.per_output.o2, signal_value.o2, dual_form on " +
          "every unit — those checks ALSO fail but Rule 11 is the load-bearing detector.",
      }
    },
  },
  // 3. bad-ce-per-output — Rule 12 (CE per_output). loss.per_output.o1 += 0.1.
  {
    kind: "ce-per-output",
    ruleRecord: 12,
    mutate: (r) => {
      const original = r.loss.per_output.o1
      const mutated = original + 0.1
      r.loss.per_output.o1 = mutated
      return {
        fieldPath: "loss.per_output.o1",
        original,
        mutated,
        description:
          "Mutated loss.per_output.o1 by +0.1 (from 0.874343420 to 0.974343420). Rule 12 " +
          "(cross_entropy_softmax branch) fires: stored 0.974... != recomputed (-y_o1 * log(p_o1) " +
          "= -1 * log(0.417135813) = 0.874...). No cascade — loss.total is checked independently " +
          "against forward+targets, not against loss.per_output[*].",
      }
    },
  },
  // 4. bad-ce-total — Rule 12 (CE total). loss.total += 0.1.
  {
    kind: "ce-total",
    ruleRecord: 12,
    mutate: (r) => {
      const original = r.loss.total
      const mutated = original + 0.1
      r.loss.total = mutated
      return {
        fieldPath: "loss.total",
        original,
        mutated,
        description:
          "Mutated loss.total by +0.1 (from 0.874343420 to 0.974343420). Rule 12 " +
          "(cross_entropy_softmax branch) fires on the total check: stored 0.974... != " +
          "expected sum(-y_u * log(p_u)) over output units = 0.874... + 0 + 0 = 0.874... " +
          "(since y_o2 = y_o3 = 0 force the term to 0). loss.per_output.o1 entry still " +
          "matches the formula independently.",
      }
    },
  },
  // 5. bad-dual-term — Rules 13a + 13b. dual_form.o1.jacobian_terms[0].term_value mutated.
  {
    kind: "dual-term",
    ruleRecord: 13,
    mutate: (r) => {
      const sig = r.backward.output_error_signals.o1!
      const term0 = sig.dual_form!.jacobian_terms[0]!
      const original = term0.term_value
      const mutated = original + 0.001 // 0.582864... → 0.583864...
      term0.term_value = mutated
      return {
        fieldPath: "backward.output_error_signals.o1.dual_form.jacobian_terms[0].term_value",
        original,
        mutated,
        description:
          "Mutated dual_form for o1: jacobian_terms[0].term_value by +0.001 (0.582864... → " +
          "0.583864...) without touching its factors or the dual_form.summed_value. Rule 13a " +
          "(per-term multiplication) fires: factors product (1 * 0.582864... = 0.582864...) " +
          "disagrees with the mutated term_value. Rule 13b (summation) ALSO fires: sum of " +
          "jacobian_terms (now 0.583864... + 0 + 0 = 0.583864...) disagrees with summed_value " +
          "(still 0.582864...). Rule 13c passes because summed_value matches signal_value still.",
      }
    },
  },
  // 6. bad-dual-sum — Rules 13b + 13c. dual_form.o1.summed_value mutated.
  {
    kind: "dual-sum",
    ruleRecord: 13,
    mutate: (r) => {
      const sig = r.backward.output_error_signals.o1!
      const original = sig.dual_form!.summed_value
      const mutated = original + 0.001 // 0.582864... → 0.583864...
      sig.dual_form!.summed_value = mutated
      return {
        fieldPath: "backward.output_error_signals.o1.dual_form.summed_value",
        original,
        mutated,
        description:
          "Mutated dual_form for o1: summed_value by +0.001 (0.582864... → 0.583864...) " +
          "without touching the jacobian_terms or signal_value. Rule 13b (summation) fires: " +
          "sum of jacobian_terms (0.582864...) disagrees with summed_value (0.583864...). " +
          "Rule 13c (collapsed-vs-dual) ALSO fires: summed_value (0.583864...) disagrees with " +
          "OutputErrorSignal.signal_value (still 0.582864...). Rule 13a (per-term multiplication) " +
          "passes because factors product = term_value for every term.",
      }
    },
  },
  // 7. bad-collapsed-vs-dual — Rule 13c alone. Self-consistent dual_form drifted from signal_value.
  {
    kind: "collapsed-vs-dual",
    ruleRecord: 13,
    mutate: (r) => {
      const sig = r.backward.output_error_signals.o1!
      const dual = sig.dual_form!
      const term0 = dual.jacobian_terms[0]!
      const deltaFactor = term0.factors[1]! // {name:"delta_ju_minus_p_u", value: 0.582864...}
      const originalDelta = deltaFactor.value
      // Add +0.001 to the delta_ju_minus_p_u factor → term_value becomes
      // y_j (= 1) * (delta + 0.001) = original + 0.001. summed_value becomes
      // original + 0.001 too (since other terms are 0). signal_value is NOT
      // touched, so collapsed-vs-dual diverges by 0.001 alone.
      const newDelta = originalDelta + 0.001
      const originalTermValue = term0.term_value
      const newTermValue = term0.factors[0]!.value * newDelta // y_j * (delta + 0.001)
      const originalSummed = dual.summed_value
      const newSummed = newTermValue + 0 + 0
      deltaFactor.value = newDelta
      term0.term_value = newTermValue
      dual.summed_value = newSummed
      return {
        fieldPath: "backward.output_error_signals.o1.dual_form.summed_value (and supporting term)",
        original: { delta_ju_minus_p_u: originalDelta, term_value: originalTermValue, summed_value: originalSummed },
        mutated: { delta_ju_minus_p_u: newDelta, term_value: newTermValue, summed_value: newSummed },
        description:
          "Mutated dual_form for o1 SELF-CONSISTENTLY: jacobian_terms[0].factors[1] " +
          "(delta_ju_minus_p_u) by +0.001 AND propagated to term_value (factors product) and " +
          "summed_value (sum of terms). Rules 13a (per-term multiplication) and 13b " +
          "(summation) both PASS because the dual_form is internally consistent. ONLY Rule 13c " +
          "(collapsed-vs-dual) fires: dual_form.summed_value (0.583864...) disagrees with the " +
          "untouched OutputErrorSignal.signal_value (0.582864...). This isolates Rule 13c — " +
          "the GATED cross-form check that depends on dual_form being present.",
      }
    },
  },
]

for (const bad of BADS) {
  const receipt = freshGolden()
  // Mark as deliberately corrupted.
  receipt.fixture_status = {
    authoring_state: "deliberately_corrupted" as "engine_generated",
    verification_state: "expected_to_fail_reconciliation" as "engine_reproduced_byte_equal",
    canonical: false as true,
  }
  receipt.fixture = `softmax-ce.bad-${bad.kind}`
  const mutation = bad.mutate(receipt)
  const bytes = emitGeneralReceipt(receipt)
  const outPath = `fixtures/bad/softmax-ce.bad-${bad.kind}.jsonl`
  writeFileSync(outPath, bytes)

  const meta = {
    schema_version: "0.1.0",
    fixture: `softmax-ce.bad-${bad.kind}.meta`,
    describes: `fixtures/bad/softmax-ce.bad-${bad.kind}.jsonl`,
    based_on:
      "Byte-precise mutation of fixtures/softmax-ce.golden.jsonl. Differs in the 3 fixture_status fields " +
      "and the targeted v0.5 softmax+CE field(s) described below.",
    mutation: {
      field_path: mutation.fieldPath,
      original: mutation.original,
      mutated: mutation.mutated,
      kind: "v0_5_softmax_ce_targeted_mutation",
      description: mutation.description,
    },
    reconciliation_check_targeted_first:
      bad.ruleRecord === 0
        ? "Rule 0 (Rule 0.8 sub-check: softmax probability bounds): forward[output].out MUST be in [0, 1] when topology.activation_output === 'softmax'."
        : bad.ruleRecord === 11
        ? "Rule 11 (softmax normalization): sum(forward[output].out) MUST equal 1.0 within tolerance when topology.activation_output === 'softmax'."
        : bad.ruleRecord === 12
        ? "Rule 12 (loss formula consistency, cross_entropy_softmax branch): loss.per_output[u] == -y_u * log(p_u) AND loss.total == sum over output units."
        : "Rule 13 (gated dual-form consistency): when OutputErrorSignal.dual_form is present, 13a per-term multiplication, 13b summation, 13c collapsed-vs-dual must hold.",
    purpose:
      "Anti-circularity (Csmith/CompCert lineage) for the v0.5 softmax+CE reconciler additions " +
      "(Rules 0.8 / 11 / 12 CE branch / 13 gated dual-form). Targeted mutation isolates the rule under test.",
    v0_5_note:
      "v0.5 ships the softmax+CE wave: schema v0.3.0 (additive), Rules 0.8/11/13 new, Rule 12 CE branch " +
      "filled in. The 7-fixture plate exercises every new rule plus each sub-check of Rule 13.",
  }
  writeFileSync(outPath.replace(/\.jsonl$/, ".meta.json"), JSON.stringify(meta, null, 2) + "\n")
  console.log(`wrote ${outPath}`)
}
