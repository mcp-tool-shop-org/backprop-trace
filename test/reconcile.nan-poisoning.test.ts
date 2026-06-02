/**
 * T-A-001: NaN-poisoning rejection.
 *
 * Covers the silent-Rule-4-pass class of bugs: prior to the engine agent's
 * fix in reconcile.ts (E-A-001), `Math.abs(NaN - x) > tolerance` evaluates
 * to `false`, so a receipt with NaN in a gradient/factor would be silently
 * accepted. These tests pin the post-fix behavior: any non-finite value
 * reachable by Rule 4's computation MUST cause `result.ok === false`.
 *
 * Receipts are constructed in-memory by cloning the golden Mazur receipt
 * (so they remain otherwise structurally valid) and mutating a single field
 * to a poisoned value before invoking reconcileReceipt. This isolates the
 * non-finite-rejection contract from any other rule.
 *
 * Cross-references:
 *   - Engine agent: src/reconcile.ts E-A-001 NaN-poisoning guard
 *   - Research grounding: Csmith/CompCert anti-circularity lineage (Finding 4)
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { reconcileReceipt, type ReconciliationFailure } from "../src/reconcile.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const goldenPath = resolve(__dirname, "../fixtures/mazur.golden.jsonl");

/**
 * G-051 / G-025: load a REQUIRED golden by repo-relative path, deep-cloning so
 * each mutation is isolated. Asserts the fixture exists (a deleted/renamed
 * golden must fail LOUDLY here, not be skipped vacuously). Returns a typed
 * Record for field mutation.
 */
function loadRequiredGoldenClone(relPath: string): Record<string, any> {
  const p = resolve(__dirname, "..", relPath);
  assert.ok(existsSync(p), `required golden fixture missing: ${p}`);
  return JSON.parse(readFileSync(p, "utf-8").trim()) as Record<string, any>;
}

/**
 * G-051 shared contract: a non-finite (NaN/Inf) value reachable by the
 * reconciler MUST produce ok:false, and the fired-rule set must include the
 * structural sentinel Rule 0 OR at least one of the rules relevant to the
 * mutated field. The worst defect is a SILENT PASS (NaN > tol === false), so
 * any rejection naming a relevant rule satisfies the contract; we additionally
 * assert ok===false unconditionally.
 */
function assertNonFiniteRejected(
  receipt: unknown,
  label: string,
  relevantRules: readonly number[],
): void {
  const result = reconcileReceipt(receipt);
  assert.strictEqual(
    result.ok,
    false,
    `${label}: a non-finite value must NOT pass reconciliation (silent NaN>tol pass is the soundness bug)`,
  );
  if (result.ok) return; // type narrowing
  const fired = new Set(result.failures.map((f) => f.rule));
  const acceptable = [0, ...relevantRules];
  assert.ok(
    acceptable.some((r) => fired.has(r)),
    `${label}: expected a Rule 0 (non-finite/structural) OR one of Rules ${JSON.stringify(relevantRules)} ` +
      `to fire; actual fired rules: ${JSON.stringify(Array.from(fired).sort((a, b) => a - b))}. ` +
      `Failures: ${JSON.stringify(result.failures.map((f) => ({ rule: f.rule, field: f.field_path })), null, 2)}`,
  );
}

// Load and parse the golden fixture once per test so each mutation is
// applied to a fresh deep clone (no cross-test contamination).
function loadGoldenClone(): Record<string, unknown> {
  const text = readFileSync(goldenPath, "utf-8").trim();
  return JSON.parse(text) as Record<string, unknown>;
}

function findRule4OrStructuralFailureOn(
  failures: ReconciliationFailure[],
  fieldPathPrefix: string,
): ReconciliationFailure | undefined {
  return failures.find(
    (f) =>
      (f.rule === 4 || f.rule === 0) &&
      typeof f.field_path === "string" &&
      f.field_path.startsWith(fieldPathPrefix),
  );
}

