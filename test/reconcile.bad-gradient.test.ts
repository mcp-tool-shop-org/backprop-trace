import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { reconcileReceipt, type ReconciliationFailure } from "../src/reconcile.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturePath = resolve(__dirname, "../fixtures/bad/mazur.bad-gradient.jsonl");

test(
  "bp reconcile receipt fixtures/bad/mazur.bad-gradient.jsonl fails Rule 4 on w5",
  () => {
    const receipt = JSON.parse(readFileSync(fixturePath, "utf-8"));
    const result = reconcileReceipt(receipt);

    if (result.ok) {
      assert.fail("reconciler must reject the bad-gradient fixture");
    }

    const rule4OnW5 = result.failures.find(
      (f: ReconciliationFailure) => f.rule === 4 && f.parameter_id === "w5",
    );
    assert.ok(rule4OnW5, "Rule 4 failure on w5 must be present in result.failures");

    assert.strictEqual(rule4OnW5.field_path, "updates[4].gradient");
    assert.strictEqual(rule4OnW5.stored, -0.082166041);

    const expectedProduct = -0.138498562 * 0.593269992;
    assert.strictEqual(rule4OnW5.recomputed, expectedProduct);

    assert.strictEqual(rule4OnW5.tolerance, 1e-9);

    const expectedDelta = Math.abs(expectedProduct - -0.082166041);
    assert.strictEqual(rule4OnW5.delta, expectedDelta);
    assert.ok(
      rule4OnW5.delta > 1e-7,
      `delta ${rule4OnW5.delta} should be well above tolerance (expected ~1e-6, 1000x of 1e-9)`,
    );
  },
);
