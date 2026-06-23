/**
 * v0.6 — `bp import pytorch` end-to-end test.
 *
 * Verifies:
 *  1. Sidecar → observer-mode v0.4.0 receipt round-trip produces byte-equal
 *     output to fixtures/external/pytorch.softmax-ce.golden.jsonl.
 *  2. Resulting receipt schema-validates against receipt.v0.4.0.json.
 *  3. Resulting receipt passes Rules 0-13 + Rule 14 (engine-recompute
 *     differential) + Rules 15 + 16 (skip-basis + digest binding are
 *     no-ops when not declared).
 *  4. Importer rejects sidecars where source_framework.name !== "pytorch".
 *  5. Importer rejects sidecars whose source bytes are not valid JSON.
 *  6. Importer respects --out, --json, and emits the expected exit codes
 *     (verified via the bp CLI).
 */

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, existsSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"
import { importPytorchSidecar, importPytorchSidecarStream } from "../src/import-pytorch.js"
import { validateReceiptSchema } from "../src/validate.js"
import { reconcileReceipt } from "../src/reconcile.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, "..")
const sidecarPath = resolve(
  repoRoot,
  "fixtures/external/pytorch.softmax-ce.sidecar.jsonl",
)
const goldenPath = resolve(
  repoRoot,
  "fixtures/external/pytorch.softmax-ce.golden.jsonl",
)

const PINNED_TIMESTAMP = "2026-05-17T05:30:00Z"
const PINNED_FIXTURE_LABEL = "pytorch-softmax-ce-imported"

function loadSidecarBytes(): string {
  return readFileSync(sidecarPath, "utf-8")
}

function loadGoldenBytes(): string {
  return readFileSync(goldenPath, "utf-8")
}

test("importPytorchSidecar produces byte-equal output to shipped golden", () => {
  if (!existsSync(sidecarPath) || !existsSync(goldenPath)) {
    throw new Error(
      `v0.6 PyTorch fixtures missing. Run scripts/generate-pytorch-softmax-ce-fixtures.ts ` +
        `to regenerate sidecar + golden.`,
    )
  }
  const sidecar = loadSidecarBytes()
  const expectedBytes = loadGoldenBytes()
  const result = importPytorchSidecar(sidecar, {
    importTimestamp: PINNED_TIMESTAMP,
    fixtureLabel: PINNED_FIXTURE_LABEL,
  })
  assert.strictEqual(
    result.emittedBytes,
    expectedBytes,
    "importer emission must be byte-equal to the shipped pytorch.softmax-ce.golden.jsonl. " +
      "If this fails on a Node version bump or runtime change, regenerate the golden via " +
      "scripts/generate-pytorch-softmax-ce-fixtures.ts AND every fixtures/bad/external.*.jsonl " +
      "via scripts/generate-external-bad-fixtures.ts in the same commit.",
  )
  assert.strictEqual(
    result.differentialPassed,
    true,
    "engine-recompute differential must pass on the canonical PyTorch fixture",
  )
  assert.strictEqual(
    result.differentialDisagreements.length,
    0,
    `expected zero differential disagreements; got: ${JSON.stringify(result.differentialDisagreements)}`,
  )
})

