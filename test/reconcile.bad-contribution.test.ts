/**
 * Rule 2a reconciliation tests — per-contribution mismatch:
 *   downstream_contribution.value == downstream_signal * weight_value.
 *
 * The bad fixture is owned by the CI/Docs agent
 * (fixtures/bad/mazur.bad-contribution.jsonl). It mutates a single stored
 * contribution.value while leaving downstream_signal and weight_value
 * untouched, so Rule 2 fires on exactly that contribution.
 *
 * If the fixture has not landed yet, tests skip with a TODO context so
 * the failure surfaces clearly as a cross-agent dependency.
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
  "../fixtures/bad/mazur.bad-contribution.jsonl",
);

function loadFixture(): unknown | null {
  if (!existsSync(fixturePath)) return null;
  return JSON.parse(readFileSync(fixturePath, "utf-8"));
}

test("reconciler reports Rule 2 failure on mazur.bad-contribution fixture", (t) => {
  const receipt = loadFixture();
  if (receipt === null) {
    t.skip(
      `TODO upstream: CI/Docs agent has not yet shipped ${fixturePath}; ` +
        `Rule 2 per-contribution assertions deferred.`,
    );
    return;
  }
  const result = reconcileReceipt(receipt);
  assert.strictEqual(
    result.ok,
    false,
    "bad-contribution fixture must be rejected (Rule 2 fires on mutated contribution)",
  );
  if (result.ok) return;

  const rule2Failures = result.failures.filter(
    (f: ReconciliationFailure) => f.rule === 2,
  );
  assert.ok(
    rule2Failures.length >= 1,
    `expected at least one Rule 2 failure; got ${rule2Failures.length}: ` +
      `${JSON.stringify(result.failures.map((f) => ({ rule: f.rule, field_path: f.field_path })))}`,
  );

  // The mutated contribution lives somewhere under
  // backward.hidden_error_signals.{h1,h2}.downstream_contributions[i].value.
  // Don't over-specify the exact index — fixture author may pick any.
  const perContribFailure = rule2Failures.find((f) =>
    /backward\.hidden_error_signals\.(h1|h2)\.downstream_contributions\[\d+\]\.value/.test(
      f.field_path,
    ),
  );
  assert.ok(
    perContribFailure,
    `expected a Rule 2 failure whose field_path targets a specific contribution; ` +
      `got: ${JSON.stringify(rule2Failures.map((f) => f.field_path))}`,
  );
});

test("Rule 2 per-contribution failure carries the numeric quartet", (t) => {
  const receipt = loadFixture();
  if (receipt === null) {
    t.skip(
      `TODO upstream: CI/Docs agent has not yet shipped ${fixturePath}; ` +
        `quartet assertions deferred.`,
    );
    return;
  }
  const result = reconcileReceipt(receipt);
  if (result.ok) {
    assert.fail("expected Rule 2 failure on bad-contribution fixture");
  }
  const rule2 = result.failures.find(
    (f) =>
      f.rule === 2 &&
      /downstream_contributions\[\d+\]\.value/.test(f.field_path),
  );
  assert.ok(
    rule2,
    `expected a per-contribution Rule 2 failure; got: ${JSON.stringify(result.failures)}`,
  );
  assert.strictEqual(
    typeof rule2.stored,
    "number",
    "rule2.stored must be a number",
  );
  assert.strictEqual(
    typeof rule2.recomputed,
    "number",
    "rule2.recomputed must be a number",
  );
  assert.strictEqual(
    typeof rule2.delta,
    "number",
    "rule2.delta must be a number",
  );
  assert.strictEqual(rule2.tolerance, 1e-9, "rule2.tolerance pinned at 1e-9");
});
