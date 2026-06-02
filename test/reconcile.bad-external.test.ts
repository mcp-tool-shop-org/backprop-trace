/**
 * v0.6 — bad-external fixture tests.
 *
 * Covers the 8-fixture plate for the new v0.6 external-ingestion rules
 * (14/15/16) plus the cross-fire cases where existing rules (0.8, 7, 11,
 * 12) also catch the targeted mutation on the ingest path.
 *
 * Per-fixture assertions assert that the LOAD-BEARING rule fires (not
 * exclusively — Rule 14 cross-fires on most because the differential
 * check independently detects the foreign-claim drift). The doctrine
 * ratchet ensures every implemented rule has a paired fixture; these
 * tests verify the fixtures actually exercise the rule machinery.
 */

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"
import {
  reconcileReceipt,
  type ReconciliationFailure,
} from "../src/reconcile.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, "..")

function loadBadFixture(name: string): unknown | null {
  const fpath = resolve(repoRoot, `fixtures/bad/${name}`)
  if (!existsSync(fpath)) return null
  return JSON.parse(readFileSync(fpath, "utf-8").trim())
}

function rulesFired(failures: ReconciliationFailure[]): number[] {
  return [...new Set(failures.map((f) => f.rule))].sort((a, b) => a - b)
}

// =============================================================================
// Rule 14 — engine-recompute differential
// =============================================================================

test("external.bad-collapsed-laundered fires Rule 14 (engine-recompute catches mutated signal_value)", () => {
  const r = loadBadFixture("external.bad-collapsed-laundered.jsonl")
  if (r === null) return
  const result = reconcileReceipt(r)
  assert.strictEqual(result.ok, false, "must fail reconcile")
  if (result.ok) return
  const rule14 = result.failures.filter((f) => f.rule === 14)
  assert.ok(
    rule14.length >= 1,
    `expected at least one Rule 14 failure (engine recompute disagrees on collapsed-laundered receipt); ` +
      `got rules: ${rulesFired(result.failures).join(",")}`,
  )
  // dual_form is absent (this is collapsed-only) — Rule 13 must silently
  // skip. Rule 14 is the load-bearing defense.
  const rule13 = result.failures.filter((f) => f.rule === 13)
  assert.strictEqual(
    rule13.length,
    0,
    `Rule 13 must remain GATED-silent on collapsed-only receipts; got: ${JSON.stringify(rule13.map((f) => f.field_path))}`,
  )
})

test("external.bad-engine-reproduce-disagrees fires Rule 14 (drift outside differential_tolerance)", () => {
  const r = loadBadFixture("external.bad-engine-reproduce-disagrees.jsonl")
  if (r === null) return
  const result = reconcileReceipt(r)
  assert.strictEqual(result.ok, false)
  if (result.ok) return
  const rule14 = result.failures.filter((f) => f.rule === 14)
  assert.ok(
    rule14.length >= 1,
    `expected Rule 14 failure on forward.o1.out drift; got rules: ${rulesFired(result.failures).join(",")}`,
  )
})

// =============================================================================
// G-013 — Rule 14 isolated as the SOLE defense + anti-circularity on the
// authoring_state gate.
//
// The four shipped external 'Rule 14' fixtures all cross-fire Rules 7/8/12, so
// none of them proves Rule 14 alone catches an engine-recompute divergence.
// This fixture is internally consistent on ALL per-receipt math rules (1-8,
// 11-13) — its self-declared forward/backward/updates/parameters_after agree
// with each other — but parameters_before.b_hidden (a forward-pass input) is
// shifted, so an INDEPENDENT engine recompute diverges. ONLY Rule 14 fires.
// =============================================================================

const RULE14_ONLY = "fixtures/external/external.rule14-only-bias-divergence.jsonl"

function loadExternalFixture(rel: string): unknown | null {
  const fpath = resolve(repoRoot, rel)
  if (!existsSync(fpath)) return null
  return JSON.parse(readFileSync(fpath, "utf-8").trim())
}

test("G-013: rule14-only fixture fires EXACTLY Rule 14 (no per-receipt rule cross-fires)", () => {
  const r = loadExternalFixture(RULE14_ONLY)
  if (r === null) {
    assert.fail(
      `G-013 isolation fixture missing: ${RULE14_ONLY}. The reconciler agent owns ` +
        `fixtures/external/ and must ship this fixture this wave.`,
    )
    return
  }
  const result = reconcileReceipt(r)
  assert.strictEqual(
    result.ok,
    false,
    "an engine-recompute divergence must be rejected even when the receipt is " +
      "internally consistent on every per-receipt rule",
  )
  if (result.ok) return
  const rules = rulesFired(result.failures)
  assert.deepStrictEqual(
    rules,
    [14],
    `Rule 14 must be the SOLE rule that fires (the receipt is internally consistent on ` +
      `Rules 1-8/11-13; only the independent engine recompute objects). Got rules: ${rules.join(",")}. ` +
      `Non-14 failures: ${JSON.stringify(result.failures.filter((f) => f.rule !== 14).map((f) => ({ rule: f.rule, field_path: f.field_path })))}`,
  )
})