// =============================================================================
// G-008 — importer's OWN differential must cover the SAME field set as Rule 14.
//
// Before the fix, buildObserverReceiptFromSidecar compared ONLY forward.{net,
// out} + loss.per_output[*] + loss.total. A sidecar with FORGED
// updates[*].{gradient,weight_after} + parameters_after[*] (forward + loss left
// correct) still produced differentialPassed===true / verification_state=
// 'engine_recompute_matched_within_tolerance' baked into the emitted receipt.
// It failed SAFE only because reconcileReceipt re-checks at the gate (Rule 14).
// This test pins that the IMPORTER itself now disagrees on the full field set.
// =============================================================================
test("G-008: forged updates[*].gradient/weight_after + parameters_after make the importer's differential FAIL (forward+loss left correct)", () => {
  if (!existsSync(sidecarPath)) return
  const sidecar = JSON.parse(loadSidecarBytes().trim()) as {
    updates: Array<{
      parameter_id: string
      gradient: number
      update: number
      weight_after: number
    }>
    parameters_after: Record<string, number>
    forward: Record<string, { net: number; out: number }>
    loss: { per_output: Record<string, number>; total: number }
  }

  // Sanity: the unmodified sidecar must currently pass the importer's
  // differential (guards against a vacuous test — if the canonical fixture
  // already disagreed, asserting "false below" would pass for the wrong reason).
  const clean = importPytorchSidecar(loadSidecarBytes(), {
    importTimestamp: PINNED_TIMESTAMP,
    fixtureLabel: PINNED_FIXTURE_LABEL,
  })
  assert.strictEqual(
    clean.differentialPassed,
    true,
    "precondition: canonical sidecar must pass the importer differential",
  )

  // FORGE: corrupt the FIRST update's gradient + weight_after, and the matching
  // parameters_after entry, by a delta far beyond differential_tolerance
  // (default atol=1e-6, rtol=1e-4). Leave forward + loss UNTOUCHED so the OLD
  // (forward+loss-only) differential would still report PASS.
  const target = sidecar.updates[0]!
  const pid = target.parameter_id
  target.gradient = target.gradient + 5.0
  target.weight_after = target.weight_after + 5.0
  sidecar.parameters_after[pid] = sidecar.parameters_after[pid]! + 5.0

  // forward + loss are deliberately left at their correct engine-matching values.

  const result = importPytorchSidecar(JSON.stringify(sidecar) + "\n", {
    importTimestamp: PINNED_TIMESTAMP,
    fixtureLabel: PINNED_FIXTURE_LABEL,
  })

  assert.strictEqual(
    result.differentialPassed,
    false,
    "importer's OWN differential must REJECT a forged gradient/weight_after/" +
      "parameters_after even though forward+loss are correct (G-008). It must " +
      "cover the same field set as reconciler Rule 14, not just forward+loss.",
  )
  assert.ok(
    result.differentialDisagreements.length > 0,
    `expected >0 disagreements; got ${JSON.stringify(result.differentialDisagreements)}`,
  )
  // The forged fields must be among the reported disagreements (field-path
  // coverage check — proves it is the gradient/weight_after/parameters_after
  // probes firing, not some unrelated drift).
  const paths = result.differentialDisagreements.map((d) => d.fieldPath)
  assert.ok(
    paths.some((p) => p === `updates[${pid}].gradient`),
    `expected updates[${pid}].gradient in disagreements; got ${JSON.stringify(paths)}`,
  )
  assert.ok(
    paths.some((p) => p === `updates[${pid}].weight_after`),
    `expected updates[${pid}].weight_after in disagreements; got ${JSON.stringify(paths)}`,
  )
  assert.ok(
    paths.some((p) => p === `parameters_after.${pid}`),
    `expected parameters_after.${pid} in disagreements; got ${JSON.stringify(paths)}`,
  )

  // And the receipt baked the HONEST verification_state (disagreed), not the
  // false-assurance 'matched' state.
  assert.strictEqual(
    result.receipt.fixture_status.verification_state,
    "engine_recompute_disagreed",
    "emitted receipt must carry engine_recompute_disagreed when the importer's " +
      "full-field differential finds disagreement",
  )
})

// G-008 — backward.* signals are also part of the full field set. Forge a
// hidden_error_signal's signal_value (forward+loss+updates left correct) and
// confirm the importer's differential now catches it.
test("G-008: forged backward.hidden_error_signals[*].signal_value makes the importer's differential FAIL", () => {
  if (!existsSync(sidecarPath)) return
  const sidecar = JSON.parse(loadSidecarBytes().trim()) as {
    backward: {
      hidden_error_signals: Record<
        string,
        { backpropagated_sum: number; activation_derivative: number; signal_value: number }
      >
    }
  }
  const hid = Object.keys(sidecar.backward.hidden_error_signals)[0]!
  sidecar.backward.hidden_error_signals[hid]!.signal_value =
    sidecar.backward.hidden_error_signals[hid]!.signal_value + 3.0

  const result = importPytorchSidecar(JSON.stringify(sidecar) + "\n", {
    importTimestamp: PINNED_TIMESTAMP,
    fixtureLabel: PINNED_FIXTURE_LABEL,
  })
  assert.strictEqual(
    result.differentialPassed,
    false,
    "importer differential must cover backward.hidden_error_signals[*].signal_value (G-008)",
  )
  const paths = result.differentialDisagreements.map((d) => d.fieldPath)
  assert.ok(
    paths.some((p) => p === `backward.hidden_error_signals.${hid}.signal_value`),
    `expected backward.hidden_error_signals.${hid}.signal_value in disagreements; got ${JSON.stringify(paths)}`,
  )
})

// =============================================================================
// ING-B-004 — import-time differential disagreements must carry the TWO operands
// behind each `delta`: `stored` (the receipt/sidecar-CLAIMED value) and
// `recomputed` (the engine value re-derived at import time). delta + tolerance
// alone don't let an operator tell a real tamper (large, structured divergence)
// from benign FP/Node drift — the magnitudes do. This mirrors the verify-path
// Rule-14 quartet (reconcile.ts compareScalar -> stored/recomputed/delta/
// tolerance) so the import-TIME render is self-sufficient too, not just the
// `bp verify` gate.
// =============================================================================

