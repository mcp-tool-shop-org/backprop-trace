/**
 * `bp generate iris` CLI tests — mirrors `bp generate xor`.
 *
 *   1. `bp generate iris` writes canonical bytes to stdout byte-equal to
 *      fixtures/iris.golden.jsonl.
 *   2. `bp generate iris --check` exits 0.
 *   3. `bp generate iris --out <path>` writes the bytes to that file.
 *
 * Gated on CLI subcommand + golden fixture availability.
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
const goldenPath = resolve(repoRoot, "fixtures/iris.golden.jsonl")

function runBp(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "src/bin/bp.ts", ...args],
    { cwd: repoRoot, encoding: "utf-8" },
  )
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

/**
 * Probe whether `bp generate iris` is fully wired end-to-end (subcommand
 * declared AND runtime emits cleanly). See test/bp.generate-xor.cli.test.ts
 * for the probe-strategy rationale.
 */
function generateIrisIsWired(): boolean {
  const help = runBp(["generate", "iris", "--help"])
  if (help.status !== 0) return false
  const helpCombined = (help.stderr + help.stdout).toLowerCase()
  if (
    helpCombined.includes("unknown subcommand") ||
    helpCombined.includes("did you mean")
  ) {
    return false
  }
  const run = runBp(["generate", "iris"])
  return run.status === 0 && run.stdout.length > 0
}

test("bp generate iris writes stdout bytes byte-equal to fixtures/iris.golden.jsonl", {
  skip: !existsSync(goldenPath) || !generateIrisIsWired(),
}, () => {
  const golden = readFileSync(goldenPath, "utf-8")
  const { status, stdout, stderr } = runBp(["generate", "iris"])
  assert.strictEqual(
    status,
    0,
    `bp generate iris must exit 0; got ${status}\nstderr: ${stderr}`,
  )
  assert.strictEqual(
    stdout,
    golden,
    `bp generate iris stdout must byte-equal fixtures/iris.golden.jsonl. ` +
      `stdout length=${stdout.length}, golden length=${golden.length}`,
  )
})

test("bp generate iris --check exits 0 on the canonical engine + fixture", {
  skip: !existsSync(goldenPath) || !generateIrisIsWired(),
}, () => {
  const { status, stdout, stderr } = runBp(["generate", "iris", "--check"])
  assert.strictEqual(
    status,
    0,
    `bp generate iris --check must exit 0; got ${status}\nstdout: ${stdout}\nstderr: ${stderr}`,
  )
})

test("bp generate iris --out tmp/iris.jsonl writes a file matching the golden", {
  skip: !existsSync(goldenPath) || !generateIrisIsWired(),
}, () => {
  mkdirSync(tmpDir, { recursive: true })
  const outPath = resolve(tmpDir, "bp-generate-iris.jsonl")
  try {
    const { status, stderr } = runBp(["generate", "iris", "--out", outPath])
    assert.strictEqual(
      status,
      0,
      `bp generate iris --out must exit 0; got ${status}\nstderr: ${stderr}`,
    )
    const written = readFileSync(outPath, "utf-8")
    const golden = readFileSync(goldenPath, "utf-8")
    assert.strictEqual(
      written,
      golden,
      `bp generate iris --out must write golden bytes. ` +
        `written length=${written.length}, golden length=${golden.length}`,
    )
  } finally {
    rmSync(outPath, { force: true })
  }
})