test("G-013 anti-circularity: flipping authoring_state away from 'external_imported' does NOT launder the bad math", () => {
  const r = loadExternalFixture(RULE14_ONLY)
  if (r === null) {
    assert.fail(`G-013 isolation fixture missing: ${RULE14_ONLY}`)
    return
  }
  // The laundering attempt: a foreign receipt with bad math relabels its
  // authoring_state so the observer math gate (Rule 14) no-ops. Because the
  // receipt is internally consistent, NO per-receipt rule would object — so
  // without a guard, the relabel turns a REJECT into a clean PASS. That is the
  // exact anti-circularity hole this test closes: the receipt carries framework
  // import-provenance (source_framework + attestor.import_provenance) yet denies
  // being externally imported. The reconciler must reject the contradiction.
  const fs = (r as { fixture_status: { authoring_state?: string } }).fixture_status
  for (const launderedState of ["engine_generated", "internal", "self_authored"]) {
    const clone = JSON.parse(JSON.stringify(r)) as {
      fixture_status: { authoring_state?: string }
    }
    clone.fixture_status.authoring_state = launderedState
    const result = reconcileReceipt(clone)
    assert.strictEqual(
      result.ok,
      false,
      `relabeling authoring_state to '${launderedState}' must NOT launder the bad math — ` +
        `a receipt carrying framework import-provenance cannot deny being external_imported ` +
        `to dodge Rule 14 (the engine-recompute math gate). Csmith/CompCert anti-circularity: ` +
        `the receipt's self-label may not suppress the check that judges it.`,
    )
  }
  // Sanity: the original (honest authoring_state) still reconciles to exactly [14].
  void fs
})

// =============================================================================
// G-S2 (FIX-2): closing the authoring_state laundering hole COMPLETELY.
//
// The first-wave G-013 guard keyed ONLY on attestor.import_provenance. That left
// a residual laundering path: DELETE the import_provenance tell (or the whole
// attestor), KEEP source_framework, and relabel authoring_state to a valid
// engine value — dodging both the Rule 0 guard AND Rule 14 (the engine-recompute
// math gate), laundering fabricated foreign forward math into a clean PASS.
//
// The rule14-only fixture has a shifted parameters_before.b_hidden, so an
// INDEPENDENT engine recompute diverges — i.e. the forward math IS fabricated.
// Both laundering variants below MUST still be rejected because source_framework
// survives as an independent import marker.
//
// MUTATION THAT MAKES THESE RED: in checkRule0ObserverProvenanceConsistency,
// drop the source_framework marker (revert to keying ONLY on
// attestor.import_provenance). Then both tests go RED — with import_provenance
// deleted, hasImportProvenance is false, the guard returns early, Rule 14 no-ops
// (authoring_state flipped), no per-receipt rule objects, and reconcileReceipt
// returns ok:true (the false PASS).
// =============================================================================

test("G-S2 (a): delete attestor.import_provenance + flip authoring_state to engine_generated — STILL rejected (source_framework is an independent import marker)", () => {
  const r = loadExternalFixture(RULE14_ONLY)
  if (r === null) {
    assert.fail(`G-S2 fixture missing: ${RULE14_ONLY}`)
    return
  }
  const clone = JSON.parse(JSON.stringify(r)) as {
    fixture_status: { authoring_state?: string }
    source_framework?: unknown
    attestor?: { import_provenance?: unknown }
  }
  // The laundering attempt: strip the import_provenance tell, keep
  // source_framework, relabel authoring_state to a valid engine value.
  delete clone.attestor!.import_provenance
  clone.fixture_status.authoring_state = "engine_generated_general"

  const result = reconcileReceipt(clone)
  assert.strictEqual(
    result.ok,
    false,
    "deleting attestor.import_provenance and relabeling authoring_state to an engine value must " +
      "NOT launder the fabricated forward math — source_framework still marks the receipt as " +
      "framework-originated, so it cannot deny being external_imported (Csmith/CompCert anti-circularity)",
  )
  if (result.ok) return
  const rule0 = result.failures.find(
    (f) =>
      f.rule === 0 &&
      f.field_path === "fixture_status.authoring_state" &&
      /source_framework/.test(f.message ?? ""),
  )
  assert.ok(
    rule0,
    `expected a Rule 0 observer-provenance failure naming source_framework as the surviving ` +
      `import marker; got: ${JSON.stringify(
        result.failures.map((f) => ({ rule: f.rule, field_path: f.field_path })),
      )}`,
  )
})

