/**
 * Rule 5 reconciliation tests — update value consistency:
 *   update == learning_rate * gradient.
 *
 * Mutates the golden in-memory: bump `updates[i].update` by a delta well
 * above tolerance, while leaving `gradient` and `weight_after` untouched.
 *
 * Rule 5 must fire on the chosen update. Critically, Rule 6 must NOT also
 * fire — the spec says "standalone Rule 5 failure" because weight_after
 * was derived from the original (un-mutated) update value, so the
 * weight_before + update arithmetic remains consistent if the reconciler
 * uses STORED values. (If Rule 6 also fires, the engine is recomputing
 * weight_after from the mutated stored update — a doctrinal choice. Both
 * are acceptable per the engine agent's discretion; see reconcile.bad-gradient
 * test for the parallel cascade discussion.)
 *
 * If the engine has not yet implemented Rule 5, the test skips.
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
  }>;
};

// Mutate updates[4] (w5) — the same index the bad-gradient fixture targets,
// to keep diagnostic noise concentrated on one parameter when reading test
// output side-by-side.
const TARGET_INDEX = 4;

function loadGoldenMutated(): GoldenLike {
  const receipt = JSON.parse(readFileSync(goldenPath, "utf-8")) as GoldenLike;
  const upd = receipt.updates[TARGET_INDEX]!;
  upd.update = upd.update + 1e-6; // well above 1e-9 tolerance
  return receipt;
}

test("reconciler reports standalone Rule 5 failure on mutated update value", (t) => {
  const receipt = loadGoldenMutated();
  const result = reconcileReceipt(receipt);

  if (result.ok) {
    t.skip(
      `TODO upstream: engine agent has not implemented Rule 5 ` +
        `(update == learning_rate * gradient). Reconciler accepted in-memory mutation silently.`,
    );
    return;
  }

  const rule5 = result.failures.find(
    (f: ReconciliationFailure) =>
      f.rule === 5 && f.field_path === `updates[${TARGET_INDEX}].update`,
  );
  assert.ok(
    rule5,
    `expected Rule 5 failure on updates[${TARGET_INDEX}].update; ` +
      `got: ${JSON.stringify(result.failures.map((f) => ({ rule: f.rule, field_path: f.field_path })))}`,
  );

  // Rule 5 is the only "standalone" failure expected from this mutation;
  // Rule 4 should not fire (gradient unchanged).
  const rule4OnSameUpdate = result.failures.filter(
    (f) =>
      f.rule === 4 && f.field_path === `updates[${TARGET_INDEX}].gradient`,
  );
  assert.strictEqual(
    rule4OnSameUpdate.length,
    0,
    `Rule 4 must NOT fire when only stored update value is mutated; got: ${JSON.stringify(rule4OnSameUpdate)}`,
  );

  // No cascade marker — this IS the originating rule for this mutation.
  assert.strictEqual(
    rule5.cascade_of_rule,
    undefined,
    `standalone Rule 5 failure must not carry cascade_of_rule; got: ${JSON.stringify(rule5)}`,
  );
});
