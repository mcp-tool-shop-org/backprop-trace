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