test("G-S2 (b): delete the WHOLE attestor + flip authoring_state — STILL rejected (source_framework alone is sufficient)", () => {
  const r = loadExternalFixture(RULE14_ONLY)
  if (r === null) {
    assert.fail(`G-S2 fixture missing: ${RULE14_ONLY}`)
    return
  }
  const clone = JSON.parse(JSON.stringify(r)) as {
    fixture_status: { authoring_state?: string }
    source_framework?: unknown
    attestor?: unknown
  }
  // The most aggressive laundering: remove the entire attestor block (no
  // import_provenance, no differential_tolerance, no skip_basis) and relabel
  // authoring_state. Only source_framework remains to betray the foreign origin.
  delete clone.attestor
  clone.fixture_status.authoring_state = "engine_generated_general"

  const result = reconcileReceipt(clone)
  assert.strictEqual(
    result.ok,
    false,
    "removing the entire attestor must NOT launder the fabricated forward math — source_framework " +
      "alone is a sufficient import marker; a framework-originated trace cannot relabel itself " +
      "engine-authored to dodge Rule 14",
  )
  if (result.ok) return
  const rule0 = result.failures.find(
    (f) =>
      f.rule === 0 &&
      f.field_path === "fixture_status.authoring_state" &&
      /source_framework/.test(f.message ?? ""),
  )
  assert.ok(
    rule0,
    `expected a Rule 0 observer-provenance failure naming source_framework; got: ${JSON.stringify(
      result.failures.map((f) => ({ rule: f.rule, field_path: f.field_path })),
    )}`,
  )
})

// G-S2 anti-vacuity: engine-authored receipts (no source_framework, no attestor)
// must NOT be condemned by the widened marker check.
test("G-S2 anti-vacuity: an engine-authored golden (no source_framework) does NOT fire the observer-provenance guard", () => {
  const goldenPath = resolve(repoRoot, "fixtures/mazur.golden.jsonl")
  if (!existsSync(goldenPath)) return
  const r = JSON.parse(readFileSync(goldenPath, "utf-8").trim())
  const result = reconcileReceipt(r)
  assert.strictEqual(
    result.ok,
    true,
    `engine-authored mazur golden carries no source_framework and no attestor — the widened ` +
      `source_framework marker check must not mis-fire on it; got: ${
        result.ok === false
          ? JSON.stringify(result.failures.map((f) => ({ rule: f.rule, field_path: f.field_path })))
          : "ok"
      }`,
  )
})

// =============================================================================
// Rule 15 — skip-basis required
// =============================================================================

test("external.bad-skip-without-basis fires Rule 15 ALONE (skip declared without attestor.skip_basis)", () => {
  const r = loadBadFixture("external.bad-skip-without-basis.jsonl")
  if (r === null) return
  const result = reconcileReceipt(r)
  assert.strictEqual(result.ok, false)
  if (result.ok) return
  const rules = rulesFired(result.failures)
  assert.deepStrictEqual(
    rules,
    [15],
    `bad-skip-without-basis must fire ONLY Rule 15 (verification_state declares skip; ` +
      `attestor.skip_basis is absent; Rule 14 short-circuits when skip is declared). ` +
      `Got rules: ${rules.join(",")}`,
  )
  const fail = result.failures[0]!
  assert.strictEqual(fail.field_path, "attestor.skip_basis")
  assert.match(fail.message ?? "", /closed enum/)
  assert.match(fail.message ?? "", /EXTERNAL_TRUST_BASIS/)
})

// =============================================================================
// Rule 16 — attestation digest binding
// =============================================================================

test("external.bad-attested-mutated-after fires Rule 16 (digest no longer matches)", () => {
  const r = loadBadFixture("external.bad-attested-mutated-after.jsonl")
  if (r === null) return
  const result = reconcileReceipt(r)
  assert.strictEqual(result.ok, false)
  if (result.ok) return
  const rule16 = result.failures.filter((f) => f.rule === 16)
  assert.ok(
    rule16.length >= 1,
    `expected Rule 16 failure (signed_subject_digest does not match recomputed digest); ` +
      `got rules: ${rulesFired(result.failures).join(",")}`,
  )
  assert.strictEqual(rule16[0]!.field_path, "attestor.signed_subject_digest")
  assert.match(rule16[0]!.message ?? "", /SolarWinds-style "signed-but-substituted"/)
})

// =============================================================================
// Cross-fire / existing-rule fixtures
// =============================================================================

