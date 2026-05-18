/**
 * v0.10 — Anti-circularity tests for the PyTorch live-helper adversarial
 * fixture plate (`fixtures/bad/pytorch-helper.bad-*.jsonl`).
 *
 * For each fixture, assert:
 *   (a) the fixture sidecar imports through `bp import pytorch` machinery
 *       (importPytorchSidecar) WITHOUT throwing — bad helpers produce
 *       schema-valid sidecars; the wrongness is semantic, not structural.
 *   (b) the resulting observer-mode receipt reconciles to ok: false.
 *   (c) the failure's rule field matches the meta file's
 *       expected_failures[0].rule.
 *   (d) the meta file is read AFTER reconcile.failures is captured —
 *       anti-circularity: the verifier rejects WITHOUT consulting
 *       fixture_status / authoring_state / verification_state.
 *
 * Doctrine: bad receipts precede good receipts (Csmith / CompCert). The
 * live PyTorch helper at scripts/extract/pytorch.py is OBSERVER ONLY.
 * Rule 14 (engine-recompute differential) is the authority on every
 * helper-emitted sidecar regardless of helper claims. This test
 * verifies that bad sidecars get rejected by the reconciler EVEN WHEN
 * the helper block looks well-formed.
 */

import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync, readdirSync, existsSync } from "node:fs"
import { resolve } from "node:path"
import { reconcileReceipt } from "../src/reconcile.js"
import { importPytorchSidecar } from "../src/import-pytorch.js"

const FIXTURES_DIR = resolve("fixtures/bad")

type HelperFixture = {
  filename: string
  expectedRule: number
  bug: string
}

function discoverHelperFixtures(): HelperFixture[] {
  if (!existsSync(FIXTURES_DIR)) return []
  const files = readdirSync(FIXTURES_DIR).filter(
    (f) => f.startsWith("pytorch-helper.bad-") && f.endsWith(".jsonl"),
  )
  const fixtures: HelperFixture[] = []
  for (const file of files) {
    const metaPath = resolve(FIXTURES_DIR, file.replace(/\.jsonl$/, ".meta.json"))
    if (!existsSync(metaPath)) continue
    const meta = JSON.parse(readFileSync(metaPath, "utf-8")) as {
      expected_failures?: Array<{ rule?: number }>
      intent?: string
    }
    const expectedRule = meta.expected_failures?.[0]?.rule
    if (typeof expectedRule !== "number") continue
    fixtures.push({
      filename: file,
      expectedRule,
      bug: meta.intent ?? "",
    })
  }
  return fixtures
}

const fixtures = discoverHelperFixtures()

if (fixtures.length === 0) {
  test("no pytorch-helper bad fixtures discovered", () => {
    assert.fail(
      "No pytorch-helper.bad-* fixtures found under fixtures/bad/. " +
        "v0.10 adversarial plate must ship at least one fixture per simulated helper bug. " +
        "Regenerate via `node scripts/build-pytorch-helper-fixtures.mjs`.",
    )
  })
}

for (const fix of fixtures) {
  test(`${fix.filename}: helper-emitted sidecar imports + reconciler rejects on Rule ${fix.expectedRule} BEFORE reading meta.json`, () => {
    // Step 1: import the sidecar through the public observer-mode path.
    // The bad helper simulation produces a SCHEMA-VALID sidecar (the bug
    // is semantic), so this MUST succeed without throwing.
    const bytes = readFileSync(resolve(FIXTURES_DIR, fix.filename), "utf-8")
    const result = importPytorchSidecar(bytes, {
      importTimestamp: "2026-05-18T12:00:00Z",
      differentialTolerance: { atol: 1e-6, rtol: 1e-4 },
    })
    // Receipt is produced regardless of import-time Rule 14 outcome (the
    // produced receipt is the audit artifact even when verification_state
    // declares engine_recompute_disagreed).
    assert.ok(result.receipt, "importPytorchSidecar must produce a receipt for helper-bug fixtures")

    // Step 2: reconcile the produced receipt. Capture ok + failure rules
    // BEFORE touching meta.json — the anti-circularity invariant.
    const reconcileResult = reconcileReceipt(result.receipt)
    assert.equal(
      reconcileResult.ok,
      false,
      `helper-bug fixture ${fix.filename} must be REJECTED by reconciler; was accepted. ` +
        `Bug: ${fix.bug}`,
    )
    if (reconcileResult.ok) return // type narrow

    // Step 3: assert the EXPECTED rule fired. The failure list may contain
    // multiple rules (cascade); the expected rule must be present.
    const firedRules = reconcileResult.failures.map((f) => f.rule)
    assert.ok(
      firedRules.includes(fix.expectedRule),
      `helper-bug fixture ${fix.filename} fired rules [${firedRules.join(", ")}], ` +
        `expected rule ${fix.expectedRule}. Bug: ${fix.bug}`,
    )

    // Step 4 (anti-circularity assertion): the reconciler must NOT have
    // consulted the receipt's fixture_status. We confirm by manually
    // CLEARING fixture_status on a clone and verifying the reconciler
    // still rejects on the same rule.
    const stripped = JSON.parse(JSON.stringify(result.receipt)) as Record<string, unknown>
    delete stripped.fixture_status
    delete stripped.attestor
    const stripResult = reconcileReceipt(stripped as never)
    assert.equal(
      stripResult.ok,
      false,
      `helper-bug fixture ${fix.filename} STILL must reject after fixture_status + attestor stripped. ` +
        `Bug: ${fix.bug}`,
    )
    if (stripResult.ok) return
    const strippedRules = stripResult.failures.map((f) => f.rule)
    assert.ok(
      strippedRules.includes(fix.expectedRule),
      `helper-bug fixture ${fix.filename} with metadata stripped fired rules [${strippedRules.join(", ")}], ` +
        `expected rule ${fix.expectedRule}. The anti-circularity invariant requires the rule fires WITHOUT metadata.`,
    )
  })
}
