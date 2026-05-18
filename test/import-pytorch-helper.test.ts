/**
 * v0.10 — Happy-path test for the PyTorch live-helper emission contract.
 *
 * Verifies that:
 *   (a) the v0.7.0 schema validates a helper-emitted sidecar (helper
 *       block present and well-formed).
 *   (b) importPytorchSidecar accepts the v0.7.0 sidecar and produces a
 *       v0.4.0 observer-mode receipt with engine_recompute_matched_within_tolerance.
 *   (c) the produced receipt reconciles to ok: true (all rules pass).
 *   (d) the v0.7.0 schema REJECTS a sidecar that declares pytorch as
 *       source_framework.name but omits the required `helper` block
 *       (defends the conditional-required invariant).
 *
 * The Python helper itself is exercised at a different test layer (TBD —
 * v0.10.x); this test verifies the JS-side ingestion contract.
 */

import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { importPytorchSidecar } from "../src/import-pytorch.js"
import { reconcileReceipt } from "../src/reconcile.js"
import {
  validateFrameworkTraceSidecar,
  validateFrameworkTraceSidecarOrThrow,
} from "../src/validate.js"

const GOOD_FIXTURE = resolve(
  "fixtures/external/pytorch.helper-emitted.sgd.softmax-ce.sidecar.jsonl",
)
const ADAMW_FIXTURE = resolve(
  "fixtures/external/pytorch.helper-emitted.adamw.sidecar.jsonl",
)
const SGD_MOMENTUM_FIXTURE = resolve(
  "fixtures/external/pytorch.helper-emitted.sgd-momentum.sidecar.jsonl",
)

test("v0.7.0 schema: helper-emitted sidecar validates byte-identical", () => {
  const bytes = readFileSync(GOOD_FIXTURE, "utf-8")
  const sidecar = JSON.parse(bytes.trim())
  const result = validateFrameworkTraceSidecar(sidecar)
  assert.equal(result.ok, true, `schema validation must pass; errors: ${JSON.stringify(("errors" in result) ? result.errors : [])}`)
  assert.equal(result.schemaVersion, "0.7.0", "schema dispatcher must route to v0.7.0 based on format const")
})

test("v0.7.0 schema: helper block must declare name, version, distribution, source_hash, framework, runtime, extraction", () => {
  const bytes = readFileSync(GOOD_FIXTURE, "utf-8")
  const sidecar = JSON.parse(bytes.trim()) as Record<string, unknown>
  const helper = sidecar.helper as Record<string, unknown>
  assert.ok(helper, "helper block must be present in v0.7.0 sidecar")
  assert.equal(helper.name, "backprop-trace-pytorch-helper")
  // Version follows the fixture-generation script's pinned helper block,
  // which tracks the current helper version. Lockstep with package.version
  // is enforced by:
  //   - test/bp.examples-pytorch.cli.test.ts (HELPER_VERSION matches pkg.version)
  //   - scripts/pack-install-smoke.mjs (printed helper HELPER_VERSION ==
  //     installed package.version) — the v0.10.2 distribution-integrity gate
  assert.equal(helper.version, "0.11.0")
  assert.equal(helper.distribution, "repo-script")
  assert.match(helper.source_hash as string, /^sha256:[0-9a-f]{64}$/)
  assert.ok(helper.framework)
  assert.ok(helper.runtime)
  assert.ok(helper.extraction)
})

test("v0.7.0 schema: forensic helper.source_hash is NOT a credential — any sha256-shaped value validates", () => {
  // The schema only checks shape (sha256: + 64 hex chars). Any value
  // matching the pattern validates. The verifier's authority is Rule 14,
  // not the source_hash. This test asserts the schema does NOT attempt
  // to validate the hash against actual file contents (which would
  // re-introduce the trust-boundary violation we're avoiding).
  const goodSidecar = JSON.parse(readFileSync(GOOD_FIXTURE, "utf-8").trim()) as Record<string, unknown>
  const spoofed = JSON.parse(JSON.stringify(goodSidecar)) as Record<string, unknown>
  ;(spoofed.helper as Record<string, unknown>).source_hash =
    "sha256:0000000000000000000000000000000000000000000000000000000000000000"
  const result = validateFrameworkTraceSidecar(spoofed)
  assert.equal(
    result.ok,
    true,
    "schema validates any sha256-shaped source_hash — Rule 14 is the authority on whether math is consistent",
  )
})

