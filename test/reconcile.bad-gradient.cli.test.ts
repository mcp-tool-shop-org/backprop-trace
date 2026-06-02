import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const tmpDir = resolve(repoRoot, "tmp");

function runBp(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "src/bin/bp.ts", ...args],
    { cwd: repoRoot, encoding: "utf-8" },
  );
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

test(
  "bp reconcile receipt fixtures/bad/mazur.bad-gradient.jsonl exits nonzero with single-target Rule 4 stderr",
  () => {
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "src/bin/bp.ts",
        "reconcile",
        "receipt",
        "fixtures/bad/mazur.bad-gradient.jsonl",
      ],
      { cwd: repoRoot, encoding: "utf-8" },
    );

    assert.notStrictEqual(result.status, 0, "exit code must be nonzero");
    assert.strictEqual(result.stdout, "", "stdout must be empty");

    const stderr = result.stderr;
    assert.match(stderr, /reconciliation failed/, "stderr must contain 'reconciliation failed'");
    assert.match(stderr, /Rule 4/, "stderr must name Rule 4");
    assert.match(stderr, /w5/, "stderr must identify parameter w5");
    assert.match(
      stderr,
      /stored gradient:\s+-0\.082166041/,
      "stderr must include the stored gradient value",
    );
    assert.match(
      stderr,
      /recomputed gradient:\s+-0\.0821670/,
      "stderr must include the recomputed gradient value (prefix match for float serialization)",
    );
    assert.match(stderr, /tolerance/, "stderr must mention tolerance");

    // Single-target invariant: exactly one Rule 4 section, only naming w5.
    // Anti-circularity gate must isolate the deliberate failure from
    // incidental precision noise on other parameters.
    const rule4Sections = stderr.match(/^Rule 4:/gm) || [];
    assert.strictEqual(
      rule4Sections.length,
      1,
      `exactly one Rule 4 failure expected (w5 only); stderr had ${rule4Sections.length} Rule 4 sections`,
    );
    assert.doesNotMatch(
      stderr,
      /\bw6\b|\bw8\b/,
      "no other parameters (w6, w8) should appear in failure stderr — bad fixture must isolate to w5",
    );
  },
);

/**
 * T-A-003: CLI error-path coverage.
 *
 * Pre-amend the CLI dumped a node stack trace on missing-file / malformed-JSON
 * and had no usage path. Post-amend (C-A-003/C-A-005/C-A-006) the CLI prints
 * a user-readable message to stderr and exits 2. These tests pin that
 * contract without depending on the exact wording.
 *
 * Note on no-args: per the CLI agent's amend (C-A-005), `bp` with no args
 * and `bp --help` both print usage to stdout and exit 0 (help is a normal
 * outcome, not an error). The earlier convention of "no args = exit 2" was
 * dropped in favor of this friendlier surface.
 */

test("bp with no args prints usage to stdout and exits 0 (help is a normal outcome)", () => {
  const { status, stdout, stderr } = runBp([]);
  assert.strictEqual(status, 0, `bp [no args] must exit 0 (got ${status}); stderr=${JSON.stringify(stderr)}`);
  assert.strictEqual(stderr, "", "bp [no args] must not write to stderr");
  assert.match(stdout, /Usage:/, "usage block must be on stdout");
  assert.match(stdout, /bp reconcile receipt/, "usage must mention reconcile subcommand");
});

test("bp --help prints usage to stdout and exits 0", () => {
  const { status, stdout, stderr } = runBp(["--help"]);
  assert.strictEqual(status, 0, `bp --help must exit 0 (got ${status})`);
  assert.strictEqual(stderr, "", "bp --help must not write to stderr");
  assert.match(stdout, /Usage:/);
});

test("bp on an unknown command exits 2 with usage on stderr", () => {
  const { status, stdout, stderr } = runBp(["banana"]);
  assert.strictEqual(status, 2, `unknown command must exit 2 (got ${status})`);
  assert.strictEqual(stdout, "", "unknown command must not write to stdout");
  assert.match(stderr, /[Uu]sage|bp/, "stderr must contain a user-facing message (not a node stack trace)");
});

test(
  "bp reconcile receipt <nonexistent file> exits 2 with user-readable error (no node stack trace)",
  () => {
    const { status, stdout, stderr } = runBp([
      "reconcile",
      "receipt",
      "fixtures/this/file/does/not/exist.json",
    ]);
    assert.strictEqual(
      status,
      2,
      `missing file must exit 2 (got ${status}); stderr=${JSON.stringify(stderr)}`,
    );
    assert.strictEqual(stdout, "", "missing-file path must not write to stdout");

    // User-readable: must not be a raw node stack trace.
    assert.doesNotMatch(
      stderr,
      /at Object\.\w+|at process\.\w+|node:internal/,
      `stderr must be user-readable, not a node stack trace; got: ${JSON.stringify(stderr)}`,
    );
    // Must mention the offending path or an ENOENT-ish phrase so the user
    // knows what went wrong.
    assert.match(
      stderr,
      /not found|ENOENT|no such file|fixtures\/this\/file\/does\/not\/exist\.json/,
      `stderr must identify the missing file; got: ${JSON.stringify(stderr)}`,
    );
  },
);