test(
  "reconcileReceipt rejects receipt where updates[0].gradient is NaN",
  () => {
    const receipt = loadGoldenClone();
    const updates = receipt.updates as Array<Record<string, unknown>>;
    updates[0]!.gradient = Number.NaN;

    const result = reconcileReceipt(receipt);
    assert.strictEqual(
      result.ok,
      false,
      "NaN gradient must NOT pass reconciliation (silent-Rule-4 pass is the E-A-001 bug)",
    );
    if (result.ok) return; // type narrowing for TS

    const f = findRule4OrStructuralFailureOn(result.failures, "updates[0]");
    assert.ok(
      f,
      `expected a Rule 4 or Rule 0 failure on updates[0], got: ${JSON.stringify(result.failures, null, 2)}`,
    );
  },
);

test(
  "reconcileReceipt rejects receipt where updates[0].gradient is +Infinity",
  () => {
    const receipt = loadGoldenClone();
    const updates = receipt.updates as Array<Record<string, unknown>>;
    updates[0]!.gradient = Number.POSITIVE_INFINITY;

    const result = reconcileReceipt(receipt);
    assert.strictEqual(
      result.ok,
      false,
      "+Infinity gradient must NOT pass reconciliation",
    );
    if (result.ok) return;

    const f = findRule4OrStructuralFailureOn(result.failures, "updates[0]");
    assert.ok(
      f,
      `expected a Rule 4 or Rule 0 failure on updates[0], got: ${JSON.stringify(result.failures, null, 2)}`,
    );
  },
);

test(
  "reconcileReceipt rejects receipt where updates[0].gradient is -Infinity",
  () => {
    const receipt = loadGoldenClone();
    const updates = receipt.updates as Array<Record<string, unknown>>;
    updates[0]!.gradient = Number.NEGATIVE_INFINITY;

    const result = reconcileReceipt(receipt);
    assert.strictEqual(
      result.ok,
      false,
      "-Infinity gradient must NOT pass reconciliation",
    );
    if (result.ok) return;

    const f = findRule4OrStructuralFailureOn(result.failures, "updates[0]");
    assert.ok(
      f,
      `expected a Rule 4 or Rule 0 failure on updates[0], got: ${JSON.stringify(result.failures, null, 2)}`,
    );
  },
);

test(
  "reconcileReceipt rejects receipt where updates[0].optimizer.factors[0].value is NaN",
  () => {
    const receipt = loadGoldenClone();
    const updates = receipt.updates as Array<Record<string, unknown>>;
    const optimizer = updates[0]!.optimizer as Record<string, unknown>;
    const factors = optimizer.factors as Array<Record<string, unknown>>;
    factors[0]!.value = Number.NaN;

    const result = reconcileReceipt(receipt);
    assert.strictEqual(
      result.ok,
      false,
      "NaN factor value must poison the product and cause Rule 4 to reject the receipt (NOT silently pass via NaN > tolerance === false)",
    );
    if (result.ok) return;

    const f = findRule4OrStructuralFailureOn(result.failures, "updates[0]");
    assert.ok(
      f,
      `expected a Rule 4 or Rule 0 failure on updates[0], got: ${JSON.stringify(result.failures, null, 2)}`,
    );
  },
);

test(
  "reconcileReceipt rejects receipt where updates[0].optimizer.factors[1].value is Infinity",
  () => {
    const receipt = loadGoldenClone();
    const updates = receipt.updates as Array<Record<string, unknown>>;
    const optimizer = updates[0]!.optimizer as Record<string, unknown>;
    const factors = optimizer.factors as Array<Record<string, unknown>>;
    factors[1]!.value = Number.POSITIVE_INFINITY;

    const result = reconcileReceipt(receipt);
    assert.strictEqual(
      result.ok,
      false,
      "+Infinity factor value must poison the product and cause Rule 4 to reject the receipt",
    );
    if (result.ok) return;

    const f = findRule4OrStructuralFailureOn(result.failures, "updates[0]");
    assert.ok(
      f,
      `expected a Rule 4 or Rule 0 failure on updates[0], got: ${JSON.stringify(result.failures, null, 2)}`,
    );
  },
);

