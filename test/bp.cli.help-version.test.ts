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