test("v0.7.0 schema: REJECTS pytorch sidecar that omits the helper block", () => {
  // Conditional required: source_framework.name in {pytorch, jax, tensorflow}
  // implies helper REQUIRED (unless source_framework.extractor.name === "hand_authored").
  const goodSidecar = JSON.parse(readFileSync(GOOD_FIXTURE, "utf-8").trim()) as Record<string, unknown>
  const stripped = JSON.parse(JSON.stringify(goodSidecar)) as Record<string, unknown>
  // Remove helper but keep source_framework.name === "pytorch" and a
  // non-"hand_authored" extractor → schema MUST reject.
  delete stripped.helper
  const result = validateFrameworkTraceSidecar(stripped)
  assert.equal(
    result.ok,
    false,
    "v0.7.0 schema must REJECT a sidecar that names pytorch as source_framework.name but omits the helper block",
  )
})

test("v0.7.0 schema: ACCEPTS pytorch sidecar with extractor.name='hand_authored' even without helper block (back-compat escape)", () => {
  const goodSidecar = JSON.parse(readFileSync(GOOD_FIXTURE, "utf-8").trim()) as Record<string, unknown>
  const handAuthored = JSON.parse(JSON.stringify(goodSidecar)) as Record<string, unknown>
  delete handAuthored.helper
  const sf = handAuthored.source_framework as Record<string, unknown>
  sf.extractor = { name: "hand_authored", version: "0.0.0" }
  const result = validateFrameworkTraceSidecar(handAuthored)
  assert.equal(
    result.ok,
    true,
    "v0.7.0 schema must ACCEPT a hand_authored sidecar (back-compat escape for fixtures re-declared as v0.7.0)",
  )
})

test("importPytorchSidecar: v0.7.0 helper-emitted sidecar → observer-mode receipt + Rule 14 matched", () => {
  const bytes = readFileSync(GOOD_FIXTURE, "utf-8")
  const result = importPytorchSidecar(bytes, {
    importTimestamp: "2026-05-18T12:00:00Z",
    differentialTolerance: { atol: 1e-6, rtol: 1e-4 },
  })
  assert.ok(result.receipt, "import must produce a receipt")
  assert.equal(result.differentialPassed, true, "Rule 14 differential must pass on a well-formed helper-emitted sidecar")
  assert.equal(
    result.receipt.fixture_status?.verification_state,
    "engine_recompute_matched_within_tolerance",
    "receipt must declare engine_recompute_matched_within_tolerance on import-time Rule 14 success",
  )
  // The source_format in attestor.import_provenance must reflect v0.7.0
  // (forensic: future readers see the sidecar came from a v0.10+ helper).
  assert.equal(
    result.receipt.attestor?.import_provenance?.source_format,
    "framework-trace.v0.7.0",
    "attestor.import_provenance.source_format must record the v0.7.0 sidecar format",
  )
})

test("importPytorchSidecar: v0.7.0 helper-emitted receipt fully reconciles (all 26 rules pass)", () => {
  const bytes = readFileSync(GOOD_FIXTURE, "utf-8")
  const result = importPytorchSidecar(bytes, {
    importTimestamp: "2026-05-18T12:00:00Z",
  })
  const reconcileResult = reconcileReceipt(result.receipt)
  assert.equal(
    reconcileResult.ok,
    true,
    `helper-emitted receipt must reconcile cleanly; failures: ${
      reconcileResult.ok ? "[]" : JSON.stringify(reconcileResult.failures.map((f) => ({ rule: f.rule, field_path: f.field_path })))
    }`,
  )
})

test("validateFrameworkTraceSidecarOrThrow: helper-emitted sidecar passes the throw-or-narrow path too", () => {
  const bytes = readFileSync(GOOD_FIXTURE, "utf-8")
  const sidecar = JSON.parse(bytes.trim())
  assert.doesNotThrow(() => validateFrameworkTraceSidecarOrThrow(sidecar))
})

// ---------------------------------------------------------------------------
// v0.10.1 — helper-emitted AdamW + sgd_momentum sidecar coverage
// ---------------------------------------------------------------------------

test("v0.10.1: AdamW helper-emitted sidecar — schema validates against v0.7.0", () => {
  const bytes = readFileSync(ADAMW_FIXTURE, "utf-8")
  const sidecar = JSON.parse(bytes.trim())
  const result = validateFrameworkTraceSidecar(sidecar)
  assert.equal(result.ok, true, `AdamW schema validation must pass; errors: ${JSON.stringify("errors" in result ? result.errors : [])}`)
  assert.equal(result.schemaVersion, "0.7.0", "format dispatcher must route to v0.7.0")
})

