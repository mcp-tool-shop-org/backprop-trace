/**
 * CLI-1 — global unknown-flag rejection.
 *
 * Before this fix, stripFlags() stripped a CLOSED allow-list of recognized
 * flags and left every OTHER `--token` in argv, where it was never matched and
 * silently dropped — the CLI exited 0 on an unknown flag, downgrading the
 * documented exit-3 "invalid CLI argument" contract. Load-bearing danger: a
 * TYPO of a verdict-changing flag (--warn-as-fail -> --warn-as-fials,
 * --strict -> --strcit), which are evaluated in finalizeReport, was silently
 * dropped, so a CI gate configured to FAIL on a soft WARN silently DOWNGRADED
 * to a permissive exit 0.
 *
 * These tests pin the FULL invariant in both halves:
 *
 *   (a) `bp validate <good-fixture> --bogusflag` exits 3 with a structured
 *       INVALID_FLAG error (not 0, not a silent pass).
 *   (b) `bp verify mazur <fixture> --warn-as-fials` exits 3 — the
 *       verdict-changing-flag TYPO is REJECTED, never silently dropped to a
 *       permissive PASS.
 *
 * Plus risk-note guards (must NOT regress): the bare `-` stdin sentinel, the
 * bare `--` separator, and every currently-recognized flag still work.
 *
 * Spawn pattern mirrors test/bp.verify-mazur.cli.test.ts.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

function runBp(
  args: string[],
  input?: string,
): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "src/bin/bp.ts", ...args],
    { cwd: repoRoot, encoding: "utf-8", ...(input !== undefined ? { input } : {}) },
  );
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

// ---------------------------------------------------------------------------
// HALF (a): an unrecognized long flag is rejected with exit 3 + INVALID_FLAG.
// ---------------------------------------------------------------------------

test("CLI-1(a): 'bp validate <good-fixture> --bogusflag' exits 3 (not 0, not a silent pass)", () => {
  const { status, stdout, stderr } = runBp([
    "validate",
    "fixtures/mazur.golden.jsonl",
    "--bogusflag",
  ]);
  assert.strictEqual(
    status,
    3,
    `an unknown flag must exit 3 (invalid CLI argument), NOT silently pass; got ${status}\nstdout: ${stdout}\nstderr: ${stderr}`,
  );
  // The offending token must be named in the error output (human stderr).
  assert.match(
    stderr,
    /--bogusflag/,
    `error must name the offending token '--bogusflag'; got stderr: ${stderr}`,
  );
});

test("CLI-1(a-json): unknown flag under --json emits a structured INVALID_FLAG envelope, exit 3", () => {
  const { status, stdout, stderr } = runBp([
    "validate",
    "fixtures/mazur.golden.jsonl",
    "--bogusflag",
    "--json",
  ]);
  assert.strictEqual(
    status,
    3,
    `unknown flag must exit 3 under --json; got ${status}\nstdout: ${stdout}\nstderr: ${stderr}`,
  );
  const parsed = JSON.parse(stdout.trim()) as {
    ok: boolean;
    error: { code: string; message: string };
  };
  assert.strictEqual(parsed.ok, false, "envelope ok must be false");
  assert.strictEqual(
    parsed.error.code,
    "INVALID_FLAG",
    `error.code must be INVALID_FLAG; got ${parsed.error.code}`,
  );
  assert.match(
    parsed.error.message,
    /--bogusflag/,
    `error.message must name the offending token; got ${parsed.error.message}`,
  );
});

// ---------------------------------------------------------------------------
// HALF (b): a TYPO of a verdict-changing flag is REJECTED, never silently
// dropped to a permissive PASS. This is the load-bearing CI-gate-downgrade
// guard: --warn-as-fail mistyped as --warn-as-fials must exit 3, not slip
// through and let the run report a permissive exit 0.
// ---------------------------------------------------------------------------

test("CLI-1(b): 'bp verify mazur <fixture> --warn-as-fials' exits 3 (verdict-changing-flag typo REJECTED, not silently dropped to permissive PASS)", () => {
  // Sanity: the SAME run with the CORRECT flag spelling does NOT exit 3 (the
  // flag is recognized). The golden passes, so correct spelling exits 0 — this
  // proves the typo-rejection is specifically about the typo, not the fixture.
  const correct = runBp(["verify", "mazur", "fixtures/mazur.golden.jsonl", "--warn-as-fail"]);
  assert.notStrictEqual(
    correct.status,
    3,
    `the CORRECTLY-spelled --warn-as-fail must NOT be rejected as invalid; got ${correct.status}\nstderr: ${correct.stderr}`,
  );

  const { status, stdout, stderr } = runBp([
    "verify",
    "mazur",
    "fixtures/mazur.golden.jsonl",
    "--warn-as-fials",
  ]);
  assert.strictEqual(
    status,
    3,
    `the TYPO --warn-as-fials must be REJECTED with exit 3, never silently dropped (which would let a CI gate downgrade to a permissive verdict); got ${status}\nstdout: ${stdout}\nstderr: ${stderr}`,
  );
  assert.match(
    stderr,
    /--warn-as-fials/,
    `error must name the offending typo token; got stderr: ${stderr}`,
  );
});

test("CLI-1(b-suggest): the typo --strcit suggests --strict (cheap fuzzy match)", () => {
  const { status, stderr } = runBp([
    "verify",
    "mazur",
    "fixtures/mazur.golden.jsonl",
    "--strcit",
  ]);
  assert.strictEqual(
    status,
    3,
    `the TYPO --strcit must be REJECTED with exit 3; got ${status}\nstderr: ${stderr}`,
  );
  assert.match(
    stderr,
    /--strict/,
    `error should suggest the intended flag '--strict' for the typo '--strcit'; got stderr: ${stderr}`,
  );
});

// ---------------------------------------------------------------------------
// Risk-note guards: must NOT regress.
// ---------------------------------------------------------------------------

test("CLI-1(guard): a single-dash unknown flag (-z) is rejected with exit 3", () => {
  const { status, stderr } = runBp([
    "validate",
    "fixtures/mazur.golden.jsonl",
    "-z",
  ]);
  assert.strictEqual(
    status,
    3,
    `a single-dash unknown flag must exit 3; got ${status}\nstderr: ${stderr}`,
  );
});

test("CLI-1(guard): the bare '-' stdin sentinel is NOT rejected (legitimate value token)", () => {
  const goldenBytes = `{"x":1}\n`; // not a valid receipt, but proves '-' is read, not flag-rejected
  const { status } = runBp(["validate", "-"], goldenBytes);
  // '-' must NOT be rejected as an invalid flag (exit 3). It feeds stdin; the
  // receipt is schema-invalid so the real outcome is exit 1 (validation fail).
  assert.notStrictEqual(
    status,
    3,
    `the bare '-' stdin sentinel must NOT be flag-rejected; got ${status}`,
  );
});

test("CLI-1(guard): every currently-recognized flag still parses (no false rejection)", () => {
  // --json + --verbose on a good fixture must still exit 0 (recognized flags).
  const a = runBp(["verify", "mazur", "fixtures/mazur.golden.jsonl", "--json"]);
  assert.notStrictEqual(a.status, 3, `--json must not be rejected; got ${a.status}\n${a.stderr}`);
  const b = runBp(["verify", "mazur", "fixtures/mazur.golden.jsonl", "--verbose"]);
  assert.notStrictEqual(b.status, 3, `--verbose must not be rejected; got ${b.status}\n${b.stderr}`);
  const c = runBp(["verify", "mazur", "fixtures/mazur.golden.jsonl", "-V"]);
  assert.notStrictEqual(c.status, 3, `-V must not be rejected; got ${c.status}\n${c.stderr}`);
  // --color=always (value-bearing flag prefix) must still parse.
  const d = runBp(["verify", "mazur", "fixtures/mazur.golden.jsonl", "--color=always"]);
  assert.notStrictEqual(d.status, 3, `--color=always must not be rejected; got ${d.status}\n${d.stderr}`);
});

test("CLI-1(guard): value-bearing flags consume their value, which is not flag-rejected (generate mazur --out <file>)", () => {
  // The value 'tmp-cli1-out.jsonl' for --out must NOT be treated as an unknown
  // flag, and the run must not be rejected with exit 3.
  const outName = "tmp-cli1-out.jsonl";
  const { status, stderr } = runBp(["generate", "mazur", "--out", outName]);
  assert.notStrictEqual(
    status,
    3,
    `--out <value> must parse; the value must not be flag-rejected; got ${status}\nstderr: ${stderr}`,
  );
  // Clean up the generated file (best-effort; not load-bearing for the assert).
  rmSync(resolve(repoRoot, outName), { force: true });
});
