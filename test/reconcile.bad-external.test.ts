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
