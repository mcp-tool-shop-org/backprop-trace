/**
 * Rule 9 (multi-step parameter chain) + Rule 10 (trace identity) tests on
 * `reconcileMultiStep`.
 *
 * Constructs multi-step sequences programmatically rather than depending
 * on a multi-step JSONL fixture (those land via the Fixtures agent later
 * in v0.3.x). Each test starts from a fresh runGeneralStep(XOR_INPUT)
 * receipt, deep-clones, mutates the chain-relevant fields, and asserts
 * the expected failure shape surfaces.
 *
 * Cases:
 *   - Single-step sequence (length 1) — no cross-rules fire, returns ok.
 *   - Two valid sequential steps — Rules 1-8 pass per record, Rule 9
 *     chain holds, Rule 10 trace_id + step_index match. Overall ok.
 *   - Step 1's parameters_before mutated — Rule 9 fires for the mutated
 *     parameter, naming the parameter_id.
 *   - Step 1's trace_id mutated — Rule 10 fires with a "Trace ID mismatch"
 *     diagnostic.
 *   - Skip step_index 1 (steps 0 then 2) — Rule 10 fires for the gap.
 *   - Receipts without trace_id — Rule 10 is exempt (single-step legacy);
 *     the only failures that could surface are per-record Rules 1-8
 *     (mutation here is parameters_before to also break Rule 9 — but Rule
 *     9 ALWAYS fires when adjacent step parameters disagree, regardless
 *     of trace_id; we make this case clean so the test isolates Rule 10
 *     skip-behavior).
 *
 * The construction strategy: chain a step-1 receipt by setting
 * step-1's `parameters_before` to step-0's `parameters_after` (so Rule 9
 * holds by construction), then mutating ONE field at a time to drive
 * each negative case.
 */

import { test } from "node:test"
import assert from "node:assert/strict"
import { reconcileMultiStep } from "../src/reconcile.js"
import { runGeneralStep, type GeneralReceipt } from "../src/general-engine.js"
import { XOR_INPUT } from "../src/mazur.js"

const TRACE_ID = "trace-multi-step-test-fixture-00000000000000000000000000000000"

/**
 * Build a base XOR receipt with a stable trace_id + step_index, then a
 * synthetic step-1 by carrying parameters_after forward into step-1's
 * parameters_before. The step-1 receipt is NOT recomputed (we don't run
 * the engine a second time — instead we clone step-0 and rebrand the
 * step-1 fields). This keeps the test deterministic and avoids depending
 * on multi-step engine support that doesn't yet exist; Rule 9 only checks
 * the parameter-chain identity, not that step-1's math is fresh.
 */
function buildTwoStepChain(): { step0: GeneralReceipt; step1: GeneralReceipt } {
  const step0 = runGeneralStep({
    ...XOR_INPUT,
    trace_id: TRACE_ID,
    step_index: 0,
  })

  // Build step 1 as a clone of step 0, then re-key step_index and set
  // parameters_before to step 0's parameters_after. The per-record
  // Rules 1-8 are intentionally allowed to fail on step 1 — that's
  // outside this file's coverage scope (multi-step engine + fresh-math
  // step-1 receipts land via Fixtures agent later). reconcileMultiStep
  // accumulates ALL failures; we filter for Rule 9 / Rule 10 specifically.
  const step1: GeneralReceipt = structuredClone(step0)
  step1.step_index = 1
  // Make parameters_before match step 0's parameters_after — this is the
  // Rule 9 chain identity. Without this overwrite, the clone leaves
  // step1.parameters_before == step0.parameters_before, which is what
  // would happen in a clean re-run AND is exactly the "no progress"
  // chain that Rule 9 might still accept if step0.parameters_after also
  // matched (when all weights' gradients are zero — not our case).
  step1.parameters_before = { ...step0.parameters_after }

  return { step0, step1 }
}

/**
 * Filter reconciliation failures to a specific rule number — keeps tests
 * targeted on the chain rules (9, 10) while ignoring per-record Rules 1-8
 * that may surface on the synthetic step-1 receipt.
 */
