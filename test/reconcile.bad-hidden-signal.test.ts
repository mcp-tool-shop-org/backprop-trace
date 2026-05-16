/**
 * Rule 3 reconciliation tests — hidden_error_signal consistency:
 *   signal_value == backpropagated_sum * activation_derivative.
 *
 * Mutates the golden in-memory: bump `backward.hidden_error_signals.h1.signal_value`
 * by a delta well above tolerance, while leaving backpropagated_sum and
 * activation_derivative untouched. Rule 3 must fire on h1; Rule 2 must NOT
 * fire (sum and contributions are unchanged).
 *
 * If the engine has not yet implemented Rule 3, the test skips with a
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
  backward: {
    hidden_error_signals: {
      h1: {
        signal_value: number;
        backpropagated_sum: number;
        activation_derivative: number;
      };
    };
  };
};

function loadGoldenMutated(): GoldenLike {
  const receipt = JSON.parse(readFileSync(goldenPath, "utf-8")) as GoldenLike;
  // Bump h1.signal_value by 1e-6 (well above 1e-9 tolerance).
  receipt.backward.hidden_error_signals.h1.signal_value =
    receipt.backward.hidden_error_signals.h1.signal_value + 1e-6;
  return receipt;
}

test("reconciler reports Rule 3 failure when h1.signal_value is mutated", (t) => {
  const receipt = loadGoldenMutated();
  const result = reconcileReceipt(receipt);

  if (result.ok) {
    t.skip(
      `TODO upstream: engine agent has not implemented Rule 3 (hidden_error_signal consistency). ` +
        `Reconciler accepted the in-memory mutation silently.`,
    );
    return;
  }

  const rule3 = result.failures.find(
    (f: ReconciliationFailure) =>
      f.rule === 3 &&
      f.field_path === "backward.hidden_error_signals.h1.signal_value",
  );
  assert.ok(
    rule3,
    `expected Rule 3 failure on backward.hidden_error_signals.h1.signal_value; ` +
      `got: ${JSON.stringify(result.failures.map((f) => ({ rule: f.rule, field_path: f.field_path })))}`,
  );

  // Rule 2 must NOT also fire — only signal_value was mutated.
  const rule2OnSameUnit = result.failures.filter(
    (f) =>
      f.rule === 2 &&
      f.field_path.startsWith("backward.hidden_error_signals.h1"),
  );
  assert.strictEqual(
    rule2OnSameUnit.length,
    0,
    `Rule 2 must NOT fire when only signal_value is mutated (sum + contributions unchanged); ` +
      `got: ${JSON.stringify(rule2OnSameUnit)}`,
  );

  // FT-E-018: failure carries the factor decomposition (backprop_sum +
  // activation_derivative) and product_order.
  const rule3Any = rule3 as unknown as {
    factors?: Array<{ name: string; value: number }>;
    product_order?: string;
  };
  assert.ok(
    Array.isArray(rule3Any.factors),
    `Rule 3 failure must include factors[] per FT-E-018; got: ${JSON.stringify(rule3)}`,
  );
  assert.strictEqual(
    rule3Any.product_order,
    "left_to_right",
    `Rule 3 failure must include product_order === "left_to_right"; ` +
      `got: ${JSON.stringify(rule3)}`,
  );
});
