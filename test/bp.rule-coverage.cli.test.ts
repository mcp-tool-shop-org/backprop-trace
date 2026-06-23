/**
 * PH-ENG-02 — rule-coverage transparency.
 *
 * ~14 of the 26 documented reconciliation rules are GATED: they fire only when
 * their feature block is present (softmax outputs, a dual_form, a batch, an Adam
 * optimizer, observer-import markers, a multi-step bundle, …). Before this fix,
 * a user reading a green PASS could not tell which substantive rules actually
 * RAN from those that silently no-op'd because their feature was absent.
 *
 * reconcileReceipt / reconcileMultiStep now carry an ADDITIVE, machine-readable
 * coverage partition (rules_evaluated / gated_off) over the rule set 1..26, and
 * `bp verify ... --json` surfaces it on the report; `--verbose` renders a
 * human-readable "rules evaluated: N/26 (gated off, feature absent: …)" line.
 *
 * This test pins:
 *   1. --json verify carries machine-readable rules_evaluated[] + gated_off[].
 *   2. The two arrays PARTITION 1..26 (disjoint union == full set).
 *   3. A THIN SGD receipt reports FEWER evaluated rules than a RICH
 *      softmax+CE (+observer) receipt — the coverage actually discriminates.
 *   4. The gated set is correct: softmax fires Rule 11; a non-softmax sigmoid
 *      receipt gates Rule 11 off. An observer-import receipt fires Rule 14; an
 *      engine-authored one gates 14 off.
 *   5. --verbose prints the human coverage line; non-verbose omits it (concise).
 *   6. Multi-step bundle coverage adds the cross-record rules (9, 10).
 *
 * Uses child_process.spawnSync + tsx. Mirrors test/bp.cli.help-version.test.ts.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

function runBp(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "src/bin/bp.ts", ...args],
    { cwd: repoRoot, encoding: "utf-8" },
  );
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

type VerifyEnvelope = {
  ok: boolean;
  report: {
    overall: string;
    rules_evaluated?: number[];
    gated_off?: number[];
  };
};

function verifyGeneralJson(fixture: string): VerifyEnvelope {
  const { stdout } = runBp(["verify", "general", fixture, "--json"]);
  return JSON.parse(stdout.trim()) as VerifyEnvelope;
}

const FULL_RULE_SET = Array.from({ length: 26 }, (_, i) => i + 1);

function assertPartition(evaluated: number[], gatedOff: number[], label: string): void {
  // Disjoint.
  const ev = new Set(evaluated);
  for (const g of gatedOff) {
    assert.ok(!ev.has(g), `${label}: rule ${g} is in BOTH evaluated and gated_off (must be disjoint)`);
  }
  // Union == {1..26}.
  const union = new Set([...evaluated, ...gatedOff]);
  assert.strictEqual(
    union.size,
    26,
    `${label}: rules_evaluated ∪ gated_off must be exactly the 26 rules (got ${union.size}); evaluated=${JSON.stringify(evaluated)} gated=${JSON.stringify(gatedOff)}`,
  );
  for (const n of FULL_RULE_SET) {
    assert.ok(union.has(n), `${label}: rule ${n} missing from the coverage partition`);
  }
}

// =============================================================================
// 1-2. --json carries the arrays AND they partition 1..26 (thin SGD receipt).
// =============================================================================

test("PH-ENG-02: bp verify mazur --json carries rules_evaluated + gated_off partitioning 1..26", () => {
  const { stdout, status } = runBp(["verify", "mazur", "--json"]);
  assert.strictEqual(status, 0, "verify mazur must pass");
  const env = JSON.parse(stdout.trim()) as VerifyEnvelope;
  assert.ok(Array.isArray(env.report.rules_evaluated), "report must carry rules_evaluated[]");
  assert.ok(Array.isArray(env.report.gated_off), "report must carry gated_off[]");
  assertPartition(env.report.rules_evaluated!, env.report.gated_off!, "verify mazur");
});

// =============================================================================
// 3. Thin SGD (mazur: sigmoid, half_squared_error, SGD, engine-authored) reports
//    FEWER evaluated rules than rich softmax+CE.
// =============================================================================

test("PH-ENG-02: a thin SGD receipt evaluates fewer rules than a rich softmax+CE receipt", () => {
  const { stdout: mazurOut } = runBp(["verify", "mazur", "--json"]);
  const mazur = JSON.parse(mazurOut.trim()) as VerifyEnvelope;

  const softmax = verifyGeneralJson("fixtures/softmax-ce.golden.jsonl");

  const thinCount = mazur.report.rules_evaluated!.length;
  const richCount = softmax.report.rules_evaluated!.length;
  assert.ok(
    thinCount < richCount,
    `thin SGD (${thinCount} rules) must evaluate FEWER rules than rich softmax+CE (${richCount}); ` +
      `thin=${JSON.stringify(mazur.report.rules_evaluated)} rich=${JSON.stringify(softmax.report.rules_evaluated)}`,
  );

  // The thin SGD receipt's evaluated set is the core (1-8) + loss formula (12).
  assert.deepStrictEqual(
    mazur.report.rules_evaluated,
    [1, 2, 3, 4, 5, 6, 7, 8, 12],
    `thin SGD coverage must be the core rules 1-8 + Rule 12 (loss formula); got ${JSON.stringify(mazur.report.rules_evaluated)}`,
  );
});

// =============================================================================
// 4. Gated set correctness: softmax fires Rule 11 + 13; mazur (sigmoid) gates
//    both off.
// =============================================================================

test("PH-ENG-02: softmax receipt EVALUATES Rule 11 (normalization) + Rule 13 (dual_form)", () => {
  const softmax = verifyGeneralJson("fixtures/softmax-ce.golden.jsonl");
  assert.ok(
    softmax.report.rules_evaluated!.includes(11),
    `softmax receipt must evaluate Rule 11; got ${JSON.stringify(softmax.report.rules_evaluated)}`,
  );
  assert.ok(
    softmax.report.rules_evaluated!.includes(13),
    `softmax+CE receipt (dual_form present) must evaluate Rule 13; got ${JSON.stringify(softmax.report.rules_evaluated)}`,
  );
});

test("PH-ENG-02: sigmoid SGD receipt GATES OFF Rule 11 (no softmax) and Rule 13 (no dual_form)", () => {
  const { stdout } = runBp(["verify", "mazur", "--json"]);
  const mazur = JSON.parse(stdout.trim()) as VerifyEnvelope;
  assert.ok(
    mazur.report.gated_off!.includes(11),
    `sigmoid receipt must gate off Rule 11; got gated=${JSON.stringify(mazur.report.gated_off)}`,
  );
  assert.ok(
    mazur.report.gated_off!.includes(13),
    `receipt without dual_form must gate off Rule 13; got gated=${JSON.stringify(mazur.report.gated_off)}`,
  );
});

test("PH-ENG-02: observer-import receipt EVALUATES Rule 14; engine-authored gates it off", () => {
  // Observer-mode (external_imported) receipt — Rule 14 (engine-recompute
  // differential) gate is satisfied.
  const observerFixture = "fixtures/external/jax.softmax-ce.golden.jsonl";
  if (existsSync(resolve(repoRoot, observerFixture))) {
    const obs = verifyGeneralJson(observerFixture);
    assert.ok(
      obs.report.rules_evaluated!.includes(14),
      `observer-import receipt must evaluate Rule 14; got ${JSON.stringify(obs.report.rules_evaluated)}`,
    );
  }
  // Engine-authored receipt — Rule 14 no-ops, so it is gated off.
  const { stdout } = runBp(["verify", "mazur", "--json"]);
  const mazur = JSON.parse(stdout.trim()) as VerifyEnvelope;
  assert.ok(
    mazur.report.gated_off!.includes(14),
    `engine-authored receipt must gate off Rule 14; got gated=${JSON.stringify(mazur.report.gated_off)}`,
  );
});

test("PH-ENG-02: Adam receipt EVALUATES the Adam-family rules 20, 22, 23, 24", () => {
  const adamFixture = "fixtures/external/pytorch.adam.golden.jsonl";
  if (!existsSync(resolve(repoRoot, adamFixture))) return; // fixture optional
  const adam = verifyGeneralJson(adamFixture);
  for (const rule of [20, 22, 23, 24]) {
    assert.ok(
      adam.report.rules_evaluated!.includes(rule),
      `Adam receipt must evaluate Rule ${rule}; got ${JSON.stringify(adam.report.rules_evaluated)}`,
    );
  }
});

// =============================================================================
// 5. --verbose prints the human coverage line; non-verbose omits it.
// =============================================================================

test("PH-ENG-02: --verbose prints a human 'rules evaluated: N/26' coverage line", () => {
  const { stderr, status } = runBp(["verify", "mazur", "--verbose"]);
  assert.strictEqual(status, 0, "verify mazur --verbose must pass");
  assert.match(
    stderr,
    /rules evaluated:\s*9\/26/,
    `--verbose must render the coverage line 'rules evaluated: 9/26'; got stderr=${JSON.stringify(stderr.slice(-400))}`,
  );
  assert.match(
    stderr,
    /gated off, feature absent:/,
    `--verbose coverage line must name the gated-off feature-absent rules; got stderr=${JSON.stringify(stderr.slice(-400))}`,
  );
});

test("PH-ENG-02: non-verbose verify output does NOT print the coverage line (stays concise)", () => {
  const { stderr } = runBp(["verify", "mazur"]);
  assert.doesNotMatch(
    stderr,
    /rules evaluated:/,
    `non-verbose verify must NOT print the coverage line; got stderr=${JSON.stringify(stderr.slice(-400))}`,
  );
});

// =============================================================================
// 6. Multi-step bundle coverage adds the cross-record rules (9, 10).
// =============================================================================

test("PH-ENG-02: verify multi --json bundle coverage adds cross-record rules 9 + 10", () => {
  const multiFixture = "fixtures/xor.multi-step.jsonl";
  if (!existsSync(resolve(repoRoot, multiFixture))) return; // fixture optional
  const { stdout, status } = runBp(["verify", "multi", multiFixture, "--json"]);
  assert.strictEqual(status, 0, `verify multi must pass; got status ${status}`);
  const env = JSON.parse(stdout.trim()) as VerifyEnvelope;
  assert.ok(Array.isArray(env.report.rules_evaluated), "multi report must carry rules_evaluated[]");
  assert.ok(Array.isArray(env.report.gated_off), "multi report must carry gated_off[]");
  assertPartition(env.report.rules_evaluated!, env.report.gated_off!, "verify multi");
  for (const rule of [9, 10]) {
    assert.ok(
      env.report.rules_evaluated!.includes(rule),
      `multi-step bundle must evaluate cross-record Rule ${rule}; got ${JSON.stringify(env.report.rules_evaluated)}`,
    );
  }
});

// =============================================================================
// ING-B-004 — Rule-14 differential disagreement detail.
//
// To tell a REAL tamper from benign FP/Node drift, the operator needs the two
// underlying values behind a delta: the receipt's CLAIMED value (stored) and
// the engine's RECOMPUTED value. Pin that the --json Rule-14 disagreement
// carries stored + recomputed + delta + tolerance for every disagreeing field,
// and that the human render shows the same.
// =============================================================================

const TAMPER_FIXTURE = "fixtures/external/external.rule14-only-bias-divergence.jsonl";

test("ING-B-004: --json Rule-14 disagreement carries stored + recomputed + delta + tolerance", () => {
  if (!existsSync(resolve(repoRoot, TAMPER_FIXTURE))) return; // fixture optional
  const { stdout, status } = runBp(["verify", "general", TAMPER_FIXTURE, "--json"]);
  assert.strictEqual(status, 1, `tampered observer receipt must FAIL verification (status 1); got ${status}`);
  const env = JSON.parse(stdout.trim()) as {
    report: {
      checks: Array<{
        name: string;
        evidence?: Array<{
          rule: number;
          field_path: string;
          stored: number;
          recomputed: number;
          delta: number;
          tolerance: number;
        }>;
      }>;
    };
  };
  const reconcile = env.report.checks.find((c) => c.name === "reconcile");
  assert.ok(reconcile?.evidence, "reconcile check must carry a failures evidence array");
  const rule14 = reconcile!.evidence!.filter((f) => f.rule === 14);
  assert.ok(
    rule14.length > 0,
    `tampered observer receipt must produce at least one Rule-14 disagreement; got ${JSON.stringify(reconcile!.evidence)}`,
  );
  for (const f of rule14) {
    // The four diagnostic fields a user needs to tell tamper from drift.
    assert.strictEqual(typeof f.stored, "number", `Rule-14 disagreement at ${f.field_path} must carry numeric 'stored' (receipt-claimed)`);
    assert.strictEqual(typeof f.recomputed, "number", `Rule-14 disagreement at ${f.field_path} must carry numeric 'recomputed' (engine)`);
    assert.strictEqual(typeof f.delta, "number", `Rule-14 disagreement at ${f.field_path} must carry numeric 'delta'`);
    assert.strictEqual(typeof f.tolerance, "number", `Rule-14 disagreement at ${f.field_path} must carry numeric 'tolerance'`);
    // stored and recomputed must actually differ for a disagreement (the whole
    // point — a user can see the two values that produced the delta).
    assert.notStrictEqual(
      f.stored,
      f.recomputed,
      `a Rule-14 DISAGREEMENT at ${f.field_path} must show distinct stored vs recomputed values`,
    );
  }
});

test("ING-B-004: human verify render exposes stored + recomputed for a Rule-14 disagreement", () => {
  if (!existsSync(resolve(repoRoot, TAMPER_FIXTURE))) return; // fixture optional
  const { stderr } = runBp(["verify", "general", TAMPER_FIXTURE]);
  assert.match(stderr, /"rule":\s*14/, "human render evidence must include a Rule-14 failure");
  assert.match(stderr, /"stored":/, "human render must show the receipt-claimed 'stored' value");
  assert.match(stderr, /"recomputed":/, "human render must show the engine 'recomputed' value");
});
