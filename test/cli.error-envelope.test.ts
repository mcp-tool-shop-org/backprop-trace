/**
 * v0.7.0 — Shipcheck B1 (Tier-1 Structured Error Shape) test plate.
 *
 * Verifies the bp CLI's --json error envelope conforms to the shipcheck
 * Tier-1 shape: {ok:false, error:{code, message, hint?, cause?, retryable?}}.
 *
 * Migration discipline: v0.7.0 extends `exitWithUsageError` to support
 * the optional hint/cause/retryable fields. The ENOENT/EACCES/EISDIR/
 * BP_JSONL_PARSE_ERROR/INVALID_JSON/IO_ERROR callers in exitOnReadError
 * are migrated as proof; remaining callers (legacy embed-Hint-in-message
 * style) continue to work without modification. Future v0.7.x can migrate
 * additional callers incrementally.
 */

import { test } from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, "..")

function runBp(args: string[]): {
  status: number | null
  stdout: string
  stderr: string
} {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "src/bin/bp.ts", ...args],
    { cwd: repoRoot, encoding: "utf-8" },
  )
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

test("--json envelope shape conforms to Tier-1 (ENOENT path)", () => {
  const { status, stdout } = runBp([
    "reconcile",
    "receipt",
    "/tmp/does-not-exist.json",
    "--json",
  ])
  assert.strictEqual(status, 2, "ENOENT must exit 2")
  const parsed = JSON.parse(stdout.trim())
  assert.strictEqual(parsed.ok, false)
  assert.strictEqual(parsed.error.code, "ENOENT")
  assert.match(parsed.error.message, /file not found/)
  // Tier-1 additions: hint + retryable as structured fields (not buried
  // in message string).
  assert.strictEqual(typeof parsed.error.hint, "string")
  assert.match(parsed.error.hint, /check the path/)
  assert.strictEqual(parsed.error.retryable, false)
  // Negative assertion: message must NOT contain "Hint:" (migration
  // removed it from the human-prose message in favor of the structured
  // field).
  assert.doesNotMatch(parsed.error.message, /Hint:/)
})

test("--json envelope shape conforms to Tier-1 (EISDIR path)", () => {
  const { status, stdout } = runBp([
    "reconcile",
    "receipt",
    repoRoot,
    "--json",
  ])
  // The repo root is a directory; reconcile should refuse it with EISDIR.
  assert.strictEqual(status, 2)
  const parsed = JSON.parse(stdout.trim())
  assert.strictEqual(parsed.ok, false)
  assert.strictEqual(parsed.error.code, "EISDIR")
  assert.strictEqual(typeof parsed.error.hint, "string")
  assert.strictEqual(parsed.error.retryable, false)
})

test("--json envelope is still backward-compat for legacy callers (USAGE path)", () => {
  // 'bp reconcile' without 'receipt' subnoun → USAGE error from the
  // dispatcher. Legacy caller without opts.hint — should still produce
  // a valid Tier-1 envelope (hint/cause/retryable omitted).
  const { status, stdout } = runBp(["reconcile", "--json"])
  assert.strictEqual(status, 2)
  const parsed = JSON.parse(stdout.trim())
  assert.strictEqual(parsed.ok, false)
  assert.strictEqual(typeof parsed.error.code, "string")
  assert.strictEqual(typeof parsed.error.message, "string")
  // Legacy callers don't supply hint/cause/retryable; envelope omits
  // those keys entirely (not null, not undefined — absent).
  assert.strictEqual(
    Object.prototype.hasOwnProperty.call(parsed.error, "hint"),
    false,
    "legacy callers should not surface a hint field at all (additive optionality)",
  )
})

test("human-mode (non-JSON) emits Hint: on second stderr line when supplied", () => {
  const { status, stderr } = runBp([
    "reconcile",
    "receipt",
    "/tmp/does-not-exist.json",
  ])
  assert.strictEqual(status, 2)
  // Expected: two-line output — first line is "bp: file not found: ...",
  // second line is "Hint: check the path or run from the repo root."
  assert.match(stderr, /^bp: file not found: /m)
  assert.match(stderr, /^Hint: check the path/m)
})