// Forge a sidecar that DIVERGES from the engine on updates[0].{gradient,
// weight_after} + the matching parameters_after entry (+BUMP, far beyond the
// default tolerance atol=1e-6/rtol=1e-4), leaving forward+loss correct. Same
// shape as the G-008 forge above, but here we assert the OPERAND fields, not
// just field-path coverage.
const DIVERGENCE_BUMP = 5.0
function buildForgedDivergentSidecar(): { bytes: string; pid: string } {
  const sidecar = JSON.parse(loadSidecarBytes().trim()) as {
    updates: Array<{
      parameter_id: string
      gradient: number
      update: number
      weight_after: number
    }>
    parameters_after: Record<string, number>
  }
  const target = sidecar.updates[0]!
  const pid = target.parameter_id
  target.gradient = target.gradient + DIVERGENCE_BUMP
  target.weight_after = target.weight_after + DIVERGENCE_BUMP
  sidecar.parameters_after[pid] = sidecar.parameters_after[pid]! + DIVERGENCE_BUMP
  return { bytes: JSON.stringify(sidecar) + "\n", pid }
}

test("ING-B-004: import differential disagreements carry stored (claimed) + recomputed (engine) + delta + tolerance", () => {
  if (!existsSync(sidecarPath)) return
  const { bytes, pid } = buildForgedDivergentSidecar()
  const result = importPytorchSidecar(bytes, {
    importTimestamp: PINNED_TIMESTAMP,
    fixtureLabel: PINNED_FIXTURE_LABEL,
  })
  assert.strictEqual(
    result.differentialPassed,
    false,
    "precondition: the forged sidecar must make the importer differential disagree",
  )
  assert.ok(
    result.differentialDisagreements.length > 0,
    `expected >0 disagreements; got ${JSON.stringify(result.differentialDisagreements)}`,
  )

  // Every disagreement carries the full quartet. For numeric divergences (finite
  // delta) the operands are finite and delta === |stored - recomputed| EXACTLY
  // (delta = Math.abs(engineVal - claimedVal); stored=claimedVal,
  // recomputed=engineVal — so |stored - recomputed| is the same float).
  for (const d of result.differentialDisagreements) {
    assert.strictEqual(typeof d.stored, "number", `stored must be a number on ${d.fieldPath}`)
    assert.strictEqual(
      typeof d.recomputed,
      "number",
      `recomputed must be a number on ${d.fieldPath}`,
    )
    assert.strictEqual(typeof d.delta, "number", `delta must be a number on ${d.fieldPath}`)
    assert.strictEqual(
      typeof d.appliedTolerance,
      "number",
      `appliedTolerance must be a number on ${d.fieldPath}`,
    )
    if (Number.isFinite(d.delta)) {
      assert.ok(
        Number.isFinite(d.stored) && Number.isFinite(d.recomputed),
        `numeric disagreement on ${d.fieldPath} must carry finite operands; ` +
          `stored=${d.stored} recomputed=${d.recomputed}`,
      )
      assert.strictEqual(
        d.delta,
        Math.abs(d.stored - d.recomputed),
        `delta must equal |stored - recomputed| on ${d.fieldPath}`,
      )
    }
  }

  // The forged gradient: `stored` is the FORGED claim, `recomputed` is the
  // engine's true value, and their gap is exactly the bump we injected — proving
  // the fields are wired correctly (stored=claimed, recomputed=engine; not
  // swapped, not zeroed).
  const grad = result.differentialDisagreements.find(
    (d) => d.fieldPath === `updates[${pid}].gradient`,
  )
  assert.ok(grad, `expected updates[${pid}].gradient disagreement`)
  assert.notStrictEqual(grad!.stored, grad!.recomputed, "stored and recomputed must differ")
  assert.ok(
    Math.abs(Math.abs(grad!.stored - grad!.recomputed) - DIVERGENCE_BUMP) < 1e-6,
    `|stored - recomputed| (${Math.abs(grad!.stored - grad!.recomputed)}) must equal the ` +
      `injected bump ${DIVERGENCE_BUMP}; stored=${grad!.stored} recomputed=${grad!.recomputed}`,
  )
})

