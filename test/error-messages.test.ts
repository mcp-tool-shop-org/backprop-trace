/**
 * Stage C humanization: hint-suffix presence tests.
 *
 * Pins that the helpfulness improvements landed in Stage B+C cannot regress
 * silently. Each error path in the public API and CLI must emit a "Hint:"
 * suffix telling the caller what to do next — not just what went wrong. If
 * a future PR strips the hint to "shorten the message," this test breaks.
 *
 * Covered paths:
 *   1. FormatPolicyError messages (NON_PLAIN_DECIMAL_INPUT and
 *      PLAIN_DECIMAL_OUT_OF_SCOPE) — call formatDecimalStringForFixture
 *      with bad input, assert err.message.includes('Hint:').
 *   2. formatNumberForEngine non-finite error — call with NaN, assert
 *      err.message.includes('Hint:'). (NaN routes through the
 *      non-finite branch before reaching policy, so the hint here
 *      points at the upstream engine-input-validation layer.)
 *   3. runMazurStep input-validation error — call with NaN in input,
 *      assert error.message.includes('Hint:').
 *   4. bp CLI ENOENT error — invoke `bp reconcile receipt nonexistent.json`,
 *      assert stderr.includes('Hint:'). Also test JSON mode: the hint goes
 *      into the JSON error object's `message` field.
 *
 * Why this exists: research-grounding.md Finding 1 (Petricek &
 * Plasmeijer-style helpfulness norms — error messages that name the
 * remediation, not just the failure). The Hint: convention is the
 * lightweight in-message form of that practice. This test makes the
 * convention load-bearing.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  formatDecimalStringForFixture,
  FormatPolicyError,
} from "../src/format.js";
import { formatNumberForEngine } from "../src/runtime-format.js";
import { runMazurStep } from "../src/engine.js";
import { MAZUR_INPUT, type MazurInput } from "../src/mazur.js";

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

// =============================================================================
// 1. FormatPolicyError — both kinds must include "Hint:"
// =============================================================================

test("Stage C: FormatPolicyError(NON_PLAIN_DECIMAL_INPUT) message contains 'Hint:'", () => {
  let caught: unknown;
  try {
    // "1.5e3" is scientific notation — fails PLAIN_DECIMAL_REGEX,
    // triggering NON_PLAIN_DECIMAL_INPUT.
    formatDecimalStringForFixture("1.5e3");
  } catch (e) {
    caught = e;
  }
  assert.ok(
    caught instanceof FormatPolicyError,
    `expected FormatPolicyError, got ${String(caught)}`,
  );
  assert.strictEqual(
    (caught as FormatPolicyError).kind,
    "NON_PLAIN_DECIMAL_INPUT",
  );
  assert.ok(
    (caught as Error).message.includes("Hint:"),
    `NON_PLAIN_DECIMAL_INPUT message must include 'Hint:' (humanization); got ${JSON.stringify((caught as Error).message)}`,
  );
});

test("Stage C: FormatPolicyError(PLAIN_DECIMAL_OUT_OF_SCOPE) below min message contains 'Hint:'", () => {
  let caught: unknown;
  try {
    // "0.0000000000001" is below the 1e-9 floor.
    formatDecimalStringForFixture("0.0000000000001");
  } catch (e) {
    caught = e;
  }
  assert.ok(
    caught instanceof FormatPolicyError,
    `expected FormatPolicyError, got ${String(caught)}`,
  );
  assert.strictEqual(
    (caught as FormatPolicyError).kind,
    "PLAIN_DECIMAL_OUT_OF_SCOPE",
  );
  assert.ok(
    (caught as Error).message.includes("Hint:"),
    `PLAIN_DECIMAL_OUT_OF_SCOPE (below min) message must include 'Hint:'; got ${JSON.stringify((caught as Error).message)}`,
  );
});

test("Stage C: FormatPolicyError(PLAIN_DECIMAL_OUT_OF_SCOPE) above max message contains 'Hint:'", () => {
  let caught: unknown;
  try {
    // "99999999" is >= 1e7.
    formatDecimalStringForFixture("99999999");
  } catch (e) {
    caught = e;
  }
  assert.ok(
    caught instanceof FormatPolicyError,
    `expected FormatPolicyError, got ${String(caught)}`,
  );
  assert.strictEqual(
    (caught as FormatPolicyError).kind,
    "PLAIN_DECIMAL_OUT_OF_SCOPE",
  );
  assert.ok(
    (caught as Error).message.includes("Hint:"),
    `PLAIN_DECIMAL_OUT_OF_SCOPE (above max) message must include 'Hint:'; got ${JSON.stringify((caught as Error).message)}`,
  );
});

// =============================================================================
// 2. formatNumberForEngine non-finite error must include "Hint:"
// =============================================================================

test("Stage C: formatNumberForEngine(NaN) error message contains 'Hint:'", () => {
  let caught: unknown;
  try {
    formatNumberForEngine(Number.NaN);
  } catch (e) {
    caught = e;
  }
  assert.ok(caught instanceof Error, `expected Error, got ${String(caught)}`);
  assert.ok(
    (caught as Error).message.includes("Hint:"),
    `formatNumberForEngine(NaN) error must include 'Hint:'; got ${JSON.stringify((caught as Error).message)}`,
  );
});

test("Stage C: formatNumberForEngine(Infinity) error message contains 'Hint:'", () => {
  let caught: unknown;
  try {
    formatNumberForEngine(Number.POSITIVE_INFINITY);
  } catch (e) {
    caught = e;
  }
  assert.ok(caught instanceof Error, `expected Error, got ${String(caught)}`);
  assert.ok(
    (caught as Error).message.includes("Hint:"),
    `formatNumberForEngine(Infinity) error must include 'Hint:'; got ${JSON.stringify((caught as Error).message)}`,
  );
});

// =============================================================================
// 3. runMazurStep input-validation error must include "Hint:"
// =============================================================================

test("Stage C: runMazurStep(NaN in inputs) error message contains 'Hint:'", () => {
  // Clone MAZUR_INPUT via structuredClone and mutate inputs.i1 to NaN.
  const input = structuredClone(MAZUR_INPUT) as unknown as {
    inputs: { i1: number; i2: number };
  };
  input.inputs.i1 = Number.NaN;
  let caught: unknown;
  try {
    runMazurStep(input as unknown as MazurInput);
  } catch (e) {
    caught = e;
  }
  assert.ok(caught instanceof Error, `expected Error, got ${String(caught)}`);
  assert.ok(
    (caught as Error).message.includes("Hint:"),
    `runMazurStep(NaN input) error must include 'Hint:'; got ${JSON.stringify((caught as Error).message)}`,
  );
});

test("Stage C: runMazurStep(learning_rate <= 0) error message contains 'Hint:'", () => {
  const input = structuredClone(MAZUR_INPUT) as unknown as {
    learning_rate: number;
  };
  input.learning_rate = 0;
  let caught: unknown;
  try {
    runMazurStep(input as unknown as MazurInput);
  } catch (e) {
    caught = e;
  }
  assert.ok(caught instanceof Error, `expected Error, got ${String(caught)}`);
  assert.ok(
    (caught as Error).message.includes("Hint:"),
    `runMazurStep(lr=0) error must include 'Hint:'; got ${JSON.stringify((caught as Error).message)}`,
  );
});

test("Stage C: runMazurStep(bad bias_sharing) error message contains 'Hint:'", () => {
  const input = structuredClone(MAZUR_INPUT) as unknown as {
    topology: { bias_sharing: string };
  };
  input.topology.bias_sharing = "per_neuron";
  let caught: unknown;
  try {
    runMazurStep(input as unknown as MazurInput);
  } catch (e) {
    caught = e;
  }
  assert.ok(caught instanceof Error, `expected Error, got ${String(caught)}`);
  assert.ok(
    (caught as Error).message.includes("Hint:"),
    `runMazurStep(bad bias_sharing) error must include 'Hint:'; got ${JSON.stringify((caught as Error).message)}`,
  );
});

// =============================================================================
// 4. bp CLI ENOENT error must include "Hint:"
// =============================================================================

test("Stage C: bp reconcile receipt <nonexistent> stderr contains 'Hint:' (human mode)", () => {
  const { status, stderr } = runBp([
    "reconcile",
    "receipt",
    "fixtures/this/file/does/not/exist.json",
  ]);
  assert.strictEqual(status, 2, "missing-file path must exit 2");
  assert.ok(
    stderr.includes("Hint:"),
    `bp ENOENT stderr must include 'Hint:' for humanization; got ${JSON.stringify(stderr)}`,
  );
});

test("Stage C: bp --json reconcile receipt <nonexistent> error.message contains 'Hint:' (json mode)", () => {
  const { status, stdout, stderr } = runBp([
    "--json",
    "reconcile",
    "receipt",
    "fixtures/this/file/does/not/exist.json",
  ]);
  assert.strictEqual(status, 2, "missing-file path must exit 2 even in --json mode");
  assert.strictEqual(
    stderr,
    "",
    "--json mode must suppress stderr so stdout is parseable; got " + JSON.stringify(stderr),
  );
  const parsed = JSON.parse(stdout.trim()) as {
    ok: boolean;
    error: { code?: string; message?: string };
  };
  assert.strictEqual(parsed.ok, false, `error envelope must have ok:false; got ${JSON.stringify(parsed)}`);
  assert.ok(
    typeof parsed.error?.message === "string" && parsed.error.message.includes("Hint:"),
    `--json ENOENT error.message must include 'Hint:' for humanization; got ${JSON.stringify(parsed)}`,
  );
});

test("Stage C: bp reconcile receipt <malformed JSON> stderr contains 'Hint:' (human mode)", () => {
  // Avoid overwriting any production fixture — write to tmp/ which is
  // gitignored. The runtime-format test already writes here so the path exists.
  const tmpDir = resolve(repoRoot, "tmp");
  mkdirSync(tmpDir, { recursive: true });
  const path = resolve(tmpDir, "bp-cli-error-message-malformed.json");
  writeFileSync(path, "{not valid", { encoding: "utf-8" });

  const { status, stderr } = runBp(["reconcile", "receipt", path]);
  assert.strictEqual(status, 2, "malformed JSON must exit 2");
  assert.ok(
    stderr.includes("Hint:"),
    `bp invalid-JSON stderr must include 'Hint:' for humanization; got ${JSON.stringify(stderr)}`,
  );
});