function failuresFor(
  result: ReturnType<typeof reconcileMultiStep>,
  rule: number,
): Array<{ rule: number; message?: string; parameter_id?: string; field_path: string }> {
  if (result.ok) return []
  return result.failures.filter((f) => f.rule === rule)
}

test("reconcileMultiStep([single step]) — no cross-rules fire", () => {
  const { step0 } = buildTwoStepChain()
  const result = reconcileMultiStep([step0])
  // Rule 9 cannot fire (no prior step); Rule 10 is satisfied (single
  // receipt with trace_id + step_index 0). The per-record Rules 1-8 must
  // pass on the canonical XOR step-0 receipt.
  if (!result.ok) {
    const r9 = failuresFor(result, 9)
    const r10 = failuresFor(result, 10)
    assert.strictEqual(r9.length, 0, `Rule 9 unexpectedly fired on single-step: ${JSON.stringify(r9)}`)
    assert.strictEqual(r10.length, 0, `Rule 10 unexpectedly fired on single-step: ${JSON.stringify(r10)}`)
  }
})

test("reconcileMultiStep([step0, step1]) — Rules 9 and 10 pass on a valid chain", () => {
  const { step0, step1 } = buildTwoStepChain()
  const result = reconcileMultiStep([step0, step1])
  const r9 = failuresFor(result, 9)
  const r10 = failuresFor(result, 10)
  assert.strictEqual(
    r9.length,
    0,
    `Rule 9 (chain) must pass on parameters_before == prior parameters_after; got: ${JSON.stringify(r9)}`,
  )
  assert.strictEqual(
    r10.length,
    0,
    `Rule 10 (trace identity) must pass when trace_id matches and step_index sequences 0..1; got: ${JSON.stringify(r10)}`,
  )
})

test("reconcileMultiStep — mutating step 1's parameters_before triggers Rule 9 on that parameter", () => {
  const { step0, step1 } = buildTwoStepChain()
  // Pick a weight that DOES change between step 0's before and after
  // so the mutation is a clean Rule 9 break.
  const targetParam = "w_x1_h1"
  step1.parameters_before[targetParam] = step0.parameters_after[targetParam]! + 0.5

  const result = reconcileMultiStep([step0, step1])
  const r9 = failuresFor(result, 9)
  assert.ok(r9.length >= 1, `Rule 9 must fire on chain mutation; got 0 failures`)
  const f = r9.find((x) => x.parameter_id === targetParam)
  assert.ok(
    f !== undefined,
    `Rule 9 failure must name parameter_id='${targetParam}'; got: ${JSON.stringify(r9)}`,
  )
})

test("reconcileMultiStep — mutating step 1's trace_id triggers Rule 10 (trace mismatch)", () => {
  const { step0, step1 } = buildTwoStepChain()
  step1.trace_id = "trace-different-from-step-0-deadbeefdeadbeefdeadbeefdeadbeef"

  const result = reconcileMultiStep([step0, step1])
  const r10 = failuresFor(result, 10)
  // Rule 10 should fire at receipts[1] for the trace_id mismatch.
  const traceMismatch = r10.find((f) => /trace[_ ]id|Trace ID/i.test(f.message ?? ""))
  assert.ok(
    traceMismatch !== undefined,
    `Rule 10 must surface a trace_id-mismatch diagnostic; got: ${JSON.stringify(r10)}`,
  )
})

test("reconcileMultiStep — skipping step_index 1 (steps [0, 2]) triggers Rule 10 for the gap", () => {
  const { step0, step1 } = buildTwoStepChain()
  step1.step_index = 2 // gap: expected 1, got 2

  const result = reconcileMultiStep([step0, step1])
  const r10 = failuresFor(result, 10)
  const gap = r10.find((f) => /step_index|gap|reorder/i.test(f.message ?? ""))
  assert.ok(
    gap !== undefined,
    `Rule 10 must surface a step_index-gap diagnostic; got: ${JSON.stringify(r10)}`,
  )
})