test("ING-B-004: bp import pytorch - --json envelope disagreements carry stored+recomputed+delta+tolerance", () => {
  if (!existsSync(sidecarPath)) return
  const { bytes, pid } = buildForgedDivergentSidecar()
  // --json: the receipt bytes go to STDOUT; the result envelope goes to STDERR.
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "src/bin/bp.ts", "import", "pytorch", "-", "--json"],
    { cwd: repoRoot, encoding: "utf-8", input: bytes },
  )
  assert.strictEqual(
    result.status,
    1,
    `forged sidecar must exit 1 (differential disagreed). stderr: ${result.stderr}`,
  )
  const envLine = result.stderr
    .trim()
    .split("\n")
    .find((l) => l.includes('"disagreements"'))
  assert.ok(envLine, `expected a JSON result envelope on stderr; got: ${result.stderr}`)
  const env = JSON.parse(envLine!) as {
    ok: boolean
    differential: {
      passed: boolean
      disagreements: Array<Record<string, unknown>>
    }
  }
  assert.strictEqual(env.ok, false)
  assert.strictEqual(env.differential.passed, false)
  const ds = env.differential.disagreements
  assert.ok(Array.isArray(ds) && ds.length > 0, "expected a non-empty disagreements array")
  for (const d of ds) {
    for (const k of ["fieldPath", "delta", "appliedTolerance", "stored", "recomputed"]) {
      assert.ok(
        k in d,
        `each --json disagreement must carry '${k}'; got keys ${JSON.stringify(Object.keys(d))}`,
      )
    }
  }
  const grad = ds.find((d) => d.fieldPath === `updates[${pid}].gradient`)
  assert.ok(grad, `expected updates[${pid}].gradient in the --json disagreements`)
  assert.strictEqual(typeof grad!.stored, "number", "stored must serialize as a number")
  assert.strictEqual(typeof grad!.recomputed, "number", "recomputed must serialize as a number")
  assert.notStrictEqual(grad!.stored, grad!.recomputed, "stored and recomputed must differ")
})

// =============================================================================
// imports-B-001 — single-step unsupported-format-version guard (Stage C
// humanization). The MULTI-step path has an explicit format-const allowlist
// (rejects out-of-set versions with a clear "requires framework-trace.v0.2.0..."
// diagnostic); the SINGLE-step path had none. Two concrete holes proven against
// the live importer before this fix:
//   (A) a recognized-but-out-of-single-step-scope format const on a v0.1.0-
//       shaped body (e.g. format="framework-trace.v0.5.0" with NO optimizer
//       block) was SILENTLY ACCEPTED and emitted a downgraded schema_version
//       "0.4.0" receipt — active silent acceptance of a mislabeled sidecar.
//   (B) an unknown/future format const was rejected, but with a CONFUSING
//       message ("failed framework-trace.v0.1.0 validation: /format: must be
//       equal to constant") that reads like an internal v0.1.0 schema bug, not
//       a version-support problem.
// The fix adds a single-step format-const allowlist
// {v0.1.0,v0.3.0,v0.4.0,v0.5.0,v0.6.0,v0.7.0} mirroring the multi-step guard,
// emitting a clear "unsupported sidecar format version X (supported: ...)"
// structured failure. v0.2.0 is the multi-step baseline → routed to the
// multi-step subcommand. MUTATION that re-REDs: delete the allowlist guard
// block in src/import-observer.ts (buildObserverReceiptFromSidecar).
// =============================================================================
test("imports-B-001: a recognized-but-wrong format const (v0.5.0) on a v0.1.0-shaped body is REJECTED with an unsupported/multi-step diagnostic (was silently accepted)", () => {
  if (!existsSync(sidecarPath)) return
  const sidecar = JSON.parse(loadSidecarBytes().trim()) as Record<string, unknown>
  // Precondition (non-vacuity): canonical sidecar with its real format passes.
  assert.strictEqual(
    sidecar.format,
    "framework-trace.v0.1.0",
    "precondition: canonical pytorch sidecar declares framework-trace.v0.1.0 and carries NO optimizer block",
  )
  assert.strictEqual(
    (sidecar as { optimizer?: unknown }).optimizer,
    undefined,
    "precondition: canonical pytorch sidecar has no optimizer block (so v0.5.0 is a pure mislabel)",
  )
  // FORGE: relabel as v0.5.0 (sgd_momentum) while the body stays v0.1.0 SGD.
  sidecar.format = "framework-trace.v0.5.0"
  assert.throws(
    () => importPytorchSidecar(JSON.stringify(sidecar) + "\n", { importTimestamp: PINNED_TIMESTAMP }),
    /unsupported sidecar format version|framework-trace\.v0\.5\.0/,
    "single-step importer must REJECT a mislabeled v0.5.0 sidecar instead of silently accepting it (imports-B-001)",
  )
})

