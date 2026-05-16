/**
 * FT-C-005 stdin `-` support for reconcile + validate.
 *
 *   - `bp reconcile receipt -` reads the receipt JSON from stdin.
 *   - `bp validate -` reads the receipt JSON from stdin.
 *
 * Both exit 0 when fed the canonical golden via stdin.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const goldenPath = resolve(repoRoot, "fixtures/mazur.golden.jsonl");

function runBpWithStdin(
  args: string[],
  stdinText: string,
): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "src/bin/bp.ts", ...args],
    {
      cwd: repoRoot,
      encoding: "utf-8",
      input: stdinText,
    },
  );
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

test("bp reconcile receipt - reads receipt JSON from stdin and exits 0 on the golden", () => {
  const golden = readFileSync(goldenPath, "utf-8");
  const { status, stdout, stderr } = runBpWithStdin(
    ["reconcile", "receipt", "-"],
    golden,
  );
  assert.strictEqual(
    status,
    0,
    `stdin success path must exit 0; got ${status}\nstdout: ${stdout}\nstderr: ${stderr}`,
  );
  assert.strictEqual(stdout, "", "success path is silent on stdout");
  assert.strictEqual(stderr, "", "success path is silent on stderr");
});

test("bp validate - reads receipt JSON from stdin and exits 0 on the golden", () => {
  const golden = readFileSync(goldenPath, "utf-8");
  const { status, stderr } = runBpWithStdin(["validate", "-"], golden);
  assert.strictEqual(
    status,
    0,
    `stdin success path must exit 0; got ${status}\nstderr: ${stderr}`,
  );
});
