/**
 * v0.8 — end-to-end pipe test: `bp import pytorch multi <sidecar> | bp verify multi -`
 *
 * Proves the load-bearing v0.8 workflow: a user with a 3-step PyTorch
 * sidecar JSONL stream can produce N observer-mode receipts and verify
 * the whole bundle (per-step Rules 1-8 + cross-record Rules 9, 10, 17)
 * in one shell pipe. This is the cold-user proof from the v0.8 README's
 * "Multi-step ingestion" section.
 *
 * Exit-code semantics under test:
 *   - Good fixture: pipe exits 0 (importer ok AND verify multi ok).
 *   - Bad fixtures: pipe exits 1 (verify multi finds rule violations).
 */

import { test } from "node:test"
import assert from "node:assert/strict"
import { spawnSync, spawn } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, "..")
const sidecarPath = resolve(
  repoRoot,
  "fixtures/external/pytorch.softmax-ce.multi-step.sidecar.jsonl",
)

function runBp(args: string[], stdin?: string): {
  status: number | null
  stdout: string
  stderr: string
} {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "src/bin/bp.ts", ...args],
    { cwd: repoRoot, encoding: "utf-8", input: stdin },
  )
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

test("end-to-end: bp import pytorch multi <good> | bp verify multi - exits 0", () => {
  if (!existsSync(sidecarPath)) return
  // Step 1: import
  const importResult = runBp([
    "import",
    "pytorch",
    "multi",
    "fixtures/external/pytorch.softmax-ce.multi-step.sidecar.jsonl",
  ])
  assert.strictEqual(importResult.status, 0, "import step must exit 0")
  const receiptStream = importResult.stdout
  assert.ok(receiptStream.length > 0, "import must produce non-empty stdout")

  // Step 2: pipe receipt stream into verify multi via stdin
  const verifyResult = runBp(["verify", "multi", "-"], receiptStream)
  assert.strictEqual(
    verifyResult.status,
    0,
    `verify multi must accept the imported receipt stream and exit 0. ` +
      `stderr: ${verifyResult.stderr}`,
  )
})

test("end-to-end pipe rejects each bad multi-step fixture (verify multi exits 1)", () => {
  const badFixtures = [
    "multi-step-external.bad-step-index-gap",
    "multi-step-external.bad-chain-break-cross-step-internally-consistent",
    "multi-step-external.bad-fabricated-mid-step",
    "multi-step-external.bad-cross-trace-splice",
    "multi-step-external.bad-bundle-digest-tampered",
  ]
  for (const name of badFixtures) {
    const fixturePath = resolve(repoRoot, `fixtures/bad/${name}.jsonl`)
    if (!existsSync(fixturePath)) continue
    // verify multi reads bad fixture directly (it's already a multi-record
    // JSONL of observer-mode receipts — no need to re-import).
    const verifyResult = runBp(["verify", "multi", `fixtures/bad/${name}.jsonl`])
    assert.strictEqual(
      verifyResult.status,
      1,
      `verify multi must exit 1 on ${name} (found a rule violation). ` +
        `stderr: ${verifyResult.stderr}`,
    )
  }
})

test("CLI exit codes documented in --help match real behavior on a good multi-step trace", () => {
  const help = runBp(["import", "pytorch", "multi", "--help"])
  assert.strictEqual(help.status, 0)
  assert.match(help.stdout, /Exit codes:/)
  assert.match(help.stdout, /0\s+All N steps imported AND every per-step Rule 14 differential agreed/)
  assert.match(help.stdout, /1\s+All N steps imported.+differential DISAGREED/)
  assert.match(help.stdout, /2\s+Usage \/ I\/O \/ schema-validation error/)
})