test(
  "reconcileReceipt rejects receipt where numeric_policy.tolerance is NaN (structural Rule 0)",
  () => {
    const receipt = loadGoldenClone();
    const np = receipt.numeric_policy as Record<string, unknown>;
    np.tolerance = Number.NaN;

    const result = reconcileReceipt(receipt);
    assert.strictEqual(
      result.ok,
      false,
      "NaN tolerance must produce a structural failure (Rule 0), not be silently accepted",
    );
    if (result.ok) return;

    // tolerance is enforced via the structural shape guard at the top of
    // reconcileReceipt; expect rule 0 specifically.
    const f = result.failures.find(
      (f) =>
        f.rule === 0 &&
        typeof f.field_path === "string" &&
        f.field_path.includes("tolerance"),
    );
    assert.ok(
      f,
      `expected a Rule 0 failure on numeric_policy.tolerance, got: ${JSON.stringify(result.failures, null, 2)}`,
    );
  },
);

// ===========================================================================
// G-051: extend NaN/Inf rejection beyond the Mazur Rule-4 path.
//
// Pre-G-051 the only non-finite tests targeted Mazur gradients/factors (Rule
// 4) and tolerance (Rule 0). A NaN/Inf injected into a forward field, a softmax
// output (Rules 11/12), or Adam/momentum optimizer state (Rules 20-26) was
// UNTESTED — and a silent pass there is the same class of bug (NaN > tol ===
// false). These tests inject non-finite values into each of those surfaces and
// assert ok:false with Rule 0 or the relevant rule.
//
// Fixtures: engine-authored softmax+CE (fixtures/softmax-ce.golden.jsonl) and
// observer-mode (external_imported) PyTorch goldens for Adam / SGD-momentum /
// softmax+CE under fixtures/external/. Each baseline reconciles ok:true, so the
// non-finite mutation is the sole cause of rejection. Determinism: in-memory
// clone + single-field mutation, no wall-clock / randomness / locale.
// ===========================================================================

// --- Baseline sanity: the G-051 goldens reconcile cleanly unmutated ---------
test("G-051 baseline: softmax-ce + observer Adam/momentum goldens reconcile clean", () => {
  for (const rel of [
    "fixtures/softmax-ce.golden.jsonl",
    "fixtures/external/pytorch.adam.golden.jsonl",
    "fixtures/external/pytorch.sgd-momentum.golden.jsonl",
    "fixtures/external/pytorch.softmax-ce.golden.jsonl",
  ]) {
    const r = loadRequiredGoldenClone(rel);
    const result = reconcileReceipt(r);
    assert.strictEqual(
      result.ok,
      true,
      `${rel} baseline must reconcile ok:true (else the G-051 mutation tests aren't isolating the ` +
        `non-finite injection); got: ${JSON.stringify(
          result.ok === false ? result.failures.map((f) => ({ rule: f.rule, field_path: f.field_path })) : "ok",
        )}`,
    );
  }
});

// --- Softmax outputs (Rules 11/12) ------------------------------------------
test("G-051: NaN in softmax forward output is rejected (Rule 0/11/12)", () => {
  const r = loadRequiredGoldenClone("fixtures/softmax-ce.golden.jsonl");
  const out = r.topology.unit_order.output[0] as string;
  r.forward[out].out = Number.NaN;
  assertNonFiniteRejected(r, `softmax forward.${out}.out=NaN`, [11, 12]);
});

test("G-051: +Infinity in softmax forward output is rejected (Rule 0/11/12)", () => {
  const r = loadRequiredGoldenClone("fixtures/softmax-ce.golden.jsonl");
  const out = r.topology.unit_order.output[1] as string;
  r.forward[out].out = Number.POSITIVE_INFINITY;
  assertNonFiniteRejected(r, `softmax forward.${out}.out=+Inf`, [11, 12]);
});

