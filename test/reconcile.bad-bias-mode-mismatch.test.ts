/**
 * Rule 0 (structural) reconciliation test on per-neuron bias fixture
 * (bad-bias-mode-mismatch).
 *
 * Per Agent F's contract (consolidator-decision §5):
 *   fixtures/bad/xor.bad-bias-mode-mismatch.jsonl — XOR per-neuron bias
 *   receipt where bias_policy.mode disagrees with what the updates[] array
 *   implies (e.g., bias_policy.mode === "constant" but updates contains
 *   kind: "bias" entries).
 *
 * Rule 0 is the structural-failure sentinel — this fixture exercises the
 * "receipt's self-declared policy contradicts its emitted update behavior"
 * branch. The reconciler must report at least one Rule 0 failure rather
 * than silently accepting the contradiction.
 *
 * Skip behavior: missing fixture => test.skip with upstream TODO note.
 */

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"
import { reconcileReceipt, type ReconciliationFailure } from "../src/reconcile.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const fixturePath = resolve(__dirname, "../fixtures/bad/xor.bad-bias-mode-mismatch.jsonl")

test("xor.bad-bias-mode-mismatch fixture fails reconcile with at least one Rule 0 (structural) failure", (t) => {
  if (!existsSync(fixturePath)) {
    t.skip(
      `TODO upstream (Fixtures agent): fixtures/bad/xor.bad-bias-mode-mismatch.jsonl ` +
        `not yet present. v0.4 contract is per-neuron-bias XOR receipt with ` +
        `bias_policy.mode contradicting the updates[] kind: 'bias' entries.`,
    )
    return
  }

  const receipt = JSON.parse(readFileSync(fixturePath, "utf-8"))
  const result = reconcileReceipt(receipt)

  // G-012: the bias_policy.mode vs updates[*].kind contradiction is now wired
  // (Rule 0 sub-check 0a/0b). A silent accept of this self-inconsistent receipt
  // IS the soundness failure this test guards — assert rejection rather than
  // skipping it into a green pass.
  assert.strictEqual(
    result.ok,
    false,
    "bias_policy.mode vs updates[*].kind contradiction must be rejected — " +
      "silent accept is the soundness failure this test guards",
  )
  if (result.ok) return // type narrowing

  // The canonical shape is a Rule 0 (structural) failure on the policy/updates
  // contradiction. (A Rule 5/6/7 aggregate would also condemn the receipt, but
  // the wired behavior is Rule 0 — pin it.)
  const rule0 = result.failures.filter((f: ReconciliationFailure) => f.rule === 0)
  assert.ok(
    rule0.length >= 1,
    `at least one Rule 0 (structural) failure expected on bias_policy.mode vs updates[*].kind ` +
      `contradiction; got rules ${JSON.stringify(result.failures.map((f) => f.rule))}`,
  )
})
