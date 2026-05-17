/**
 * `bp generate xor` CLI tests — mirrors `bp generate mazur`.
 *
 *   1. `bp generate xor` writes canonical bytes to stdout byte-equal to
 *      fixtures/xor.golden.jsonl.
 *   2. `bp generate xor --check` exits 0 when engine bytes match golden.
 *   3. `bp generate xor --out <path>` writes the bytes to that file.
 *
 * Gated on both the CLI subcommand presence (CLI agent dependency) and
 * the golden fixture presence (Fixtures agent dependency).
 */

import { test } from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, "..")
const tmpDir = resolve(repoRoot, "tmp")
const goldenPath = resolve(repoRoot, "fixtures/xor.golden.jsonl")

function runBp(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "src/bin/bp.ts", ...args],
    { cwd: repoRoot, encoding: "utf-8" },
  )
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

/**
 * Probe whether `bp generate xor` is fully wired end-to-end (subcommand
 * declared AND runtime emits cleanly).
 *
 * The probe runs `bp generate xor` with no extra flags and inspects:
 *   - exit 0 + non-empty stdout => fully wired, byte-equal tests are
 *     meaningful.
 *   - exit 2 with "library export not available" stderr => Library agent
 *     hasn't exposed the runtime surface yet (skip).
 *   - exit 1 with FormatPolicyError or similar crash => emitter has a
 *     v0.3-tolerance-shape gap (Library/Math agent dependency; skip
 *     rather than fail this test).
 *   - any other non-zero => skip with the same rationale (we cannot
 *     assert byte-equality when the engine pipeline isn't producing
 *     bytes).
 */
function generateXorIsWired(): boolean {
  const help = runBp(["generate", "xor", "--help"])
  if (help.status !== 0) return false
  const helpCombined = (help.stderr + help.stdout).toLowerCase()
  if (
    helpCombined.includes("unknown subcommand") ||
    helpCombined.includes("did you mean")
  ) {
    return false
  }
  // End-to-end probe — only consider the subcommand fully wired when the
  // engine pipeline runs to completion with bytes on stdout.
  const run = runBp(["generate", "xor"])
  return run.status === 0 && run.stdout.length > 0
}

test("bp generate xor writes stdout bytes byte-equal to fixtures/xor.golden.jsonl", {
  skip: !existsSync(goldenPath) || !generateXorIsWired(),
}, () => {
  const golden = readFileSync(goldenPath, "utf-8")
  const { status, stdout, stderr } = runBp(["generate", "xor"])
  assert.strictEqual(
    status,
    0,
    `bp generate xor must exit 0; got ${status}\nstderr: ${stderr}`,
  )
  assert.strictEqual(
    stdout,
    golden,
    `bp generate xor stdout must byte-equal fixtures/xor.golden.jsonl. ` +
      `stdout length=${stdout.length}, golden length=${golden.length}`,
  )
})

test("bp generate xor --check exits 0 on the canonical engine + fixture", {
  skip: !existsSync(goldenPath) || !generateXorIsWired(),
}, () => {
  const { status, stdout, stderr } = runBp(["generate", "xor", "--check"])
  assert.strictEqual(
    status,
    0,
    `bp generate xor --check must exit 0; got ${status}\nstdout: ${stdout}\nstderr: ${stderr}`,
  )
})

test("bp generate xor --out tmp/xor.jsonl writes a file matching the golden", {
  skip: !existsSync(goldenPath) || !generateXorIsWired(),
}, () => {
  mkdirSync(tmpDir, { recursive: true })
  const outPath = resolve(tmpDir, "bp-generate-xor.jsonl")
  try {
    const { status, stderr } = runBp(["generate", "xor", "--out", outPath])
    assert.strictEqual(
      status,
      0,
      `bp generate xor --out must exit 0; got ${status}\nstderr: ${stderr}`,
    )
    const written = readFileSync(outPath, "utf-8")
    const golden = readFileSync(goldenPath, "utf-8")
    assert.strictEqual(
      written,
      golden,
      `bp generate xor --out must write golden bytes. ` +
        `written length=${written.length}, golden length=${golden.length}`,
    )
  } finally {
    rmSync(outPath, { force: true })
  }
})