test("reconcileMultiStep — receipts without trace_id skip Rule 10 entirely (single-step legacy exemption)", () => {
  const { step0, step1 } = buildTwoStepChain()
  // Strip trace_id from BOTH receipts so the sequence falls into the
  // single-step-legacy exemption per checkRule10's contract.
  delete step0.trace_id
  delete step1.trace_id
  // Also strip step_index so Rule 10 has no expected-0 sequencing claim
  // to enforce; a step-index-present-without-trace receipt is a
  // half-state we don't construct here (Fixtures agent will surface
  // those cases in dedicated bad fixtures).
  delete step0.step_index
  delete step1.step_index

  const result = reconcileMultiStep([step0, step1])
  const r10 = failuresFor(result, 10)
  assert.strictEqual(
    r10.length,
    0,
    `Rule 10 must be exempt when first receipt has no trace_id; got: ${JSON.stringify(r10)}`,
  )
})

// =============================================================================
// FIX-4: the verifier-owned tolerance clamp is enforced at the MULTI-STEP Rule 9
// site, not only inside single-record reconcileReceipt.
//
// THREAT: Rule 9 (parameters_before[i] == parameters_after[i-1]) reads the
// CURRENT receipt's numeric_policy.tolerance to gate the chain check. If that
// raw, receipt-supplied tolerance were honored, a chain-break could be laundered
// by declaring a loose tolerance — the same anti-circularity hole the numeric
// ceiling closes for single records, but at the cross-record site. reconcileMultiStep
// must clamp the per-record tolerance to NUMERIC_TOLERANCE_CEILING before it
// gates Rule 9.
//
// This test plants a chain-break of RELATIVE ~1e-4 (well above the numeric
// ceiling's rtol 1e-6) and sets each record's tolerance LOOSE ({atol:1e-3,
// rtol:1e-2}, above the ceiling). The clamp brings the effective tolerance down
// to {atol:1e-8, rtol:1e-6}, so Rule 9 fires.
//
// MUTATION THAT MAKES THIS RED: in reconcileMultiStep, pass the raw `curPolicy`
// to checkRule9 instead of the clamped `curPolicyEffective`. Then the loose
// {atol:1e-3, rtol:1e-2} tolerance is honored at the Rule 9 site, its applied
// tolerance (~1e-3 on an O(0.1) parameter) SWALLOWS the ~1e-4 chain-break, and
// no Rule 9 failure is produced (the laundered PASS this clamp prevents).
//
// (Phase 1's per-record reconcileReceipt will ALSO reject each record with a
// Rule 0 tolerance-ceiling failure because the declared tolerance exceeds the
// ceiling — that is expected and orthogonal; this test isolates Rule 9.)
test("FIX-4: reconcileMultiStep clamps a loose per-record tolerance so a ~1e-4 chain-break still fires Rule 9", () => {
  const { step0, step1 } = buildTwoStepChain()

  // Plant a chain-break: step 1's parameters_before for an O(0.1)-magnitude
  // parameter disagrees with step 0's parameters_after by relative ~1e-4
  // (absolute ~3.2e-5), which is FAR above the ceiling's clamped applied
  // tolerance (~3.2e-7) but BELOW a loose receipt-declared tolerance (~1e-3).
  const targetParam = "w_h1_y"
  const honest = step0.parameters_after[targetParam]!
  step1.parameters_before[targetParam] = honest * (1 + 1e-4)

  // Declare a LOOSE tolerance on every record (above the verifier ceiling).
  // Without the clamp at the Rule 9 site this would swallow the chain-break.
  const looseTolerance = { atol: 1e-3, rtol: 1e-2 }
  step0.numeric_policy.tolerance = looseTolerance as unknown as typeof step0.numeric_policy.tolerance
  step1.numeric_policy.tolerance = looseTolerance as unknown as typeof step1.numeric_policy.tolerance

  const result = reconcileMultiStep([step0, step1])
  const r9 = failuresFor(result, 9)
  assert.ok(
    r9.length >= 1,
    `Rule 9 must fire on the ~1e-4 chain-break — the multi-step site must CLAMP the loose ` +
      `receipt-declared tolerance ({atol:1e-3,rtol:1e-2}) down to the verifier ceiling so the ` +
      `chain-break is not laundered. got 0 Rule 9 failures; all rules: ${
        result.ok ? "[] (ok:true — FALSE PASS!)" : [...new Set(result.failures.map((f) => f.rule))].sort((a, b) => a - b).join(",")
      }`,
  )
  const f = r9.find((x) => x.parameter_id === targetParam)
  assert.ok(
    f !== undefined,
    `Rule 9 failure must name parameter_id='${targetParam}'; got: ${JSON.stringify(r9)}`,
  )
  // The applied tolerance on the failure must reflect the CLAMP (≈ ceiling),
  // not the loose receipt-declared value — proving the clamp, not just that
  // some failure fired. (failuresFor narrows away the numeric quartet fields;
  // read `tolerance` through a local cast.)
  const appliedTolerance = (f as unknown as { tolerance?: number }).tolerance
  assert.ok(
    typeof appliedTolerance === "number" && appliedTolerance < 1e-5,
    `Rule 9's applied tolerance must reflect the clamped ceiling (≈ rtol 1e-6 * magnitude ≈ 3e-7), ` +
      `not the loose declared rtol 1e-2 (which would apply ≈ 1e-3); got tolerance=${appliedTolerance}`,
  )
})