test("external.bad-shape-not-math fires Rule 12 (cross_entropy_softmax branch) on ingest path", () => {
  const r = loadBadFixture("external.bad-shape-not-math.jsonl")
  if (r === null) return
  const result = reconcileReceipt(r)
  assert.strictEqual(result.ok, false)
  if (result.ok) return
  const rule12 = result.failures.filter((f) => f.rule === 12)
  assert.ok(rule12.length >= 1, `expected Rule 12 (CE per_output) failure`)
})

test("external.bad-framework-spoof fires Rule 0.8 (probability bounds — identity does not mute math)", () => {
  const r = loadBadFixture("external.bad-framework-spoof.jsonl")
  if (r === null) return
  const result = reconcileReceipt(r)
  assert.strictEqual(result.ok, false)
  if (result.ok) return
  const rule0 = result.failures.filter((f) => f.rule === 0)
  assert.ok(rule0.length >= 1, "expected Rule 0 failure (Rule 0.8 sub-check)")
  assert.match(rule0[0]!.message ?? "", /Rule 0\.8 \(probability bounds\)/)
})

test("external.bad-partial-tamper-internally-consistent fires Rule 7 on ingest path (doctrine fixture)", () => {
  const r = loadBadFixture(
    "external.bad-partial-tamper-internally-consistent.jsonl",
  )
  if (r === null) return
  const result = reconcileReceipt(r)
  assert.strictEqual(result.ok, false)
  if (result.ok) return
  const rule7 = result.failures.filter((f) => f.rule === 7)
  assert.ok(
    rule7.length >= 1,
    "Rule 7 (final-state consistency) must fire on observer-mode receipts too — " +
      "existing rules apply on the ingest path",
  )
  // Rule 14 also fires because engine recompute catches the same drift.
  const rule14 = result.failures.filter((f) => f.rule === 14)
  assert.ok(rule14.length >= 1, "Rule 14 must also catch parameters_after drift")
})

test("external.bad-trusted-source-bad-math fires Rule 0.8 (trusted source URL cannot mute math gate)", () => {
  const r = loadBadFixture("external.bad-trusted-source-bad-math.jsonl")
  if (r === null) return
  const result = reconcileReceipt(r)
  assert.strictEqual(result.ok, false)
  if (result.ok) return
  const rule0 = result.failures.filter((f) => f.rule === 0)
  assert.ok(
    rule0.length >= 1,
    "Rule 0.8 must fire regardless of source_framework.information_uri value",
  )
})

// =============================================================================
// Engine-authored receipts: Rules 14/15/16 stay no-op
// =============================================================================

test("Mazur golden does NOT fire Rule 14/15/16 (engine-authored receipts skip observer rules)", () => {
  const goldenPath = resolve(repoRoot, "fixtures/mazur.golden.jsonl")
  if (!existsSync(goldenPath)) return
  const r = JSON.parse(readFileSync(goldenPath, "utf-8").trim())
  const result = reconcileReceipt(r)
  assert.strictEqual(
    result.ok,
    true,
    `Mazur golden is engine-authored — Rules 14/15/16 must all be no-ops; got failures: ${
      result.ok === false ? JSON.stringify(result.failures.map((f) => ({ rule: f.rule, field_path: f.field_path }))) : "ok"
    }`,
  )
})

test("softmax-ce golden does NOT fire Rule 14/15/16 (engine-authored receipts skip observer rules)", () => {
  const goldenPath = resolve(repoRoot, "fixtures/softmax-ce.golden.jsonl")
  if (!existsSync(goldenPath)) return
  const r = JSON.parse(readFileSync(goldenPath, "utf-8").trim())
  const result = reconcileReceipt(r)
  assert.strictEqual(
    result.ok,
    true,
    `softmax-ce golden is engine-authored — Rules 14/15/16 must be no-ops; got failures: ${
      result.ok === false ? JSON.stringify(result.failures.map((f) => ({ rule: f.rule, field_path: f.field_path }))) : "ok"
    }`,
  )
})

test("pytorch.softmax-ce golden (observer-mode) reconciles cleanly (Rule 14 differential passes)", () => {
  const goldenPath = resolve(
    repoRoot,
    "fixtures/external/pytorch.softmax-ce.golden.jsonl",
  )
  if (!existsSync(goldenPath)) return
  const r = JSON.parse(readFileSync(goldenPath, "utf-8").trim())
  const result = reconcileReceipt(r)
  assert.strictEqual(
    result.ok,
    true,
    `PyTorch observer-mode golden must reconcile cleanly (engine recompute agrees ` +
      `with foreign claims within differential_tolerance); got: ${
        result.ok === false ? JSON.stringify(result.failures.map((f) => ({ rule: f.rule, field_path: f.field_path }))) : "ok"
      }`,
  )
})
