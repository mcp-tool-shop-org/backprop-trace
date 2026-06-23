/**
 * FT-C-001 `bp verify mazur` CLI tests.
 *
 * Pins the full-gate verifier composition (schema + reconcile + engine-
 * reproduce + byte-equal + fixture_status + published-anchor drift):
 *
 *   1. `bp verify mazur` (no file) defaults to fixtures/mazur.golden.jsonl
 *      and exits 0 (overall pass, or WARN-overall if soft-drift fires).
 *   2. `bp verify mazur <golden>` is the explicit equivalent.
 *   3. `bp verify mazur <bad fixture>` exits 1 (reconcile failure).
 *   4. `bp verify mazur --json` writes a structured envelope to stdout.
 *   5. `bp verify mazur --warn-as-fail` flips a WARN-only run to exit 1.
 *
 * Mirrors the spawn pattern used by test/reconcile.bad-gradient.cli.test.ts.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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

test("bp verify mazur (default fixture) exits 0", () => {
  const { status, stdout, stderr } = runBp(["verify", "mazur"]);
  assert.strictEqual(
    status,
    0,
    `bp verify mazur (default fixture) must exit 0; got ${status}\nstdout: ${stdout}\nstderr: ${stderr}`,
  );
});

test("bp verify mazur fixtures/mazur.golden.jsonl exits 0", () => {
  const { status, stdout, stderr } = runBp([
    "verify",
    "mazur",
    "fixtures/mazur.golden.jsonl",
  ]);
  assert.strictEqual(
    status,
    0,
    `bp verify mazur <golden> must exit 0; got ${status}\nstdout: ${stdout}\nstderr: ${stderr}`,
  );
});

test("bp verify mazur on bad-gradient fixture exits 1 (reconcile failure)", () => {
  const { status, stderr } = runBp([
    "verify",
    "mazur",
    "fixtures/bad/mazur.bad-gradient.jsonl",
  ]);
  assert.strictEqual(
    status,
    1,
    `bp verify mazur <bad> must exit 1; got ${status}\nstderr: ${stderr}`,
  );
});

test("TST-2: bad-gradient verify pins the FAILURE-PRIORITY rule (reconcile FAIL names Rule 4 AND lifecycle did not shadow the math failure)", () => {
  // docs/reconciliation.md 'Failure-priority rule': a math error in a draft
  // fixture must surface as a MATH error (Rule 4 on w5), NOT a lifecycle
  // 'draft not promoted' verdict. The fixture carries BOTH a deliberate Rule 4
  // corruption AND lifecycle markers
  // (verification_state=expected_to_fail_reconciliation,
  // post_update_forward.status=pending_engine_first_run). An anti-circularity
  // inversion that reported lifecycle before/instead of the Rule 4 math would
  // stay green under a status-only assertion. Pin BOTH halves at the
  // pipeline level via the structured --json report.
  const { status, stdout, stderr } = runBp([
    "verify",
    "mazur",
    "fixtures/bad/mazur.bad-gradient.jsonl",
    "--json",
  ]);
  assert.strictEqual(
    status,
    1,
    `bad-gradient verify must exit 1; got ${status}\nstderr: ${stderr}`,
  );
  const parsed = JSON.parse(stdout.trim()) as {
    ok: boolean;
    report: {
      overall: string;
      checks: Array<{ name: string; status: string; message?: string; evidence?: unknown }>;
    };
  };
  const reconcileCheck = parsed.report.checks.find((c) => c.name === "reconcile");
  // (a) the reconcile check has status 'fail' and its detail names Rule 4.
  assert.ok(reconcileCheck, `report must carry a 'reconcile' check; got: ${stdout}`);
  assert.strictEqual(
    reconcileCheck.status,
    "fail",
    `the reconcile check must FAIL on the math error (not pass/skip); got ${reconcileCheck.status}`,
  );
  // Rule 4 must be the named math failure — assert against the structured
  // evidence (the ReconciliationFailure[] array) so the pin is on the actual
  // surfaced rule numbers, not incidental message wording.
  const failures = (reconcileCheck.evidence ?? []) as Array<{ rule: number; parameter_id?: string }>;
  assert.ok(
    Array.isArray(failures) && failures.length > 0,
    `reconcile evidence must be a non-empty ReconciliationFailure[]; got: ${JSON.stringify(reconcileCheck.evidence)}`,
  );
  assert.ok(
    failures.some((f) => f.rule === 4),
    `the reconcile failure must name Rule 4 (the deliberate w5 gradient corruption); got rules: ${failures.map((f) => f.rule).join(", ")}`,
  );
  // (b) lifecycle / fixture_status did NOT shadow or pre-empt the math failure:
  // the fixture-status check, if present, must NOT be the FAIL that carries the
  // verdict (it should pass — the enum values are valid), and there must be NO
  // lifecycle 'draft not promoted' / 'not promoted' verdict anywhere that
  // replaced the math FAIL. The Rule 4 math failure above is what makes overall
  // 'fail'.
  const fixtureStatusCheck = parsed.report.checks.find((c) => c.name === "fixture-status");
  if (fixtureStatusCheck) {
    assert.notStrictEqual(
      fixtureStatusCheck.status,
      "fail",
      `fixture-status must NOT pre-empt the math failure with its own FAIL (failure-priority inversion); got status ${fixtureStatusCheck.status}, message ${fixtureStatusCheck.message}`,
    );
  }
  // No check may report a lifecycle 'not promoted' verdict in lieu of the math
  // error — that is exactly the inversion the failure-priority rule forbids.
  for (const c of parsed.report.checks) {
    assert.doesNotMatch(
      c.message ?? "",
      /not promoted|draft not/i,
      `no check may surface a lifecycle 'not promoted' verdict shadowing the Rule 4 math failure; offending check ${c.name}: ${c.message}`,
    );
  }
});

test("TST-4: engine-reproduce detail on a corrupted receipt is user-readable (no raw V8 TypeError) AND verdict is still fail", () => {
  // 'bp verify mazur fixtures/bad/mazur.bad-gradient.jsonl --json' historically
  // surfaced the engine-reproduce check detail as the raw V8 TypeError "Cannot
  // read properties of undefined (reading 'net')" — a raw stack leaking into a
  // structured check detail (no-raw-stacks discipline). The recompute must be
  // wrapped (like reconcileReceipt's core-B-002 conversion) so a corrupted
  // receipt yields a diagnosable detail, while the overall verdict stays 'fail'.
  const { status, stdout, stderr } = runBp([
    "verify",
    "mazur",
    "fixtures/bad/mazur.bad-gradient.jsonl",
    "--json",
  ]);
  assert.strictEqual(
    status,
    1,
    `corrupted receipt verify must still exit 1; got ${status}\nstderr: ${stderr}`,
  );
  const parsed = JSON.parse(stdout.trim()) as {
    report: { overall: string; checks: Array<{ name: string; status: string; message?: string }> };
  };
  // (b) overall verdict is still fail.
  assert.strictEqual(
    parsed.report.overall,
    "fail",
    `overall verdict must remain 'fail'; got ${parsed.report.overall}`,
  );
  const engineCheck = parsed.report.checks.find((c) => c.name === "engine-reproduce");
  assert.ok(engineCheck, `report must carry an 'engine-reproduce' check; got: ${stdout}`);
  // (a) the engine-reproduce detail is user-readable — no raw V8 TypeError text,
  // no node internals leaking.
  assert.doesNotMatch(
    engineCheck.message ?? "",
    /Cannot read properties|node:internal/,
    `engine-reproduce detail must be user-readable (no raw V8 TypeError / node internals); got: ${engineCheck.message}`,
  );
  // It should still be a meaningful diagnostic (non-empty) so the operator can
  // act on it.
  assert.ok(
    (engineCheck.message ?? "").length > 0,
    `engine-reproduce detail must be a non-empty diagnostic; got: ${JSON.stringify(engineCheck.message)}`,
  );
});

test("bp verify mazur --json emits a JSON envelope with overall + checks[]", () => {
  const { status, stdout, stderr } = runBp(["verify", "mazur", "--json"]);
  assert.ok(
    status === 0 || status === 1,
    `--json must exit 0 or 1; got ${status}\nstderr: ${stderr}\nstdout: ${stdout}`,
  );
  // Stderr is suppressed under --json.
  assert.strictEqual(
    stderr,
    "",
    `--json must suppress stderr; got: ${JSON.stringify(stderr)}`,
  );
  const parsed = JSON.parse(stdout.trim()) as {
    ok: boolean;
    report: { overall: string; checks: Array<{ name: string; status: string }> };
  };
  assert.strictEqual(
    typeof parsed.ok,
    "boolean",
    "envelope must carry an ok flag",
  );
  assert.ok(
    parsed.report && typeof parsed.report === "object",
    `envelope must carry a report object; got: ${JSON.stringify(parsed)}`,
  );
  assert.ok(
    ["pass", "warn", "fail"].includes(parsed.report.overall),
    `report.overall must be one of pass|warn|fail; got: ${parsed.report.overall}`,
  );
  assert.ok(
    Array.isArray(parsed.report.checks) && parsed.report.checks.length >= 1,
    `report.checks[] must be a non-empty array; got: ${JSON.stringify(parsed.report)}`,
  );
  // Each check must carry name + status.
  for (const c of parsed.report.checks) {
    assert.strictEqual(typeof c.name, "string", "check.name is a string");
    assert.ok(
      ["pass", "fail", "warn", "skip"].includes(c.status),
      `check.status must be pass|fail|warn|skip; got: ${c.status}`,
    );
  }
});

test("bp verify mazur --warn-as-fail flips WARN-overall to exit 1 when a soft-drift WARN is present", () => {
  // Run --json first to discover the overall verdict; if it's already WARN
  // (likely on this fixture since published-drift is documented as a
  // soft-gate WARN), then --warn-as-fail must turn the same run into a 1.
  const baseline = runBp(["verify", "mazur", "--json"]);
  const baselineParsed = JSON.parse(baseline.stdout.trim()) as {
    report: { overall: string };
  };
  if (baselineParsed.report.overall !== "warn") {
    // If no WARN fires on this rig (e.g. published-anchor file moved or
    // claims removed), there's nothing for --warn-as-fail to flip. Skip
    // rather than fail — this test only meaningfully runs when WARN is
    // actually present.
    return;
  }

  const { status } = runBp(["verify", "mazur", "--warn-as-fail"]);
  assert.strictEqual(
    status,
    1,
    `with WARN present and --warn-as-fail, exit must be 1; got ${status}`,
  );
});
