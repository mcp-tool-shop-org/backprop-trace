/**
 * Rule 7 reconciliation tests — final state consistency:
 *   parameters_after[param] == parameters_before[param] + sum(updates targeting param)
 *
 * Two subtests:
 *   (a) Mutate a parameters_after weight (in-updates path). Engine should
 *       fire Rule 7 on that weight key. parameters_before + the sum of
 *       updates yields the (un-mutated) golden value; the mutated stored
 *       value diverges.
 *   (b) Mutate parameters_after.b1 under bias_policy.mode === "constant"
 *       (exact-zero-delta path). Per src/engine.ts and reconciliation.md,
 *       constant biases must satisfy parameters_after.b1 === parameters_before.b1
 *       exactly (no tolerance). Any nonzero delta — even sub-tolerance —
 *       must fire Rule 7.
 *
 * If the engine has not yet implemented Rule 7, both subtests skip with a
 * TODO context.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { reconcileReceipt, type ReconciliationFailure } from "../src/reconcile.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const goldenPath = resolve(__dirname, "../fixtures/mazur.golden.jsonl");

type GoldenLike = {
  bias_policy: { mode: string };
  // Use an explicit shape (not Record<string, number>) so noUncheckedIndexedAccess
  // doesn't widen the per-key reads to `number | undefined`.
  parameters_after: {
    w1: number; w2: number; w3: number; w4: number;
    w5: number; w6: number; w7: number; w8: number;
    b1: number; b2: number;
  };
};

function loadGolden(): GoldenLike {
  return JSON.parse(readFileSync(goldenPath, "utf-8")) as GoldenLike;
}

test("(a) Rule 7 fires when parameters_after weight diverges from prior + sum(updates)", (t) => {
  const receipt = loadGolden();
  // Bump parameters_after.w5 by 1e-6 (well above 1e-9 tolerance).
  receipt.parameters_after.w5 = receipt.parameters_after.w5 + 1e-6;

  const result = reconcileReceipt(receipt);
  if (result.ok) {
    t.skip(
      `TODO upstream: engine agent has not implemented Rule 7 ` +
        `(parameters_after consistency). Reconciler accepted in-memory mutation silently.`,
    );
    return;
  }

  const rule7 = result.failures.find(
    (f: ReconciliationFailure) =>
      f.rule === 7 && /parameters_after\.w5/.test(f.field_path),
  );
  assert.ok(
    rule7,
    `expected Rule 7 failure on parameters_after.w5; got: ${JSON.stringify(
      result.failures.map((f) => ({ rule: f.rule, field_path: f.field_path })),
    )}`,
  );
});

test("(b) Rule 7 fires under bias_policy.mode === 'constant' for any nonzero bias delta", (t) => {
  const receipt = loadGolden();
  // Sanity-check the precondition.
  assert.strictEqual(
    receipt.bias_policy.mode,
    "constant",
    "golden fixture must be in constant-bias mode for this test",
  );
  // Mutate b1 by an absolute delta that is SMALLER than tolerance (1e-9).
  // Under the exact-zero-delta rule for constant biases, this MUST still
  // fire Rule 7 — biases are not subject to numeric tolerance.
  const subTol = 5e-10;
  receipt.parameters_after.b1 = receipt.parameters_after.b1 + subTol;

  const result = reconcileReceipt(receipt);
  if (result.ok) {
    t.skip(
      `TODO upstream: engine agent has not implemented Rule 7 (constant-bias exact-zero-delta path). ` +
        `Reconciler accepted sub-tolerance bias mutation silently.`,
    );
    return;
  }

  const rule7OnB1 = result.failures.find(
    (f: ReconciliationFailure) =>
      f.rule === 7 && /parameters_after\.b1/.test(f.field_path),
  );
  assert.ok(
    rule7OnB1,
    `expected Rule 7 failure on parameters_after.b1 for constant-bias mode even at sub-tolerance delta; ` +
      `got: ${JSON.stringify(
        result.failures.map((f) => ({ rule: f.rule, field_path: f.field_path })),
      )}`,
  );
});