test("imports-B-001: a v0.2.0 (multi-step) sidecar is REJECTED single-step with a pointer at the multi-step subcommand", () => {
  if (!existsSync(sidecarPath)) return
  const sidecar = JSON.parse(loadSidecarBytes().trim()) as Record<string, unknown>
  sidecar.format = "framework-trace.v0.2.0"
  assert.throws(
    () => importPytorchSidecar(JSON.stringify(sidecar) + "\n", { importTimestamp: PINNED_TIMESTAMP }),
    /multi-step|import .*multi|Stream/i,
    "single-step importer must point a v0.2.0 (multi-step) sidecar at the multi-step subcommand (imports-B-001)",
  )
})

test("imports-B-001: an unknown future format const yields a clear supported-set diagnostic, not the confusing raw v0.1.0 const-mismatch", () => {
  if (!existsSync(sidecarPath)) return
  const sidecar = JSON.parse(loadSidecarBytes().trim()) as Record<string, unknown>
  sidecar.format = "framework-trace.v9.9.9"
  let caught: Error | undefined
  try {
    importPytorchSidecar(JSON.stringify(sidecar) + "\n", { importTimestamp: PINNED_TIMESTAMP })
  } catch (err) {
    caught = err as Error
  }
  assert.ok(caught, "must reject an unknown future format const")
  assert.match(
    caught!.message,
    /unsupported sidecar format version/,
    "message must name the version-support problem (imports-B-001 humanization)",
  )
  assert.doesNotMatch(
    caught!.message,
    /must be equal to constant/,
    "message must NOT leak the raw Ajv v0.1.0 const-mismatch error (that was the confusing pre-fix behavior)",
  )
})

// =============================================================================
// imports-B-004 — multi-step ingestion is all-or-nothing across the stream, but
// a per-record FAILURE must name WHICH record failed (Stage C humanization). The
// validation/homogeneity aborts already name `line N`; the gap was the per-record
// ENGINE-RECOMPUTE call (runGeneralStep / runBatchedGeneralStep), whose throw
// propagated WITHOUT record context — so an operator with a 50-record bundle got
// "input.parameters_before is missing required parameter 'w_x1_h1'" and no idea
// which step it came from. The fix wraps the per-record engine recompute and
// re-throws with "record N (step_index S)" context (still aborting — preserves
// all-or-nothing soundness — but now diagnosable). MUTATION that re-REDs: remove
// the try/catch record-context wrapper around the engine recompute in
// buildObserverReceiptStreamFromSidecar.
//
// Exercised through importPytorchSidecarStream (owned via import-pytorch). The
// natural home for broader multi-step coverage is import-pytorch-multi-step.test.ts
// (NOT owned by this domain agent); this focused regression lock lives here.
// =============================================================================
const multiStepSidecarPath = resolve(
  repoRoot,
  "fixtures/external/pytorch.softmax-ce.multi-step.sidecar.jsonl",
)