// =============================================================================
// FIX-1 (CROSS-WAVE SEAM): reconcileMultiStep must AGGREGATE the per-record
// math-gate-skip signal — it cannot DROP it.
//
// reconcileMultiStep calls reconcileReceipt(r) per record but (pre-fix) copies
// ONLY result.ok / result.failures into its own output. It DROPS
// result.math_gate_skipped / result.skipped_rules. So a multi-step OBSERVER
// bundle whose foreign math is fabricated launders to ok:true by self-declaring
// ONE record's verification_state='engine_recompute_skipped_with_basis': the
// single-receipt path correctly flags that record as math_gate_skipped (Rule 14,
// the only math gate on imported math, was skipped) and a CLI reading
// reconcileReceipt would qualify the PASS — but the MULTI-STEP path discards the
// flag, so the CLI sees a clean ok:true with no skip qualification. That is a
// false assurance: a fabricated-then-skip record looks fully verified at the
// bundle level.
//
// THE FIX: aggregate per-record math_gate_skipped into reconcileMultiStep's
// return. If ANY record was math-gate-skipped, the bundle result carries
// math_gate_skipped:true + skipped_rules + which record(s) skipped. ok semantics
// are unchanged; the skip is now VISIBLE at the bundle level (the cli agent
// reads it).
//
// MUTATION THAT MAKES THIS RED: in reconcileMultiStep, stop threading the
// per-record reconcileReceipt result.math_gate_skipped into the aggregate (revert
// to copying only ok/failures). Then the bundle result's math_gate_skipped is
// undefined and this test goes RED — the laundered "fully-verified" PASS this fix
// closes.
// =============================================================================

