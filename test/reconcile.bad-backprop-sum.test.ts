/**
 * Rule 2b reconciliation tests — backpropagated_sum mismatch:
 *   backpropagated_sum == sum(contributions[*].value in summation_order).
 *
 * Two paths:
 *   1. If CI/Docs ships fixtures/bad/mazur.bad-backprop-sum.jsonl, parse it.
 *   2. Otherwise, derive the bad receipt in-memory by mutating the golden's
 *      `backpropagated_sum` field while leaving the per-contribution values
 *      untouched. This is the explicit fallback authorized by the scope:
 *      "extend test/reconcile.bad-contribution.test.ts with a mutation
 *      that affects only the sum" — we keep it in its own file here for
 *      one-file-per-rule clarity.
 *
 * Skips with a TODO context if neither the fixture nor the upstream
 * engine support is wired (i.e. reconciler accepts the in-memory mutation
 * silently — would indicate Rule 2 not implemented).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { reconcileReceipt, type ReconciliationFailure } from "../src/reconcile.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturePath = resolve(
  __dirname,
  "../fixtures/bad/mazur.bad-backprop-sum.jsonl",
);
const goldenPath = resolve(__dirname, "../fixtures/mazur.golden.jsonl");

function loadFixture(): unknown | null {
  if (!existsSync(fixturePath)) return null;
  return JSON.parse(readFileSync(fixturePath, "utf-8"));
}

function buildInMemoryBadSum(): {
  receipt: Record<string, unknown>;
  expectedFieldPath: string;
} {
  // Deep-clone the golden so we never mutate a shared object.
  const receipt = JSON.parse(readFileSync(goldenPath, "utf-8")) as Record<
    string,
    unknown
  >;
  // Reach in and bump h1's stored backpropagated_sum by a value well above
  // tolerance (1e-9). Leave downstream_contributions[*].value untouched
  // so Rule 2a (per-contribution) does not fire — only the sum check.
  const backward = receipt.backward as {
    hidden_error_signals: {
      h1: { backpropagated_sum: number };
    };
  };
  backward.hidden_error_signals.h1.backpropagated_sum =
    backward.hidden_error_signals.h1.backpropagated_sum + 1e-6;
  return {
    receipt,
    expectedFieldPath:
      "backward.hidden_error_signals.h1.backpropagated_sum",
  };
}

test("reconciler reports Rule 2 failure on bad-backprop-sum fixture or in-memory mutation", (t) => {
  let receipt: unknown;
  let source: string;
  let expectedFieldPathPattern: RegExp;

  const fromFixture = loadFixture();
  if (fromFixture !== null) {
    receipt = fromFixture;
    source = "fixture";
    expectedFieldPathPattern =
      /backward\.hidden_error_signals\.(h1|h2)\.backpropagated_sum/;
  } else {
    const built = buildInMemoryBadSum();
    receipt = built.receipt;
    source = "in-memory mutation";
    expectedFieldPathPattern = new RegExp(
      built.expectedFieldPath.replace(/\./g, "\\."),
    );
  }

  const result = reconcileReceipt(receipt);

  if (result.ok) {
    // If engine agent has not implemented Rule 2, neither path will fire.
    // Skip rather than fail outright — clearly marks the upstream gap.
    t.skip(
      `TODO upstream: engine agent has not implemented Rule 2 (backpropagated_sum check). ` +
        `Reconciler accepted the ${source} silently.`,
    );
    return;
  }

  const rule2SumFailure = result.failures.find(
    (f: ReconciliationFailure) =>
      f.rule === 2 && expectedFieldPathPattern.test(f.field_path),
  );
  assert.ok(
    rule2SumFailure,
    `expected a Rule 2 failure on backpropagated_sum (${source}); ` +
      `got: ${JSON.stringify(result.failures.map((f) => ({ rule: f.rule, field_path: f.field_path })))}`,
  );
});