test("imports-B-004: a per-record engine-recompute failure in the MIDDLE record names which record failed (record index + step_index)", () => {
  if (!existsSync(multiStepSidecarPath)) return
  const lines = readFileSync(multiStepSidecarPath, "utf-8").trim().split("\n")
  assert.ok(lines.length >= 3, "multi-step fixture must have >=3 records for a middle-record test")

  // Precondition (non-vacuity): the clean stream imports without throwing.
  const cleanResult = importPytorchSidecarStream(readFileSync(multiStepSidecarPath, "utf-8"), {
    importTimestamp: PINNED_TIMESTAMP,
    fixtureLabel: PINNED_FIXTURE_LABEL,
  })
  assert.strictEqual(cleanResult.steps.length, lines.length, "precondition: clean stream imports all records")

  // FORGE: delete a parameters_before entry from the MIDDLE record (index 1).
  // This passes schema validation (parameters_before has no required keys at the
  // schema level) but makes runGeneralStep throw at engine-recompute time —
  // exactly the class of failure that previously lacked record context.
  const recs = lines.map((l) => JSON.parse(l) as { parameters_before: Record<string, number> })
  const victimKey = Object.keys(recs[1]!.parameters_before)[0]!
  delete recs[1]!.parameters_before[victimKey]
  const forged = recs.map((r) => JSON.stringify(r)).join("\n") + "\n"

  let caught: Error | undefined
  try {
    importPytorchSidecarStream(forged, { importTimestamp: PINNED_TIMESTAMP, fixtureLabel: PINNED_FIXTURE_LABEL })
  } catch (err) {
    caught = err as Error
  }
  assert.ok(caught, "a record whose engine recompute throws must abort the import")
  // The humanized message must name the offending record (index 2 = 1-based line 2 / step_index 1).
  assert.match(
    caught!.message,
    /record 2|step_index 1|line 2/,
    `multi-step per-record engine failure must name WHICH record failed (imports-B-004); got: ${caught!.message}`,
  )
  // And it must still surface the underlying engine cause (the missing param),
  // so the operator gets both "which record" AND "what went wrong".
  assert.match(
    caught!.message,
    new RegExp(victimKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    `message must preserve the underlying engine cause (missing '${victimKey}'); got: ${caught!.message}`,
  )
})

// =============================================================================
// imports-B-002 — extractorIdentity is split into {name, version} for the
// receipt's source_framework.extractor sub-block. The OLD code used
// `identity.split("@")` and took parts[0]/parts[1], which silently DROPPED data
// for any identity with more than one `@` — most importantly an npm-scoped name
// like "@my-scope/tool@1.2.3": split("@") → ["", "my-scope/tool", "1.2.3"], so
// name became "" and version became "my-scope/tool" (the real "1.2.3" tail
// discarded). The fix splits on the LAST `@` so the version is the final segment
// and the name keeps the leading/embedded `@`. Observability-only (the extractor
// sub-block is forensic attribution; Rule 14 is the authority) — but a corrupted
// attribution string is a real "good to use" defect. Byte-equal for every
// single-`@` identity (proven by the golden byte-equality test above + the
// default-identity assertion here). MUTATION that re-REDs: revert
// splitExtractorIdentity to `const p = identity.split("@"); return {name: p[0],
// version: p[1]}` in src/import-observer.ts.
// =============================================================================
test("imports-B-002: a scoped multi-'@' extractorIdentity splits on the LAST '@' (no silent data loss)", () => {
  if (!existsSync(sidecarPath)) return

  // Non-vacuity floor: the DEFAULT single-'@' identity still splits correctly,
  // so this test is exercising real splitting behavior, not a no-op.
  const defaultResult = importPytorchSidecar(loadSidecarBytes(), {
    importTimestamp: PINNED_TIMESTAMP,
    fixtureLabel: PINNED_FIXTURE_LABEL,
  })
  assert.strictEqual(
    defaultResult.receipt.source_framework?.extractor?.name,
    "bp-import-pytorch",
    "precondition: default single-'@' identity yields name='bp-import-pytorch'",
  )
  assert.strictEqual(
    defaultResult.receipt.source_framework?.extractor?.version,
    "0.6.0",
    "precondition: default single-'@' identity yields version='0.6.0'",
  )

  // FORGE the override: an npm-scoped name with a version → TWO '@' characters.
  const scoped = importPytorchSidecar(loadSidecarBytes(), {
    importTimestamp: PINNED_TIMESTAMP,
    fixtureLabel: PINNED_FIXTURE_LABEL,
    extractorIdentity: "@my-scope/tool@1.2.3",
  })
  const ex = scoped.receipt.source_framework?.extractor
  assert.strictEqual(
    ex?.name,
    "@my-scope/tool",
    "scoped name must be preserved in full (the old split('@') made this '' — data loss)",
  )
  assert.strictEqual(
    ex?.version,
    "1.2.3",
    "version must be the segment after the LAST '@' (the old split('@') made this 'my-scope/tool' — wrong)",
  )

  // A no-'@' identity degrades to version 'unversioned' (unchanged contract).
  const noAt = importPytorchSidecar(loadSidecarBytes(), {
    importTimestamp: PINNED_TIMESTAMP,
    fixtureLabel: PINNED_FIXTURE_LABEL,
    extractorIdentity: "bare-identity-no-at",
  })
  assert.strictEqual(noAt.receipt.source_framework?.extractor?.name, "bare-identity-no-at")
  assert.strictEqual(noAt.receipt.source_framework?.extractor?.version, "unversioned")
})

test("imported v0.4.0 receipt schema-validates", () => {
  if (!existsSync(goldenPath)) return
  const r = JSON.parse(loadGoldenBytes().trim())
  const v = validateReceiptSchema(r)
  assert.strictEqual(v.ok, true, `golden must schema-validate; errors: ${v.ok ? "[]" : JSON.stringify(v.errors)}`)
  assert.strictEqual(v.schemaVersion, "0.4.0", "must dispatch to v0.4.0 schema")
})

test("imported v0.4.0 receipt reconciles cleanly (Rules 1-13 + Rule 14 differential pass)", () => {
  if (!existsSync(goldenPath)) return
  const r = JSON.parse(loadGoldenBytes().trim())
  const result = reconcileReceipt(r)
  assert.strictEqual(
    result.ok,
    true,
    `imported PyTorch golden must reconcile cleanly; got failures: ${JSON.stringify(
      result.ok === false ? result.failures.map((f) => ({ rule: f.rule, field_path: f.field_path, message: f.message })) : "ok",
    )}`,
  )
})

test("imported receipt carries source_framework + attestor + external_imported fixture_status", () => {
  if (!existsSync(goldenPath)) return
  const r = JSON.parse(loadGoldenBytes().trim()) as {
    schema_version: string
    fixture_status: { authoring_state: string; verification_state: string }
    source_framework?: { name: string; version: string }
    attestor?: { computed_by?: { kind?: string }; verified_by?: { kind?: string } }
  }
  assert.strictEqual(r.schema_version, "0.4.0")
  assert.strictEqual(r.fixture_status.authoring_state, "external_imported")
  assert.strictEqual(
    r.fixture_status.verification_state,
    "engine_recompute_matched_within_tolerance",
  )
  assert.ok(r.source_framework, "source_framework block must be present")
  assert.strictEqual(r.source_framework!.name, "pytorch")
  assert.ok(r.attestor, "attestor block must be present")
  assert.strictEqual(r.attestor!.computed_by?.kind, "framework")
  assert.strictEqual(r.attestor!.verified_by?.kind, "engine")
})

test("importer rejects sidecars whose source_framework.name !== 'pytorch'", () => {
  if (!existsSync(sidecarPath)) return
  const sidecar = JSON.parse(loadSidecarBytes().trim()) as {
    source_framework: { name: string }
  }
  sidecar.source_framework.name = "jax"
  assert.throws(
    () => importPytorchSidecar(JSON.stringify(sidecar) + "\n", { importTimestamp: PINNED_TIMESTAMP }),
    /importPytorchSidecar accepts only 'pytorch'/,
    "must reject non-pytorch sidecars (per-framework subcommand discipline)",
  )
})

test("importer rejects bytes that are not valid JSON", () => {
  assert.throws(
    () => importPytorchSidecar("{this is not json\n", { importTimestamp: PINNED_TIMESTAMP }),
    /not valid JSON/,
    "must reject malformed JSON input",
  )
})

test("importer rejects sidecars missing required topology field", () => {
  if (!existsSync(sidecarPath)) return
  const sidecar = JSON.parse(loadSidecarBytes().trim()) as { topology?: unknown }
  delete sidecar.topology
  assert.throws(
    () => importPytorchSidecar(JSON.stringify(sidecar) + "\n", { importTimestamp: PINNED_TIMESTAMP }),
    /framework-trace.+validation/,
    "must reject sidecars missing required schema fields",
  )
})

// =============================================================================
// CLI-level end-to-end (spawns bp subprocess)
// =============================================================================

function runBp(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "src/bin/bp.ts", ...args],
    { cwd: repoRoot, encoding: "utf-8" },
  )
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

