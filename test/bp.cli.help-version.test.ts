/**
 * CLI help / version / --json end-to-end test.
 *
 * Pins the public CLI surface so a future refactor (e.g. switching to a
 * framework, changing the help format, dropping --json) breaks loudly.
 *
 * Covers:
 *   1. `bp --version` prints exactly `<version>\n` to stdout, exit 0.
 *      Version is read dynamically from package.json so the test never
 *      drifts when the version bumps.
 *   2. `bp --help` prints text containing "USAGE", "bp reconcile receipt",
 *      "Exit codes" — exit 0.
 *   3. `bp` (no args) prints help text — exit 0 (help is a normal
 *      outcome, not an error).
 *   4. `bp reconcile receipt --help` prints subcommand help — exit 0.
 *   5. `bp --json reconcile receipt fixtures/mazur.golden.jsonl`
 *      prints `{"ok":true}\n` to stdout — exit 0.
 *   6. `bp --json reconcile receipt fixtures/bad/mazur.bad-gradient.jsonl`
 *      prints JSON with `"ok":false` to stdout — exit 1.
 *
 * Uses child_process.spawnSync + tsx to invoke the source CLI directly
 * (no build required). Mirrors the pattern in
 * test/reconcile.bad-gradient.cli.test.ts.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const packageJsonPath = resolve(repoRoot, "package.json");

function runBp(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "src/bin/bp.ts", ...args],
    { cwd: repoRoot, encoding: "utf-8" },
  );
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function readPackageVersion(): string {
  const pkg = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as {
    version: string;
  };
  return pkg.version;
}

// =============================================================================
// 1. bp --version
// =============================================================================

test("bp --version prints exactly <version>\\n to stdout and exits 0", () => {
  const version = readPackageVersion();
  const { status, stdout, stderr } = runBp(["--version"]);
  assert.strictEqual(status, 0, `bp --version must exit 0 (got ${status}); stderr=${JSON.stringify(stderr)}`);
  assert.strictEqual(
    stdout,
    `${version}\n`,
    `bp --version must print exactly '${version}\\n' (got ${JSON.stringify(stdout)})`,
  );
  assert.strictEqual(stderr, "", "bp --version must not write to stderr");
});

test("bp -v prints exactly <version>\\n to stdout and exits 0 (short form)", () => {
  const version = readPackageVersion();
  const { status, stdout, stderr } = runBp(["-v"]);
  assert.strictEqual(status, 0, `bp -v must exit 0 (got ${status}); stderr=${JSON.stringify(stderr)}`);
  assert.strictEqual(
    stdout,
    `${version}\n`,
    `bp -v must print exactly '${version}\\n' (got ${JSON.stringify(stdout)})`,
  );
  assert.strictEqual(stderr, "", "bp -v must not write to stderr");
});

// =============================================================================
// 2. bp --help (top-level)
// =============================================================================

test("bp --help prints text containing required sections and exits 0", () => {
  const { status, stdout, stderr } = runBp(["--help"]);
  assert.strictEqual(status, 0, `bp --help must exit 0 (got ${status})`);
  assert.strictEqual(stderr, "", "bp --help must not write to stderr");
  // Case-insensitive on USAGE because the agent may render as "Usage:" or
  // "USAGE" — both are acceptable for a top-level synopsis header.
  assert.match(
    stdout,
    /usage/i,
    "bp --help must contain a USAGE / Usage section",
  );
  assert.match(
    stdout,
    /bp reconcile receipt/,
    "bp --help must mention 'bp reconcile receipt' subcommand",
  );
  assert.match(
    stdout,
    /[Ee]xit codes/,
    "bp --help must document Exit codes",
  );
});

// =============================================================================
// 3. bp (no args)
// =============================================================================

test("bp (no args) prints help text to stdout and exits 0", () => {
  const { status, stdout, stderr } = runBp([]);
  assert.strictEqual(status, 0, `bp [no args] must exit 0 (got ${status})`);
  assert.strictEqual(stderr, "", "bp [no args] must not write to stderr");
  assert.match(stdout, /usage/i, "bp [no args] must print usage on stdout");
  assert.match(stdout, /bp reconcile receipt/, "bp [no args] must mention reconcile subcommand");
});

// =============================================================================
// 4. bp reconcile receipt --help (subcommand help)
// =============================================================================

test("bp reconcile receipt --help prints subcommand help and exits 0", () => {
  const { status, stdout, stderr } = runBp(["reconcile", "receipt", "--help"]);
  assert.strictEqual(status, 0, `subcommand --help must exit 0 (got ${status})`);
  assert.strictEqual(stderr, "", "subcommand --help must not write to stderr");
  assert.match(
    stdout,
    /reconcile receipt/i,
    "subcommand --help must mention 'reconcile receipt'",
  );
  assert.match(
    stdout,
    /[Ee]xit codes/,
    "subcommand --help must document Exit codes",
  );
});

// =============================================================================
// 5. bp --json reconcile receipt <good fixture> -> {"ok":true}
// =============================================================================

test(
  "bp --json reconcile receipt fixtures/mazur.golden.jsonl prints {\"ok\":true}\\n to stdout, exit 0",
  () => {
    const { status, stdout, stderr } = runBp([
      "--json",
      "reconcile",
      "receipt",
      "fixtures/mazur.golden.jsonl",
    ]);
    assert.strictEqual(
      status,
      0,
      `--json success must exit 0 (got ${status}); stderr=${JSON.stringify(stderr)}; stdout=${JSON.stringify(stdout)}`,
    );
    assert.strictEqual(
      stdout,
      `{"ok":true}\n`,
      `--json success must emit exactly '{"ok":true}\\n' to stdout; got ${JSON.stringify(stdout)}`,
    );
    assert.strictEqual(stderr, "", "--json success path must not write to stderr");
  },
);

// =============================================================================
// 6. bp --json reconcile receipt <bad fixture> -> {"ok":false, ...} exit 1
// =============================================================================

test(
  "bp --json reconcile receipt fixtures/bad/mazur.bad-gradient.jsonl prints JSON with ok:false, exit 1",
  () => {
    const { status, stdout, stderr } = runBp([
      "--json",
      "reconcile",
      "receipt",
      "fixtures/bad/mazur.bad-gradient.jsonl",
    ]);
    assert.strictEqual(
      status,
      1,
      `--json failure must exit 1 (got ${status}); stderr=${JSON.stringify(stderr)}; stdout=${JSON.stringify(stdout)}`,
    );
    // stdout must be a single line of JSON terminated with \n.
    assert.ok(
      stdout.endsWith("\n"),
      `--json failure stdout must end with LF; got ${JSON.stringify(stdout)}`,
    );
    // Stderr should be suppressed under --json so CI consumers can parse
    // stdout cleanly. Allow empty stderr only.
    assert.strictEqual(
      stderr,
      "",
      `--json failure must suppress stderr (got ${JSON.stringify(stderr)})`,
    );

    const parsed = JSON.parse(stdout.trim()) as {
      ok: boolean;
      failures?: Array<{ rule: number; parameter_id?: string; field_path: string }>;
    };
    assert.strictEqual(
      parsed.ok,
      false,
      `--json failure envelope must have ok:false; got ${JSON.stringify(parsed)}`,
    );
    assert.ok(
      Array.isArray(parsed.failures),
      `--json failure envelope must carry failures[]; got ${JSON.stringify(parsed)}`,
    );
    const rule4 = parsed.failures!.find((f) => f.rule === 4);
    assert.ok(
      rule4,
      `--json failure envelope must contain at least one Rule 4 failure; got ${JSON.stringify(parsed)}`,
    );
    assert.strictEqual(
      rule4!.parameter_id,
      "w5",
      `the bad-gradient fixture targets w5; failure must name it (got ${JSON.stringify(rule4)})`,
    );
  },
);

// =============================================================================
// 7. bp --json with non-existent file -> JSON error envelope, exit 2
// =============================================================================

test(
  "bp --json reconcile receipt <nonexistent file> emits JSON error envelope, exits 2",
  () => {
    const { status, stdout, stderr } = runBp([
      "--json",
      "reconcile",
      "receipt",
      "fixtures/this/file/does/not/exist.json",
    ]);
    assert.strictEqual(
      status,
      2,
      `--json missing-file must exit 2 (got ${status}); stderr=${JSON.stringify(stderr)}; stdout=${JSON.stringify(stdout)}`,
    );
    assert.strictEqual(
      stderr,
      "",
      "--json missing-file must suppress stderr (parseable stdout only)",
    );
    const parsed = JSON.parse(stdout.trim()) as {
      ok: boolean;
      error?: { code?: string; message?: string };
    };
    assert.strictEqual(
      parsed.ok,
      false,
      `--json missing-file envelope must have ok:false; got ${JSON.stringify(parsed)}`,
    );
    assert.ok(
      typeof parsed.error === "object" && parsed.error !== null,
      `--json missing-file envelope must carry an error object; got ${JSON.stringify(parsed)}`,
    );
  },
);

// =============================================================================
// 8. G-048 — help text must NOT understate the rule set with a stale count.
//
// The reconciler now implements rules 0-26, but the help strings used to say
// "the 16 rules" (top-level + receipt usage) and "the 8 rules" (verify usage).
// A hardcoded total drifts every time a rule is added. The fix uses neutral
// phrasing ("the reconciliation rules" / "the applicable reconciliation
// rules") and points at docs/reconciliation.md as the authoritative list.
//
// These tests pin the NEGATIVE invariant: the help surface must not advertise
// a specific stale total like "16 rules" / "8 rules". (We avoid asserting an
// exact current count so the test does not itself become a drift source the
// next time a rule lands.)
// =============================================================================

test("G-048: top-level --help does not advertise a stale fixed rule total", () => {
  const { status, stdout } = runBp(["--help"]);
  assert.strictEqual(status, 0, "bp --help must exit 0");
  assert.doesNotMatch(
    stdout,
    /\b16 rules\b/,
    `top-level help must not hardcode 'the 16 rules' (stale total); got: ${JSON.stringify(stdout)}`,
  );
  assert.doesNotMatch(
    stdout,
    /\b8 rules\b/,
    `top-level help must not hardcode 'the 8 rules' (stale total); got: ${JSON.stringify(stdout)}`,
  );
  // Positive: neutral phrasing is present somewhere in the surface.
  assert.match(
    stdout,
    /reconciliation rules/i,
    `top-level help should describe 'reconciliation rules' (neutral phrasing); got: ${JSON.stringify(stdout)}`,
  );
});

test("G-048: 'reconcile receipt --help' does not advertise a stale fixed rule total", () => {
  const { status, stdout } = runBp(["reconcile", "receipt", "--help"]);
  assert.strictEqual(status, 0, "subcommand --help must exit 0");
  assert.doesNotMatch(
    stdout,
    /\b16 rules\b/,
    `receipt usage must not hardcode 'the 16 rules' (stale total); got: ${JSON.stringify(stdout)}`,
  );
  assert.match(
    stdout,
    /reconciliation\s+rules/i,
    `receipt usage should describe 'reconciliation rules' (neutral phrasing); got: ${JSON.stringify(stdout)}`,
  );
});

test("G-048: 'verify mazur --help' does not advertise the stale '8 rules' total", () => {
  const { status, stdout } = runBp(["verify", "mazur", "--help"]);
  assert.strictEqual(status, 0, "verify mazur --help must exit 0");
  assert.doesNotMatch(
    stdout,
    /\b8 rules\b/,
    `verify usage must not hardcode 'the 8 rules' (stale total); got: ${JSON.stringify(stdout)}`,
  );
});

test("G-048: top-level --help header carries the LIVE package version, not a frozen one", () => {
  // The CLI synopsis header reads `bp — backprop-trace CLI v<version>`. Pin
  // that it reflects the current package.json version so the surface header
  // can never silently freeze at an old release (the same staleness class as
  // the removed 'v0.7.0 surface' source-comment marker). Read the version
  // dynamically so this test never drifts on a version bump.
  const version = readPackageVersion();
  const { status, stdout } = runBp(["--help"]);
  assert.strictEqual(status, 0, "bp --help must exit 0");
  assert.match(
    stdout,
    new RegExp(`backprop-trace CLI v${version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`),
    `help header must carry the live version v${version}; got prefix: ${JSON.stringify(stdout.slice(0, 120))}`,
  );
  // And must not have frozen at the historic v0.7.0 surface label.
  assert.doesNotMatch(
    stdout,
    /v0\.7\.0 surface/,
    `help output must not contain the stale 'v0.7.0 surface' marker`,
  );
});

// =============================================================================
// cli-B-004 — 'did you mean' must do real edit-distance matching (Damerau-
// Levenshtein), not prefix-only. A transposed/typo'd subcommand that is NOT a
// prefix of (or prefixed by) a real verb must still suggest the nearest verb.
// =============================================================================

test("cli-B-004: transposed 'recouncile' suggests 'reconcile'", () => {
  const { status, stderr, stdout } = runBp(["recouncile", "receipt", "x.json"]);
  // Unknown command → usage error, exit 2, suggestion on stderr.
  assert.strictEqual(status, 2, `unknown command must exit 2 (got ${status})`);
  const out = stderr + stdout;
  assert.match(
    out,
    /Did you mean 'bp reconcile receipt/,
    `'recouncile' must fuzzy-match to reconcile; got: ${JSON.stringify(out.slice(0, 200))}`,
  );
});

test("cli-B-004: typo'd 'verifu' suggests 'verify'", () => {
  const { status, stderr, stdout } = runBp(["verifu", "mazur"]);
  assert.strictEqual(status, 2);
  const out = stderr + stdout;
  assert.match(
    out,
    /Did you mean 'bp verify /,
    `'verifu' must fuzzy-match to verify; got: ${JSON.stringify(out.slice(0, 200))}`,
  );
});

test("cli-B-004: typo'd 'genrate' (transposition) suggests 'generate'", () => {
  const { status, stderr, stdout } = runBp(["genrate", "mazur"]);
  assert.strictEqual(status, 2);
  const out = stderr + stdout;
  assert.match(
    out,
    /Did you mean 'bp generate /,
    `'genrate' must fuzzy-match to generate; got: ${JSON.stringify(out.slice(0, 200))}`,
  );
});

test("cli-B-004: existing prefix behavior is preserved ('gen' → 'generate')", () => {
  // Regression guard: pass 1/2 (prefix) must still win for short prefixes so
  // the new edit-distance pass does not change established behavior.
  const { status, stderr, stdout } = runBp(["gen"]);
  assert.strictEqual(status, 2);
  const out = stderr + stdout;
  assert.match(out, /Did you mean 'bp generate /, `'gen' must still prefix-match generate; got: ${JSON.stringify(out.slice(0, 200))}`);
});

test("cli-B-004: a far-off garbage token does NOT force a misleading suggestion", () => {
  // The threshold must not collapse arbitrary input onto a verb. 'zzzzzzzz' is
  // beyond edit distance of every verb → no 'Did you mean', just the plain
  // unknown-command message.
  const { status, stderr, stdout } = runBp(["zzzzzzzz"]);
  assert.strictEqual(status, 2);
  const out = stderr + stdout;
  assert.doesNotMatch(
    out,
    /Did you mean/,
    `far-off garbage must not produce a suggestion; got: ${JSON.stringify(out.slice(0, 200))}`,
  );
  assert.match(out, /unknown command 'zzzzzzzz'/);
});

// =============================================================================
// cli-B-005 — exit-code-4 doc drift. Exit 4 is reserved and NEVER emitted by
// the current surface (all three framework adapters are implemented). The help
// must not advertise it as a live "declared but not implemented" outcome.
// =============================================================================

test("cli-B-005: top-level help does not advertise exit 4 as a live unimplemented-adapter outcome", () => {
  const { status, stdout } = runBp(["--help"]);
  assert.strictEqual(status, 0);
  // The stale wording read "4  reserved (framework adapter declared but not
  // implemented)" — implying it can occur. The corrected line must mark it as
  // not-emitted / reserved-only.
  assert.doesNotMatch(
    stdout,
    /4\s+reserved \(framework adapter declared but not implemented\)/,
    `top-level help must not advertise exit 4 with the stale 'declared but not implemented' wording; got: ${JSON.stringify(stdout)}`,
  );
  // Exit 4 is still mentioned (it IS a reserved code) but as not-emitted.
  assert.match(
    stdout,
    /4\s+reserved/,
    "top-level help should still note exit 4 is reserved",
  );
});

test("cli-B-005: 'bp import pytorch --help' does not list exit 4 as an outcome (pytorch is implemented)", () => {
  const { status, stdout } = runBp(["import", "pytorch", "--help"]);
  assert.strictEqual(status, 0);
  // The pytorch adapter IS implemented, so exit 4 can never occur here. The
  // help must not list "4  Reserved: framework adapter declared but not
  // implemented." as one of this command's exit codes.
  assert.doesNotMatch(
    stdout,
    /^\s*4\s+Reserved: framework adapter declared but not implemented\.\s*$/m,
    `pytorch import help must not list exit 4 as an outcome; got: ${JSON.stringify(stdout)}`,
  );
});
