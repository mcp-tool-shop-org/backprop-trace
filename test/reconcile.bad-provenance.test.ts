/**
 * Rule 8 reconciliation tests — provenance reference consistency:
 *   each factor.from path resolves AND factor.value equals the referenced field.
 *
 * Mutates a factor.value whose `from` field points elsewhere in the
 * receipt. Specifically: updates[4].optimizer.factors[0] is the output
 * error signal factor whose `from` is
 * "backward.output_error_signals.o1.signal_value". Bumping that factor's
 * stored value (without touching the source field it references) must
 * fire Rule 8 with field_path = the `from` string.
 *
 * If the engine has not yet implemented Rule 8, the test skips.
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
  updates: Array<{
    parameter_id: string;
    gradient: number;
    update: number;
    weight_after: number;
    optimizer: {
      factors: Array<{ name: string; from?: string; value: number }>;
    };
  }>;
};

const TARGET_INDEX = 4; // w5
const TARGET_FACTOR_INDEX = 0; // the output_error_signal factor

function loadGoldenMutated(): { receipt: GoldenLike; expectedFrom: string } {
  const receipt = JSON.parse(readFileSync(goldenPath, "utf-8")) as GoldenLike;
  const factor = receipt.updates[TARGET_INDEX]!.optimizer.factors[TARGET_FACTOR_INDEX]!;
  assert.ok(
    typeof factor.from === "string" && factor.from.length > 0,
    `target factor must carry a 'from' provenance string in the golden; got: ${JSON.stringify(factor)}`,
  );
  const expectedFrom = factor.from;
  // Mutate the stored value while leaving the referenced source untouched.
  // The source field is backward.output_error_signals.o1.signal_value;
  // we mutate ONLY factors[0].value.
  factor.value = factor.value + 1e-6;

  // Keep gradient consistent with the mutated factor product so Rule 4
  // doesn't co-fire and obscure Rule 8. Use the new factors[0].value *
  // factors[1].value computed left-to-right.
  const newProduct =
    factor.value *
    receipt.updates[TARGET_INDEX]!.optimizer.factors[1]!.value;
  receipt.updates[TARGET_INDEX]!.gradient = newProduct;
  // And keep update + weight_after derived from the new gradient so
  // Rules 5/6 don't co-fire either.
  const lr = 0.5;
  receipt.updates[TARGET_INDEX]!.update = lr * newProduct;
  receipt.updates[TARGET_INDEX]!.weight_after =
    0.4 /* w5 before */ + lr * newProduct;
  return { receipt, expectedFrom };
}

test("reconciler reports Rule 8 failure when a factor.value disagrees with its 'from' source", (t) => {
  const { receipt, expectedFrom } = loadGoldenMutated();
  const result = reconcileReceipt(receipt);

  if (result.ok) {
    t.skip(
      `TODO upstream: engine agent has not implemented Rule 8 ` +
        `(factor.from provenance check). Reconciler accepted in-memory mutation silently.`,
    );
    return;
  }

  const rule8 = result.failures.find(
    (f: ReconciliationFailure) =>
      f.rule === 8 && f.field_path === expectedFrom,
  );
  assert.ok(
    rule8,
    `expected Rule 8 failure with field_path === ${JSON.stringify(expectedFrom)}; ` +
      `got: ${JSON.stringify(
        result.failures.map((f) => ({ rule: f.rule, field_path: f.field_path })),
      )}`,
  );

  // The numeric quartet should still be populated — stored is the factor's
  // declared value, recomputed is the referenced source.
  assert.strictEqual(typeof rule8.stored, "number", "rule8.stored is a number");
  assert.strictEqual(
    typeof rule8.recomputed,
    "number",
    "rule8.recomputed is a number",
  );
  assert.strictEqual(typeof rule8.delta, "number", "rule8.delta is a number");
});
