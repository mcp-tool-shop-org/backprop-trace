/**
 * FT-C-002 `bp generate mazur` CLI tests.
 *
 *   1. `bp generate mazur` writes canonical bytes to stdout byte-equal
 *      to fixtures/mazur.golden.jsonl.
 *   2. `bp generate mazur --check` exits 0 when engine bytes match golden.
 *   3. `bp generate mazur --out <path>` writes the bytes to that file.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const tmpDir = resolve(repoRoot, "tmp");
const goldenPath = resolve(repoRoot, "fixtures/mazur.golden.jsonl");

function runBp(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "src/bin/bp.ts", ...args],
    { cwd: repoRoot, encoding: "utf-8" },
  );
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

test("bp generate mazur writes stdout bytes byte-equal to the golden fixture", () => {
  const golden = readFileSync(goldenPath, "utf-8");
  const { status, stdout, stderr } = runBp(["generate", "mazur"]);
  assert.strictEqual(
    status,
    0,
    `bp generate mazur must exit 0; got ${status}\nstderr: ${stderr}`,
  );
  assert.strictEqual(
    stdout,
    golden,
    `bp generate mazur stdout must byte-equal fixtures/mazur.golden.jsonl. ` +
      `stdout length=${stdout.length}, golden length=${golden.length}`,
  );
});

test("bp generate mazur --check exits 0 (no drift on the canonical engine)", () => {
  const { status, stdout, stderr } = runBp(["generate", "mazur", "--check"]);
  assert.strictEqual(
    status,
    0,
    `bp generate mazur --check must exit 0; got ${status}\nstdout: ${stdout}\nstderr: ${stderr}`,
  );
});

test("bp generate mazur --out tmp/foo.jsonl writes a file matching the golden", () => {
  mkdirSync(tmpDir, { recursive: true });
  const outPath = resolve(tmpDir, "bp-generate-mazur.jsonl");
  try {
    const { status, stderr } = runBp(["generate", "mazur", "--out", outPath]);
    assert.strictEqual(
      status,
      0,
      `bp generate mazur --out must exit 0; got ${status}\nstderr: ${stderr}`,
    );
    const written = readFileSync(outPath, "utf-8");
    const golden = readFileSync(goldenPath, "utf-8");
    assert.strictEqual(
      written,
      golden,
      `bp generate mazur --out must write golden bytes to file. ` +
        `written length=${written.length}, golden length=${golden.length}`,
    );
  } finally {
    rmSync(outPath, { force: true });
  }
});