test("v0.10.1: AdamW helper-emitted sidecar imports + Rule 14 matches (decoupled weight-decay branch)", () => {
  const bytes = readFileSync(ADAMW_FIXTURE, "utf-8")
  const result = importPytorchSidecar(bytes, {
    importTimestamp: "2026-05-18T12:00:00Z",
  })
  assert.equal(result.differentialPassed, true, "AdamW Rule 14 must pass — decoupled weight decay correctly applied")
  assert.equal(
    result.receipt.fixture_status?.verification_state,
    "engine_recompute_matched_within_tolerance",
  )
})

test("v0.10.1: AdamW helper-emitted receipt fully reconciles (Rule 7 AdamW branch + Rule 22-24)", () => {
  const bytes = readFileSync(ADAMW_FIXTURE, "utf-8")
  const result = importPytorchSidecar(bytes, { importTimestamp: "2026-05-18T12:00:00Z" })
  const reconcileResult = reconcileReceipt(result.receipt)
  assert.equal(
    reconcileResult.ok,
    true,
    `AdamW helper-emitted receipt must reconcile cleanly; failures: ${
      reconcileResult.ok ? "[]" : JSON.stringify(reconcileResult.failures.map((f) => ({ rule: f.rule, field_path: f.field_path })))
    }`,
  )
})

test("v0.10.1: sgd_momentum helper-emitted sidecar — schema validates against v0.7.0", () => {
  const bytes = readFileSync(SGD_MOMENTUM_FIXTURE, "utf-8")
  const sidecar = JSON.parse(bytes.trim())
  const result = validateFrameworkTraceSidecar(sidecar)
  assert.equal(result.ok, true, `sgd_momentum schema validation must pass; errors: ${JSON.stringify("errors" in result ? result.errors : [])}`)
  assert.equal(result.schemaVersion, "0.7.0", "format dispatcher must route to v0.7.0")
})

test("v0.10.1: sgd_momentum helper-emitted sidecar carries descent-direction buffer (NOT PyTorch's ascent buffer)", () => {
  // The helper's v0.10.1 contract: state_before / state_after carry
  // sign-flipped buffers (PyTorch ascent → backprop-trace descent).
  // The HAND-AUTHORED source sidecar is already in descent direction
  // by construction (per the v0.9.2 schema's MomentumState convention),
  // so the derived helper-emitted golden inherits the correct sign.
  // A non-flipped helper output would fire Rule 14 / Rule 21 — exercised
  // by the bad-momentum-buffer-not-sign-flipped fixture in reconcile.bad-pytorch-helper.test.ts.
  const bytes = readFileSync(SGD_MOMENTUM_FIXTURE, "utf-8")
  const sidecar = JSON.parse(bytes.trim()) as Record<string, unknown>
  const updates = sidecar.updates as Array<Record<string, unknown>>
  // At least one update should have a non-zero state_after.buffer
  // (post-first-step momentum accumulates the gradient signed for descent).
  const hasNonZeroBuffer = updates.some((u) => {
    const opt = u.optimizer as Record<string, unknown>
    const sa = opt.state_after as Record<string, unknown> | undefined
    return sa && typeof sa.buffer === "number" && sa.buffer !== 0
  })
  assert.ok(
    hasNonZeroBuffer,
    "sgd_momentum helper-emitted golden must carry at least one non-zero state_after.buffer " +
      "to exercise the sign-flip discipline (zero buffer is sign-direction-agnostic)",
  )
})

test("v0.10.1: sgd_momentum helper-emitted sidecar imports + Rule 14 + Rule 21a/21b/21c all match", () => {
  const bytes = readFileSync(SGD_MOMENTUM_FIXTURE, "utf-8")
  const result = importPytorchSidecar(bytes, { importTimestamp: "2026-05-18T12:00:00Z" })
  assert.equal(result.differentialPassed, true, "sgd_momentum Rule 14 must pass — buffer in descent direction")
  assert.equal(
    result.receipt.fixture_status?.verification_state,
    "engine_recompute_matched_within_tolerance",
  )
})

test("v0.10.1: sgd_momentum helper-emitted receipt fully reconciles (Rule 20 + 21a/b/c + 25 + 26)", () => {
  const bytes = readFileSync(SGD_MOMENTUM_FIXTURE, "utf-8")
  const result = importPytorchSidecar(bytes, { importTimestamp: "2026-05-18T12:00:00Z" })
  const reconcileResult = reconcileReceipt(result.receipt)
  assert.equal(
    reconcileResult.ok,
    true,
    `sgd_momentum helper-emitted receipt must reconcile cleanly; failures: ${
      reconcileResult.ok ? "[]" : JSON.stringify(reconcileResult.failures.map((f) => ({ rule: f.rule, field_path: f.field_path })))
    }`,
  )
})
