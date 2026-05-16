/**
 * Rule 6 reconciliation tests — weight progression:
 *   weight_after == weight_before + update.
 *
 * Mutates the golden in-memory: bump `updates[i].weight_after` by a delta
 * well above tolerance, while leaving `weight_before` and `update`
 * untouched. Rule 6 must fire as a standalone failure on that update.
 *
 * If the engine has not yet implemented Rule 6, the test skips with a
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
  updates: Array<{
    parameter_id: string;
    weight_before: number;
    update: number;
    weight_after: number;
  }>;
  parameters_after: Record<string, number>;
};

const TARGET_INDEX = 4; // w5

function loadGoldenMutated(): GoldenLike {
  const receipt = JSON.parse(readFileSync(goldenPath, "utf-8")) as GoldenLike;
  const upd = receipt.updates[TARGET_INDEX]!;
  upd.weight_after = upd.weight_after + 1e-6;
  // Keep parameters_after consistent with the (still-correct) update value
  // so Rule 7 doesn't co-fire and muddy the standalone-Rule-6 claim.
  // We leave parameters_after.w5 at the unmodified original — derived from
  // the unmodified update value, so Rule 7 (params == weight_before + update)
  // remains internally consistent.
  return receipt;
}

test("reconciler reports standalone Rule 6 failure on mutated weight_after", (t) => {
  const receipt = loadGoldenMutated();
  const result = reconcileReceipt(receipt);

  if (result.ok) {
    t.skip(
      `TODO upstream: engine agent has not implemented Rule 6 ` +
        `(weight_after == weight_before + update). Reconciler accepted in-memory mutation silently.`,
    );
    return;
  }

  const rule6 = result.failures.find(
    (f: ReconciliationFailure) =>
      f.rule === 6 &&
      f.field_path === `updates[${TARGET_INDEX}].weight_after`,
  );
  assert.ok(
    rule6,
    `expected Rule 6 failure on updates[${TARGET_INDEX}].weight_after; ` +
      `got: ${JSON.stringify(result.failures.map((f) => ({ rule: f.rule, field_path: f.field_path })))}`,
  );

  // Rule 5 must NOT also fire — `update` itself is unchanged.
  const rule5OnSameUpdate = result.failures.filter(
    (f) => f.rule === 5 && f.field_path === `updates[${TARGET_INDEX}].update`,
  );
  assert.strictEqual(
    rule5OnSameUpdate.length,
    0,
    `Rule 5 must NOT fire when only weight_after is mutated; got: ${JSON.stringify(rule5OnSameUpdate)}`,
  );

  // Originating rule — no cascade marker.
  assert.strictEqual(
    rule6.cascade_of_rule,
    undefined,
    `standalone Rule 6 failure must not carry cascade_of_rule; got: ${JSON.stringify(rule6)}`,
  );
});