test(
  "bp reconcile receipt <malformed JSON file> exits 2 with user-readable error",
  () => {
    mkdirSync(tmpDir, { recursive: true });
    const malformedPath = resolve(tmpDir, "bp-cli-malformed.json");
    writeFileSync(malformedPath, "{not valid json", { encoding: "utf-8" });

    const { status, stdout, stderr } = runBp([
      "reconcile",
      "receipt",
      malformedPath,
    ]);
    assert.strictEqual(
      status,
      2,
      `malformed JSON must exit 2 (got ${status}); stderr=${JSON.stringify(stderr)}`,
    );
    assert.strictEqual(stdout, "", "malformed-JSON path must not write to stdout");
    assert.doesNotMatch(
      stderr,
      /at Object\.\w+|at JSON\.parse|node:internal/,
      `stderr must be user-readable, not a node stack trace; got: ${JSON.stringify(stderr)}`,
    );
    // Should mention "JSON" or "parse" or the file path so user can locate.
    assert.match(
      stderr,
      /JSON|parse|invalid|syntax|bp-cli-malformed\.json/i,
      `stderr must hint at the parse failure; got: ${JSON.stringify(stderr)}`,
    );
  },
);

// =============================================================================
// G-006 — the engine-recompute skip signal must NOT be dead at the CLI.
//
// reconcileReceipt() (src/reconcile.ts) flags math_gate_skipped:true +
// skipped_rules:[14] when a receipt self-declares
// fixture_status.verification_state === "engine_recompute_skipped_with_basis"
// (Rule 14, the ONLY math gate on observer-mode imports, returns early). Such a
// receipt can still reconcile ok:true — its math was NEVER independently
// verified; it is trusted on its declared skip-basis alone.
//
// Before the fix, `bp reconcile receipt --json` emitted {"ok":true} and exit 0
// on exactly this receipt — dropping the skip signal and reporting a clean PASS
// for a self-declared "I skipped the math gate" receipt. For an inverted threat
// model (a FALSE PASS is the worst defect) that is unacceptable.
//
// The receipt under test is built from a known-good engine-validated observer
// golden (fixtures/external/jax.softmax-ce.golden.jsonl) by flipping only its
// verification_state to the skip-with-basis state and adding a valid skip_basis
// so Rule 15 (skip-basis required) passes — isolating the self-declared-skip
// false-PASS class without depending on a fixture outside this domain's scope.
//
// Mutation that makes this RED: revert bp.ts's runReconcileReceipt to emit
// {ok:true} / exit 0 ignoring result.math_gate_skipped.
const jaxObserverGolden = resolve(
  repoRoot,
  "fixtures/external/jax.softmax-ce.golden.jsonl",
);

function writeSkipWithBasisReceipt(filename: string): string | null {
  if (!existsSync(jaxObserverGolden)) return null;
  const r = JSON.parse(readFileSync(jaxObserverGolden, "utf-8").trim()) as Record<
    string,
    unknown
  >;
  r.fixture_status = {
    ...(r.fixture_status as Record<string, unknown> | undefined),
    verification_state: "engine_recompute_skipped_with_basis",
  };
  r.attestor = {
    ...(r.attestor as Record<string, unknown> | undefined),
    skip_basis: "hardware_nondeterminism",
  };
  mkdirSync(tmpDir, { recursive: true });
  const out = resolve(tmpDir, filename);
  writeFileSync(out, JSON.stringify(r) + "\n", { encoding: "utf-8" });
  return out;
}

test(
  "G-006: bp reconcile receipt --json on a self-skipped math-gate receipt surfaces math_gate_skipped AND exits nonzero",
  {
    skip: !existsSync(jaxObserverGolden),
  },
  () => {
    const receiptPath = writeSkipWithBasisReceipt("g006-skip-with-basis.jsonl");
    assert.ok(receiptPath, "test fixture could not be built");
    try {
      const { status, stdout, stderr } = runBp([
        "reconcile",
        "receipt",
        receiptPath,
        "--json",
      ]);

      // (1) Must NOT be a silent clean PASS (exit 0). A receipt that
      //     self-declares it skipped the only math gate is not verified.
      assert.notStrictEqual(
        status,
        0,
        `self-skipped math-gate receipt must NOT exit 0; got ${status}\nstdout: ${stdout}\nstderr: ${stderr}`,
      );

      // (2) The JSON output must carry the machine-readable skip signal so a
      //     downstream consumer can SEE the gate was skipped.
      const parsed = JSON.parse(stdout) as {
        ok?: boolean;
        math_gate_skipped?: boolean;
        skipped_rules?: number[];
      };
      assert.strictEqual(
        parsed.math_gate_skipped,
        true,
        `--json output must report math_gate_skipped:true; got: ${stdout}`,
      );
      assert.deepStrictEqual(
        parsed.skipped_rules,
        [14],
        `--json output must enumerate skipped_rules [14]; got: ${stdout}`,
      );
      // ok MUST NOT be a bare true — the skip is not a clean pass.
      assert.notStrictEqual(
        parsed.ok,
        true,
        `--json 'ok' must not be true for a self-skipped math gate; got: ${stdout}`,
      );
    } finally {
      rmSync(receiptPath!, { force: true });
    }
  },
);
