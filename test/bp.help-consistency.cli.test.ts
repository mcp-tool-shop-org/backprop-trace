/**
 * cli-stageb-001 — verb-level --help/-h consistency across ALL 8 verbs.
 *
 * Before this fix, --help/-h was handled inconsistently: import / examples /
 * validate / validate-input honored --help at the VERB level (printing usage +
 * exit 0), but reconcile / verify / generate / scaffold did NOT — so
 * `bp reconcile --help` fell through to an "unknown subcommand" error (exit 2)
 * instead of printing usage.
 *
 * This test pins the standardized contract: EVERY verb (and the verb+subnoun
 * forms that already worked) responds to --help AND -h by printing its usage
 * text to stdout and exiting 0, writing nothing to stderr.
 *
 * Uses child_process.spawnSync + tsx to invoke the source CLI directly (no
 * build required). Mirrors test/bp.cli.help-version.test.ts.
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

// The 8 public verbs. Each must respond to a bare `<verb> --help` with usage +
// exit 0. `usageHint` is a substring that the printed usage MUST contain so we
// confirm it's REAL usage text (not an empty stdout that merely exits 0).
const VERBS: Array<{ verb: string; usageHint: RegExp }> = [
  { verb: "reconcile", usageHint: /reconcile receipt/i },
  { verb: "verify", usageHint: /verify (mazur|general|multi)/i },
  { verb: "generate", usageHint: /generate (mazur|xor|iris|from-config)/i },
  { verb: "validate", usageHint: /validate/i },
  { verb: "scaffold", usageHint: /scaffold topology/i },
  { verb: "validate-input", usageHint: /validate-input/i },
  { verb: "import", usageHint: /import/i },
  { verb: "examples", usageHint: /examples/i },
];

for (const { verb, usageHint } of VERBS) {
  test(`bp ${verb} --help prints usage to stdout and exits 0`, () => {
    const { status, stdout, stderr } = runBp([verb, "--help"]);
    assert.strictEqual(
      status,
      0,
      `'bp ${verb} --help' must exit 0 (got ${status}); stderr=${JSON.stringify(stderr)}`,
    );
    assert.strictEqual(
      stderr,
      "",
      `'bp ${verb} --help' must not write to stderr; got ${JSON.stringify(stderr)}`,
    );
    assert.match(
      stdout,
      /usage/i,
      `'bp ${verb} --help' must print a USAGE section; got ${JSON.stringify(stdout.slice(0, 200))}`,
    );
    assert.match(
      stdout,
      usageHint,
      `'bp ${verb} --help' usage must reference the verb's own surface (${usageHint}); got ${JSON.stringify(stdout.slice(0, 300))}`,
    );
  });

  test(`bp ${verb} -h (short form) prints usage to stdout and exits 0`, () => {
    const { status, stdout, stderr } = runBp([verb, "-h"]);
    assert.strictEqual(
      status,
      0,
      `'bp ${verb} -h' must exit 0 (got ${status}); stderr=${JSON.stringify(stderr)}`,
    );
    assert.strictEqual(
      stderr,
      "",
      `'bp ${verb} -h' must not write to stderr; got ${JSON.stringify(stderr)}`,
    );
    assert.match(
      stdout,
      /usage/i,
      `'bp ${verb} -h' must print a USAGE section; got ${JSON.stringify(stdout.slice(0, 200))}`,
    );
  });
}

// =============================================================================
// Regression guard: the verb+subnoun forms that ALREADY honored --help must
// keep working (no behavior change for them).
// =============================================================================

const SUBNOUN_FORMS: string[][] = [
  ["reconcile", "receipt", "--help"],
  ["verify", "mazur", "--help"],
  ["verify", "general", "--help"],
  ["verify", "multi", "--help"],
  ["generate", "mazur", "--help"],
  ["generate", "xor", "--help"],
  ["generate", "iris", "--help"],
  ["generate", "from-config", "--help"],
  ["scaffold", "topology", "--help"],
  ["import", "pytorch", "--help"],
  ["examples", "pytorch", "--help"],
];

for (const form of SUBNOUN_FORMS) {
  test(`bp ${form.join(" ")} still prints usage and exits 0 (regression guard)`, () => {
    const { status, stdout, stderr } = runBp(form);
    assert.strictEqual(
      status,
      0,
      `'bp ${form.join(" ")}' must exit 0 (got ${status}); stderr=${JSON.stringify(stderr)}`,
    );
    assert.strictEqual(
      stderr,
      "",
      `'bp ${form.join(" ")}' must not write to stderr; got ${JSON.stringify(stderr)}`,
    );
    assert.match(
      stdout,
      /usage/i,
      `'bp ${form.join(" ")}' must print a USAGE section; got ${JSON.stringify(stdout.slice(0, 200))}`,
    );
  });
}
