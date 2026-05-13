import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { reconcileReceipt, type ReconciliationFailure } from "../src/reconcile.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturePath = resolve(__dirname, "../fixtures/bad/mazur.bad-gradient.jsonl");

test(
  "bp reconcile receipt fixtures/bad/mazur.bad-gradient.jsonl fails Rule 4 on w5 only",
  () => {
    const receipt = JSON.parse(readFileSync(fixturePath, "utf-8"));
    const result = reconcileReceipt(receipt);

    if (result.ok) {
      assert.fail("reconciler must reject the bad-gradient fixture");
    }

    // Single-target invariant: exactly one Rule 4 failure, and it is on w5.
    // If other parameters fail Rule 4, the bad fixture's anti-circularity
    // proof is muddied by precision noise — that means the fixture (or the
    // tolerance policy) regressed.
    const rule4Failures = result.failures.filter(
      (f: ReconciliationFailure) => f.rule === 4,
    );
    assert.strictEqual(
      rule4Failures.length,
      1,
      `exactly one Rule 4 failure expected (w5 only); got ${rule4Failures.length}: ${JSON.stringify(rule4Failures.map((f) => f.parameter_id))}`,
    );

    const rule4OnW5 = rule4Failures[0];
    assert.ok(rule4OnW5, "single Rule 4 failure must exist");
    assert.strictEqual(rule4OnW5.parameter_id, "w5");
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