test("G-051: NaN in softmax loss.per_output is rejected (Rule 12)", () => {
  const r = loadRequiredGoldenClone("fixtures/softmax-ce.golden.jsonl");
  const out = r.topology.unit_order.output[0] as string;
  r.loss.per_output[out] = Number.NaN;
  assertNonFiniteRejected(r, `softmax loss.per_output.${out}=NaN`, [12]);
});

test("G-051: -Infinity in softmax loss.total is rejected (Rule 12)", () => {
  const r = loadRequiredGoldenClone("fixtures/softmax-ce.golden.jsonl");
  r.loss.total = Number.NEGATIVE_INFINITY;
  assertNonFiniteRejected(r, "softmax loss.total=-Inf", [12]);
});

// --- Observer-mode forward fields (Rule 0/8/14) -----------------------------
test("G-051: NaN in observer-mode forward.out is rejected (Rule 0/8/14)", () => {
  const r = loadRequiredGoldenClone("fixtures/external/pytorch.adam.golden.jsonl");
  r.forward.h1.out = Number.NaN;
  // Rule 14 (engine recompute differential) and/or Rule 8 (provenance) and/or
  // Rule 0 catch a non-finite forward field on an external_imported receipt.
  assertNonFiniteRejected(r, "observer forward.h1.out=NaN", [8, 14]);
});

test("G-051: +Infinity in observer-mode forward.net is rejected (Rule 0/14)", () => {
  const r = loadRequiredGoldenClone("fixtures/external/pytorch.adam.golden.jsonl");
  r.forward.o1.net = Number.POSITIVE_INFINITY;
  assertNonFiniteRejected(r, "observer forward.o1.net=+Inf", [14]);
});

// --- Adam optimizer state (Rules 20-24) -------------------------------------
test("G-051: NaN in Adam state_after.m is rejected (Rule 0/20/22/24)", () => {
  const r = loadRequiredGoldenClone("fixtures/external/pytorch.adam.golden.jsonl");
  r.updates[0].optimizer.state_after.m = Number.NaN;
  assertNonFiniteRejected(r, "adam state_after.m=NaN", [20, 22, 23, 24]);
});

test("G-051: +Infinity in Adam state_after.v is rejected (Rule 0/20/22/24)", () => {
  const r = loadRequiredGoldenClone("fixtures/external/pytorch.adam.golden.jsonl");
  r.updates[0].optimizer.state_after.v = Number.POSITIVE_INFINITY;
  assertNonFiniteRejected(r, "adam state_after.v=+Inf", [20, 22, 23, 24]);
});

test("G-051: NaN in Adam state_before.m is rejected (Rule 0/20/22)", () => {
  const r = loadRequiredGoldenClone("fixtures/external/pytorch.adam.golden.jsonl");
  // state_before may be absent on a first step; assert it exists for this golden.
  assert.ok(
    r.updates[0].optimizer.state_before &&
      typeof r.updates[0].optimizer.state_before === "object",
    "pytorch.adam.golden.jsonl must carry updates[0].optimizer.state_before for this test",
  );
  r.updates[0].optimizer.state_before.m = Number.NaN;
  assertNonFiniteRejected(r, "adam state_before.m=NaN", [20, 22]);
});

// --- SGD-momentum optimizer state (Rules 20-21) -----------------------------
test("G-051: NaN in SGD-momentum state_after.buffer is rejected (Rule 0/20/21)", () => {
  const r = loadRequiredGoldenClone("fixtures/external/pytorch.sgd-momentum.golden.jsonl");
  r.updates[0].optimizer.state_after.buffer = Number.NaN;
  assertNonFiniteRejected(r, "momentum state_after.buffer=NaN", [20, 21]);
});

test("G-051: -Infinity in SGD-momentum state_after.buffer is rejected (Rule 0/20/21)", () => {
  const r = loadRequiredGoldenClone("fixtures/external/pytorch.sgd-momentum.golden.jsonl");
  r.updates[0].optimizer.state_after.buffer = Number.NEGATIVE_INFINITY;
  assertNonFiniteRejected(r, "momentum state_after.buffer=-Inf", [20, 21]);
});
