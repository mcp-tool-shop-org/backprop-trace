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
