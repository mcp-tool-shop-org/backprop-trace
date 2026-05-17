/**
 * v0.5.1 — Generate fixtures/xor.multi-step.jsonl (the good multi-step
 * golden referenced by test/bp.verify-multi.cli.test.ts).
 *
 * Two records:
 *   - Step 0: XOR_INPUT verbatim (x1=1, x2=0; target y=1; deterministic
 *     init weights), with trace_id + step_index=0 added.
 *   - Step 1: same XOR sample, but parameters_before == step 0's
 *     parameters_after byte-for-byte. trace_id matches; step_index=1.
 *
 * Why this fixture exists:
 *   - Pairs with fixtures/bad/multi-step.bad-chain.jsonl (which mutates
 *     step 1's parameters_before by +1e-6 to break the chain). The good
 *     fixture is the canonical "all rules pass" baseline so the
 *     `bp verify multi <good>` exit-0 test has something to point at.
 *   - Pairs with fixtures/bad/multi-step.bad-trace-id.jsonl which mutates
 *     trace_id between records. Same baseline shape.
 *
 * Reproducibility: this script reads NO files, only TS source. Running
 * it from a clean checkout reproduces fixtures/xor.multi-step.jsonl
 * byte-for-byte. If V8 Math.exp drifts, the canary tests in
 * test/determinism.math-exp-canary.test.ts fire BEFORE this script's
 * output drifts silently.
 */

import { writeFileSync } from "node:fs"
import { runGeneralStep } from "../src/general-engine.js"
import { emitGeneralReceipt } from "../src/emit.js"
import { XOR_INPUT } from "../src/mazur.js"

// 16-byte (32-hex) trace identifier, pinned for the golden. Stable across
// reproductions; bytes in fixtures/xor.multi-step.jsonl match this.
const TRACE_ID = "0123456789abcdef0123456789abcdef"

const step0 = runGeneralStep({
  ...XOR_INPUT,
  trace_id: TRACE_ID,
  step_index: 0,
  fixture: "xor-multi-step-step-0",
  metadata: {
    source:
      "src/general-engine.ts (XOR-sigmoid 2-2-1; multi-step good fixture, step 0)",
    gradient_convention: "descent_direction",
  },
})

const step1 = runGeneralStep({
  ...XOR_INPUT,
  parameters_before: step0.parameters_after,
  trace_id: TRACE_ID,
  step_index: 1,
  fixture: "xor-multi-step-step-1",
  metadata: {
    source:
      "src/general-engine.ts (XOR-sigmoid 2-2-1; multi-step good fixture, step 1)",
    gradient_convention: "descent_direction",
  },
})

writeFileSync(
  "fixtures/xor.multi-step.jsonl",
  emitGeneralReceipt(step0) + emitGeneralReceipt(step1),
)
console.log("wrote fixtures/xor.multi-step.jsonl (2 records)")
console.log(
  `  step 0 trace_id=${step0.trace_id} step_index=${step0.step_index}`,
)
console.log(
  `  step 1 trace_id=${step1.trace_id} step_index=${step1.step_index}`,
)
console.log(
  `  chain check: step0.parameters_after.w_x1_h1 == step1.parameters_before.w_x1_h1: ` +
    `${step0.parameters_after.w_x1_h1 === step1.parameters_before.w_x1_h1}`,
)