import { readFileSync, existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"

const __msDir = dirname(fileURLToPath(import.meta.url))
const __msRepoRoot = resolve(__msDir, "..")

type MultiStepResult = ReturnType<typeof reconcileMultiStep> & {
  math_gate_skipped?: boolean
  skipped_rules?: number[]
  math_gate_skipped_records?: number[]
}

test("FIX-1: a 2-record observer bundle whose fabricated record self-declares the skip surfaces math_gate_skipped:true at the BUNDLE level", () => {
  const bundlePath = resolve(
    __msRepoRoot,
    "fixtures/external/pytorch.softmax-ce.multi-step.golden.jsonl",
  )
  if (!existsSync(bundlePath)) return
  const records = readFileSync(bundlePath, "utf-8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l))
  if (records.length < 2) return

  // Take the first two records; strip bundle_root_digest so Rule 17 (trace-bundle
  // binding) is silent — it is an orthogonal integrity gate and would otherwise
  // fire on a 2-of-3 slice / mutated bytes, masking the skip-propagation seam we
  // are isolating here.
  const stripBundle = (rec: { attestor?: { bundle_root_digest?: unknown } }) => {
    if (rec.attestor) delete rec.attestor.bundle_root_digest
    return rec
  }
  const r0 = stripBundle(JSON.parse(JSON.stringify(records[0]))) as Record<string, unknown>
  const r1 = stripBundle(JSON.parse(JSON.stringify(records[1]))) as {
    fixture_status: { verification_state?: string }
    attestor: { skip_basis?: string }
    forward: Record<string, { net?: number; out?: number }>
  }

  // Sanity: the unmodified 2-record bundle reconciles cleanly with NO skip flag.
  const clean = reconcileMultiStep([
    JSON.parse(JSON.stringify(r0)),
    JSON.parse(JSON.stringify(r1)),
  ]) as MultiStepResult
  assert.strictEqual(
    clean.ok,
    true,
    `precondition: the honest 2-record observer slice must reconcile ok:true; got: ${
      clean.ok === false
        ? JSON.stringify(clean.failures.map((f) => ({ rule: f.rule, field_path: f.field_path })))
        : "ok"
    }`,
  )
  assert.notStrictEqual(
    clean.math_gate_skipped,
    true,
    "precondition: the honest bundle must NOT carry math_gate_skipped",
  )

  // The attack: record[1] self-declares the engine-recompute skip with a VALID
  // basis (so Rule 15 passes) AND fabricates a forward field (forward.h1.net) that
  // Rule 14 would normally catch — but the self-declared skip makes Rule 14 no-op.
  r1.fixture_status.verification_state = "engine_recompute_skipped_with_basis"
  r1.attestor.skip_basis = "framework_op_unsupported"
  r1.forward.h1!.net = (r1.forward.h1!.net as number) + 0.4

  const result = reconcileMultiStep([r0, r1]) as MultiStepResult
  // ok semantics are PRESERVED — the skip is by-design (Leroy verified-vs-trusted);
  // the point is that the skip must be VISIBLE, not that the bundle must fail.
  assert.strictEqual(
    result.math_gate_skipped,
    true,
    `reconcileMultiStep must AGGREGATE the per-record math_gate_skipped signal — a fabricated ` +
      `record that self-declares engine_recompute_skipped_with_basis launders to a clean bundle ` +
      `ok:true, so the bundle MUST surface math_gate_skipped:true (the strongest math gate on ` +
      `imported math did not run on at least one record). got math_gate_skipped=${String(
        result.math_gate_skipped,
      )}, ok=${result.ok}`,
  )
  assert.ok(
    Array.isArray(result.skipped_rules) && result.skipped_rules.includes(14),
    `the bundle must enumerate the skipped rule(s); expected skipped_rules to include 14, got: ${JSON.stringify(
      result.skipped_rules,
    )}`,
  )
  // "which record" — the bundle must name the skipping record's index (record 1).
  assert.ok(
    Array.isArray(result.math_gate_skipped_records) &&
      result.math_gate_skipped_records.includes(1),
    `the bundle must identify WHICH record self-declared the skip; expected ` +
      `math_gate_skipped_records to include 1, got: ${JSON.stringify(
        result.math_gate_skipped_records,
      )}`,
  )
})

// FIX-1 anti-vacuity: a fully-honest multi-step bundle (no self-declared skip on
// any record) must NOT carry math_gate_skipped — the flag fires only when a real
// per-record skip occurred.
test("FIX-1 anti-vacuity: an honest multi-step observer bundle does NOT carry math_gate_skipped", () => {
  const bundlePath = resolve(
    __msRepoRoot,
    "fixtures/external/pytorch.softmax-ce.multi-step.golden.jsonl",
  )
  if (!existsSync(bundlePath)) return
  const records = readFileSync(bundlePath, "utf-8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l))
  const result = reconcileMultiStep(records) as MultiStepResult
  assert.strictEqual(
    result.ok,
    true,
    `precondition: the full honest multi-step golden must reconcile ok:true; got: ${
      result.ok === false
        ? JSON.stringify(result.failures.map((f) => ({ rule: f.rule, field_path: f.field_path })))
        : "ok"
    }`,
  )
  assert.notStrictEqual(
    result.math_gate_skipped,
    true,
    "an honest bundle (every record fully recomputed) must NOT carry math_gate_skipped:true",
  )
  assert.strictEqual(
    result.math_gate_skipped_records,
    undefined,
    "an honest bundle must not enumerate skipping records",
  )
})
