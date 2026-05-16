/**
 * FT-C-004 `bp --color` + NO_COLOR tests.
 *
 *   - With NO_COLOR set in env, `bp reconcile receipt <bad>` must NOT
 *     emit ANSI escape codes on stderr.
 *   - With `--color=always`, the same invocation MUST emit at least one
 *     ANSI escape on stderr (red FAIL marker).
 *
 * Mirrors the spawn pattern of test/reconcile.bad-gradient.cli.test.ts.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

const ANSI_RE = /\x1b\[[0-9;]*m/;
const ANSI_RED_RE = /\x1b\[[0-9;]*31m/;

function runBp(
  args: string[],
  env?: Record<string, string | undefined>,
): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "src/bin/bp.ts", ...args],
    {
      cwd: repoRoot,
      encoding: "utf-8",
      env: { ...process.env, ...(env ?? {}) },
    },
  );
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

test("NO_COLOR in env strips ANSI escapes from stderr (bp reconcile receipt <bad>)", () => {
  const { status, stderr } = runBp(
    ["reconcile", "receipt", "fixtures/bad/mazur.bad-gradient.jsonl"],
    { NO_COLOR: "1" },
  );
  assert.notStrictEqual(status, 0, "bad fixture must still exit nonzero");
  assert.doesNotMatch(
    stderr,
    ANSI_RE,
    `stderr must NOT contain ANSI escapes when NO_COLOR is set; got: ${JSON.stringify(stderr.slice(0, 200))}`,
  );
});

test("--color=always emits ANSI red on stderr for a failing reconcile", () => {
  const { status, stderr } = runBp([
    "reconcile",
    "receipt",
    "fixtures/bad/mazur.bad-gradient.jsonl",
    "--color=always",
  ]);
  assert.notStrictEqual(status, 0, "bad fixture must still exit nonzero");
  assert.match(
    stderr,
    ANSI_RED_RE,
    `stderr must contain an ANSI red sequence with --color=always; got prefix: ${JSON.stringify(stderr.slice(0, 200))}`,
  );
});