test("bp import pytorch <sidecar> writes receipt to stdout and exits 0", () => {
  if (!existsSync(sidecarPath)) return
  const { status, stdout } = runBp([
    "import",
    "pytorch",
    "fixtures/external/pytorch.softmax-ce.sidecar.jsonl",
  ])
  assert.strictEqual(status, 0, "bp import pytorch on the canonical sidecar must exit 0")
  // The CLI's import_timestamp will differ from the pinned-fixture timestamp
  // (it uses the current time when --import-timestamp is not exposed yet).
  // So we don't byte-compare; we just confirm it parses and has the expected
  // shape.
  const parsed = JSON.parse(stdout.trim())
  assert.strictEqual(parsed.schema_version, "0.4.0")
  assert.strictEqual(parsed.fixture_status.authoring_state, "external_imported")
  assert.strictEqual(
    parsed.fixture_status.verification_state,
    "engine_recompute_matched_within_tolerance",
  )
})

test("bp import pytorch --help exits 0 with usage text", () => {
  const { status, stdout } = runBp(["import", "pytorch", "--help"])
  assert.strictEqual(status, 0)
  assert.match(stdout, /bp import pytorch/)
  assert.match(stdout, /framework-trace\.v0\.1\.0/)
})

test("bp import (no framework arg) exits 2 with --help text", () => {
  const { status, stdout, stderr } = runBp(["import"])
  assert.strictEqual(status, 2)
  const combined = stdout + stderr
  assert.match(combined, /Usage: bp import/)
})

// v0.7.0 SHIPPED TensorFlow — the previously-stub `bp import tensorflow`
// is now wired (see test/import-tensorflow.test.ts). All three v0.6
// framework slots (pytorch / jax / tensorflow) have real adapters now.
// Exit code 4 (FRAMEWORK_NOT_IMPLEMENTED) is RESERVED for future
// adapters that may be partially declared before full implementation;
// no current path returns it.

