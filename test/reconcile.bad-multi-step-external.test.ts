/**
 * v0.8 — multi-step observer-mode bad-fixture plate test.
 *
 * Five fixtures, each proving a specific cross-step attack class is
 * caught by the named rule. Reconciliation goes through reconcileMultiStep
 * (the v0.8 entry point for multi-record observer-mode), which composes
 * per-receipt Rules 1-8 + cross-record Rules 9, 10, 17.
 *
 * Anti-circularity discipline (Csmith/CompCert): every test asserts the
 * targeted rule fires BEFORE the reconciler consults fixture_status
 * metadata. The fixtures all declare fixture_status.verification_state =
 * 'expected_to_fail_reconciliation' but the reconciler MUST detect the
 * violation independently.
 *
 * Rule 17 framing: BUNDLE INTEGRITY, not producer-authenticity. Fixtures
 * 4 and 5 test the integrity layer — they catch accidental splice / post-
 * binding mutation / heterogeneous bundle binding, not a malicious actor
 * who controls all receipt bytes AND recomputes the bundle digest.
 */

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"
import { reconcileMultiStep } from "../src/reconcile.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, "..")

function loadFixture(name: string): unknown[] {
  const p = resolve(repoRoot, `fixtures/bad/${name}.jsonl`)
  if (!existsSync(p)) {
    throw new Error(`Fixture ${name} not found. Run scripts/generate-multi-step-external-bad-fixtures.ts.`)
  }
  const text = readFileSync(p, "utf-8").trim()
  return text.split("\n").map((l) => JSON.parse(l))
}

// =============================================================================
// Fixture 1: bad-step-index-gap → Rule 10 (with possible Rule 9, Rule 17 cross-fire)
// =============================================================================

test("multi-step-external.bad-step-index-gap fires Rule 10 (non-dense step_index sequence)", () => {
  const receipts = loadFixture("multi-step-external.bad-step-index-gap")
  const result = reconcileMultiStep(receipts)
  assert.strictEqual(result.ok, false, "must fail reconcile (sequence is [0, 2], not [0, 1])")
  if (result.ok) return
  const rule10 = result.failures.filter((f) => f.rule === 10)
  assert.ok(
    rule10.length >= 1,
    `expected Rule 10 to fire on step_index gap; got rules: ${[
      ...new Set(result.failures.map((f) => f.rule)),
    ]
      .sort()
      .join(", ")}`,
  )
})

// =============================================================================
// Fixture 2: bad-chain-break-cross-step-internally-consistent → Rule 9
// =============================================================================
// Load-bearing: each step is individually internally consistent (Rule 14
// passes per-step because engine recomputed everything from mutated weights)
// but Rule 9 fires on the chain.

test("multi-step-external.bad-chain-break-cross-step-internally-consistent fires Rule 9 (parameters_before[1] ≠ parameters_after[0])", () => {
  const receipts = loadFixture(
    "multi-step-external.bad-chain-break-cross-step-internally-consistent",
  )
  const result = reconcileMultiStep(receipts)
  assert.strictEqual(
    result.ok,
    false,
    "must fail reconcile (cross-step chain broken even though each step is internally consistent)",
  )
  if (result.ok) return
  const rule9 = result.failures.filter((f) => f.rule === 9)
  assert.ok(
    rule9.length >= 1,
    `expected Rule 9 to fire on cross-step chain break; got rules: ${[
      ...new Set(result.failures.map((f) => f.rule)),
    ]
      .sort()
      .join(", ")}`,
  )
})

// =============================================================================
// Fixture 3: bad-fabricated-mid-step → Rule 9
// =============================================================================

test("multi-step-external.bad-fabricated-mid-step fires Rule 9 (fabricated step 1 has no lineage to step 0)", () => {
  const receipts = loadFixture("multi-step-external.bad-fabricated-mid-step")
  const result = reconcileMultiStep(receipts)
  assert.strictEqual(result.ok, false)
  if (result.ok) return
  const rule9 = result.failures.filter((f) => f.rule === 9)
  assert.ok(
    rule9.length >= 1,
    `expected Rule 9 to fire on fabricated mid-step; got rules: ${[
      ...new Set(result.failures.map((f) => f.rule)),
    ]
      .sort()
      .join(", ")}`,
  )
})

// =============================================================================
// Fixture 4: bad-cross-trace-splice → Rule 17 (bundle-integrity recompute)
// =============================================================================
// Honest framing: this fixture catches the "splice without recomputing
// bundle root" case — the realistic accident / sloppy-attacker threat
// model. Rule 17 does NOT defend against an attacker who controls all
// receipt bytes AND recomputes the bundle digest.

test("multi-step-external.bad-cross-trace-splice fires Rule 17 (bundle-integrity recompute mismatch)", () => {
  const receipts = loadFixture("multi-step-external.bad-cross-trace-splice")
  const result = reconcileMultiStep(receipts)
  assert.strictEqual(result.ok, false)
  if (result.ok) return
  const rule17 = result.failures.filter((f) => f.rule === 17)
  assert.ok(
    rule17.length >= 1,
    `expected Rule 17 to fire on bundle-integrity recompute mismatch; got rules: ${[
      ...new Set(result.failures.map((f) => f.rule)),
    ]
      .sort()
      .join(", ")}`,
  )
  // The diagnostic message MUST disclose the honest framing.
  const msg = rule17[0]!.message ?? ""
  assert.match(
    msg,
    /BUNDLE INTEGRITY|bundle-integrity|not.*producer-authenticity|not a producer-authenticity/i,
    "Rule 17 diagnostic must explicitly disclose that it is a bundle-integrity check, NOT a producer-authenticity check",
  )
})

// =============================================================================
// Fixture 5: bad-bundle-digest-tampered → Rule 17 (value-consistency)
// =============================================================================

test("multi-step-external.bad-bundle-digest-tampered fires Rule 17 (value-consistency mismatch across receipts)", () => {
  const receipts = loadFixture("multi-step-external.bad-bundle-digest-tampered")
  const result = reconcileMultiStep(receipts)
  assert.strictEqual(result.ok, false)
  if (result.ok) return
  const rule17 = result.failures.filter((f) => f.rule === 17)
  assert.ok(
    rule17.length >= 1,
    `expected Rule 17 to fire on bundle_root_digest value mismatch; got rules: ${[
      ...new Set(result.failures.map((f) => f.rule)),
    ]
      .sort()
      .join(", ")}`,
  )
  const msg = rule17[0]!.message ?? ""
  assert.match(
    msg,
    /value-consistency|bundle_root_digest mismatch|MUST declare the same/i,
    "Rule 17 diagnostic for value-consistency violation must name the mismatch",
  )
})

// =============================================================================
// Good golden reconciles cleanly (counter-positive sanity)
// =============================================================================

test("multi-step golden reconciles cleanly (no false positives from Rule 17 on the canonical bundle)", () => {
  const goldenPath = resolve(
    repoRoot,
    "fixtures/external/pytorch.softmax-ce.multi-step.golden.jsonl",
  )
  if (!existsSync(goldenPath)) return
  const receipts = readFileSync(goldenPath, "utf-8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l))
  const result = reconcileMultiStep(receipts)
  assert.strictEqual(
    result.ok,
    true,
    `Canonical multi-step golden must pass all rules including Rule 17; failures: ${
      result.ok === false
        ? JSON.stringify(result.failures.map((f) => ({ rule: f.rule, field_path: f.field_path })))
        : "ok"
    }`,
  )
})