test("bp import unknown-framework exits 2", () => {
  const { status, stderr } = runBp(["import", "tensorflow-lite", "/tmp/nonexistent"])
  assert.strictEqual(status, 2)
  assert.match(stderr, /unknown framework/)
})

// =============================================================================
// FIX-3b — DEFAULT_NUMERIC_POLICY_FOR_OBSERVER must be the FLOAT32-grade
// tolerance {atol:1e-6, rtol:1e-4}, NOT the old float64-grade {atol:1e-11,
// rtol:1e-7}.
//
// THE BUG (false-FAIL): the live PyTorch helper (scripts/extract/pytorch.py)
// emits a sidecar that OMITS numeric_policy, so the importer falls back to
// DEFAULT_NUMERIC_POLICY_FOR_OBSERVER. A real DEFAULT-float32 PyTorch step
// drifts ~1e-8..2.3e-5 from the engine's float64 recompute. The old default
// {1e-11,1e-7} is FLOAT64-grade — far tighter than float32 drift — so the
// emitted observer receipt failed Rule 5/6/7 internal-consistency at the gate
// and a VALID imported step was REJECTED. The float32-appropriate default
// {1e-6,1e-4} (one order under the OBSERVER_NUMERIC_TOLERANCE_CEILING {1e-5,
// 1e-3} the reconciler clamps observer receipts to) lets the honest step pass
// while staying inside the verifier ceiling. Rule 14 (engine-recompute
// differential) remains the real authority on every external_imported receipt.
//
// NON-VACUITY: the canonical softmax-ce sidecar carries an explicit
// numeric_policy block; we STRIP it so the default path is exercised. The
// assertion is the exact float32-grade pair. MUTATION that makes it RED:
// revert DEFAULT_NUMERIC_POLICY_FOR_OBSERVER.tolerance to {atol:1e-11,
// rtol:1e-7} (or any non-{1e-6,1e-4} value) in src/import-observer.ts.
// =============================================================================
test("FIX-3b: a sidecar that OMITS numeric_policy gets the float32-grade observer default {atol:1e-6,rtol:1e-4}", () => {
  if (!existsSync(sidecarPath)) return
  const sidecar = JSON.parse(loadSidecarBytes().trim()) as Record<string, unknown>
  // Sanity: the canonical sidecar carries numeric_policy — strip it so the
  // importer falls through to DEFAULT_NUMERIC_POLICY_FOR_OBSERVER.
  assert.ok(
    sidecar.numeric_policy !== undefined,
    "precondition: canonical sidecar carries numeric_policy (we strip it to exercise the default)",
  )
  delete sidecar.numeric_policy

  const result = importPytorchSidecar(JSON.stringify(sidecar) + "\n", {
    importTimestamp: PINNED_TIMESTAMP,
    fixtureLabel: PINNED_FIXTURE_LABEL,
  })

  assert.deepStrictEqual(
    result.receipt.numeric_policy.tolerance,
    { atol: 1e-6, rtol: 1e-4 },
    "importer must emit the FLOAT32-grade observer default {atol:1e-6,rtol:1e-4} when the " +
      "sidecar omits numeric_policy (FIX-3b). The old float64-grade {1e-11,1e-7} rejected real " +
      "float32 PyTorch steps at Rule 5/6/7 internal-consistency — a false FAIL.",
  )
})

test("FIX-3b: an observer receipt emitted with the default float32 tolerance reconciles ok (internal consistency holds at the observer ceiling)", () => {
  if (!existsSync(sidecarPath)) return
  const sidecar = JSON.parse(loadSidecarBytes().trim()) as Record<string, unknown>
  delete sidecar.numeric_policy

  const result = importPytorchSidecar(JSON.stringify(sidecar) + "\n", {
    importTimestamp: PINNED_TIMESTAMP,
    fixtureLabel: PINNED_FIXTURE_LABEL,
  })
  // The emitted receipt declares the float32-grade default; the reconciler's
  // authoring-aware clamp (observer ceiling {1e-5,1e-3}) must accept it and the
  // canonical softmax-ce math (float64-authored, drift well under the bound)
  // reconciles cleanly. This is the end-to-end "valid step no longer rejected"
  // assertion at the unit level (the live-torch case is in the seam validation).
  const rec = reconcileReceipt(result.receipt)
  assert.strictEqual(
    rec.ok,
    true,
    `observer receipt with float32-grade default tolerance must reconcile ok; got: ${
      rec.ok === false
        ? JSON.stringify(rec.failures.map((f) => ({ rule: f.rule, field_path: f.field_path, delta: f.delta, tolerance: f.tolerance })))
        : "ok"
    }`,
  )
})
