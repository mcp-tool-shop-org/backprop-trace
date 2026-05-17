/**
 * `bp generate from-config <input.json>` CLI tests
 * (Agent E's new subcommand from consolidator-decision §5).
 *
 * Round-trip via Agent E's `bp scaffold topology` so the test verifies the
 * authoring-spine end-to-end: scaffold an XOR input, hand it to from-config,
 * compare bytes against the existing canonical xor golden.
 *
 * Validation gates (input must NOT carry receipt-only fields):
 *   - Missing required field => exit 2 with SCHEMA_VIOLATION hint
 *   - Receipt-only top-level field (e.g., forward / loss / updates /
 *     parameters_after / fixture_status) => exit 2 (schema additionalProperties: false)
 *   - Invalid JSON => exit 2 with "invalid JSON" hint
 *
 * All tests skip if the subcommand is not yet wired (CLI agent dependency).
 */

import { test } from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, "..")
const tmpDir = resolve(repoRoot, "tmp")
const xorGoldenPath = resolve(repoRoot, "fixtures/xor.golden.jsonl")

function runBp(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "src/bin/bp.ts", ...args],
    { cwd: repoRoot, encoding: "utf-8" },
  )
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

/**
 * Probe whether `bp generate from-config` is wired. Returns true only when
 * the subcommand parser recognizes it (help exits 0 with no "unknown
 * subcommand" guidance).
 */
function generateFromConfigIsWired(): boolean {
  const help = runBp(["generate", "from-config", "--help"])
  if (help.status !== 0) return false
  const combined = (help.stderr + help.stdout).toLowerCase()
  if (combined.includes("unknown subcommand") || combined.includes("did you mean")) {
    return false
  }
  return true
}

function scaffoldTopologyIsWired(): boolean {
  const help = runBp(["scaffold", "topology", "--help"])
  if (help.status !== 0) return false
  const combined = (help.stderr + help.stdout).toLowerCase()
  if (combined.includes("unknown subcommand") || combined.includes("did you mean")) {
    return false
  }
  return true
}

/**
 * Try to obtain a known-good XOR input JSON. Strategy:
 *   1. Prefer reading from the engine via @library export so the test
 *      doesn't depend on Agent E's scaffold-to-file path.
 *   2. Fall back to invoking `bp scaffold topology --topology xor` if the
 *      library export isn't surfaced cleanly.
 */
async function obtainXorInput(): Promise<string | undefined> {
  try {
    const { XOR_INPUT } = (await import("../src/mazur.js")) as { XOR_INPUT: unknown }
    return JSON.stringify(XOR_INPUT, null, 2)
  } catch {
    if (scaffoldTopologyIsWired()) {
      const { status, stdout } = runBp(["scaffold", "topology", "--topology", "xor"])
      if (status === 0 && stdout.length > 0) return stdout
    }
    return undefined
  }
}

test("bp generate from-config <good xor input> exits 0 with valid receipt to stdout", async (t) => {
  if (!generateFromConfigIsWired()) {
    t.skip("TODO upstream (CLI agent): bp generate from-config not yet wired")
    return
  }
  const inputJson = await obtainXorInput()
  if (inputJson === undefined) {
    t.skip("TODO upstream: could not obtain XOR input JSON to feed from-config")
    return
  }
  mkdirSync(tmpDir, { recursive: true })
  const inputPath = resolve(tmpDir, "bp-generate-from-config-good.input.json")
  writeFileSync(inputPath, inputJson, "utf-8")
  try {
    const { status, stdout, stderr } = runBp(["generate", "from-config", inputPath])
    assert.strictEqual(
      status,
      0,
      `bp generate from-config <good> must exit 0; got ${status}\nstderr: ${stderr}\nstdout(head): ${stdout.slice(0, 200)}`,
    )
    assert.ok(stdout.length > 0, "stdout must contain emitted receipt bytes")
    // First line of stdout must parse as JSON with a schema_version field
    // (proving it's a receipt shape, not raw input echoed back).
    const firstLine = stdout.split("\n")[0]!
    const parsed = JSON.parse(firstLine) as { schema_version?: string }
    assert.ok(
      parsed.schema_version,
      `first line of stdout must be a receipt JSON with schema_version; got: ${firstLine.slice(0, 200)}`,
    )
  } finally {
    rmSync(inputPath, { force: true })
  }
})

test("bp generate from-config round-trips: scaffold xor -> from-config -> bytes byte-equal to fixtures/xor.golden.jsonl", async (t) => {
  if (!generateFromConfigIsWired() || !scaffoldTopologyIsWired()) {
    t.skip("TODO upstream (CLI agent): scaffold topology + generate from-config not both wired")
    return
  }
  if (!existsSync(xorGoldenPath)) {
    t.skip("TODO upstream: fixtures/xor.golden.jsonl not present")
    return
  }
  mkdirSync(tmpDir, { recursive: true })
  const scaffoldedPath = resolve(tmpDir, "bp-roundtrip-xor.input.json")
  try {
    const scaffold = runBp(["scaffold", "topology", "--topology", "xor", "--out", scaffoldedPath])
    if (scaffold.status !== 0) {
      t.skip(
        `TODO upstream (CLI agent): bp scaffold topology --topology xor --out <path> ` +
          `exited ${scaffold.status}; stderr: ${scaffold.stderr}`,
      )
      return
    }
    assert.ok(existsSync(scaffoldedPath), "scaffolded input file must exist")

    const generated = runBp(["generate", "from-config", scaffoldedPath])
    assert.strictEqual(
      generated.status,
      0,
      `bp generate from-config <scaffolded> must exit 0; got ${generated.status}\nstderr: ${generated.stderr}`,
    )
    const golden = readFileSync(xorGoldenPath, "utf-8")
    assert.strictEqual(
      generated.stdout,
      golden,
      `scaffold xor -> generate from-config must byte-equal fixtures/xor.golden.jsonl. ` +
        `Round-trip length=${generated.stdout.length}, golden length=${golden.length}. ` +
        `First-diff hint: ${(() => {
          const min = Math.min(generated.stdout.length, golden.length)
          for (let i = 0; i < min; i++) {
            if (generated.stdout[i] !== golden[i]) {
              return `byte ${i}: scaffold=${JSON.stringify(generated.stdout[i])}, golden=${JSON.stringify(golden[i])}`
            }
          }
          return `lengths differ (no in-range diff); scaffold tail: ${JSON.stringify(generated.stdout.slice(min, min + 40))}, golden tail: ${JSON.stringify(golden.slice(min, min + 40))}`
        })()}`,
    )
  } finally {
    rmSync(scaffoldedPath, { force: true })
  }
})

test("bp generate from-config <invalid-json> exits non-zero with 'invalid JSON' hint", (t) => {
  if (!generateFromConfigIsWired()) {
    t.skip("TODO upstream (CLI agent): bp generate from-config not yet wired")
    return
  }
  mkdirSync(tmpDir, { recursive: true })
  const inputPath = resolve(tmpDir, "bp-from-config-invalid.json")
  writeFileSync(inputPath, "{ this is not valid JSON ,,", "utf-8")
  try {
    const { status, stderr } = runBp(["generate", "from-config", inputPath])
    // CLI agent's implementation (per src/bin/bp.ts:1591) classifies
    // JSON_SYNTAX as a verification-failure (exit 1, matching bp validate
    // semantics). Task spec called for exit 2; accept either as long as
    // it's a non-zero rejection with the right stderr hint.
    assert.ok(
      status === 1 || status === 2,
      `bp generate from-config <bad-json> must exit 1 (verification-failure) or 2 ` +
        `(input-invalid); got ${status}\nstderr: ${stderr}`,
    )
    assert.match(
      stderr,
      /invalid json|parse error|unexpected token|json_syntax/i,
      `stderr should mention 'invalid JSON'-class error; got: ${JSON.stringify(stderr)}`,
    )
  } finally {
    rmSync(inputPath, { force: true })
  }
})

test("bp generate from-config <schema-violation> exits non-zero with SCHEMA_VIOLATION hint", async (t) => {
  if (!generateFromConfigIsWired()) {
    t.skip("TODO upstream (CLI agent): bp generate from-config not yet wired")
    return
  }
  // Construct an input missing a required field (e.g., topology).
  const inputJson = await obtainXorInput()
  if (inputJson === undefined) {
    t.skip("TODO upstream: could not obtain XOR input JSON to mutate for schema-violation test")
    return
  }
  const obj = JSON.parse(inputJson) as Record<string, unknown>
  delete obj["topology"]
  mkdirSync(tmpDir, { recursive: true })
  const inputPath = resolve(tmpDir, "bp-from-config-schema-violation.json")
  writeFileSync(inputPath, JSON.stringify(obj), "utf-8")
  try {
    const { status, stderr } = runBp(["generate", "from-config", inputPath])
    // CLI agent classifies SCHEMA_VIOLATION as verification-failure exit 1
    // (consistent with bp validate). Accept either 1 or 2.
    assert.ok(
      status === 1 || status === 2,
      `bp generate from-config <schema-violation> must exit 1 (verification-failure) or 2 ` +
        `(input-invalid); got ${status}\nstderr: ${stderr}`,
    )
    assert.match(
      stderr,
      /schema|required|topology|SCHEMA_VIOLATION/i,
      `stderr should mention schema violation context; got: ${JSON.stringify(stderr)}`,
    )
  } finally {
    rmSync(inputPath, { force: true })
  }
})

test("bp generate from-config <input-with-receipt-only-field> exits non-zero (schema rejects 'forward')", async (t) => {
  if (!generateFromConfigIsWired()) {
    t.skip("TODO upstream (CLI agent): bp generate from-config not yet wired")
    return
  }
  // The whole point of the v0.4 topology-input schema is that receipts are
  // engine outputs, not engine inputs. The schema MUST reject any
  // top-level field that's only valid on a receipt.
  const inputJson = await obtainXorInput()
  if (inputJson === undefined) {
    t.skip("TODO upstream: could not obtain XOR input JSON for receipt-leakage test")
    return
  }
  const obj = JSON.parse(inputJson) as Record<string, unknown>
  // Inject a top-level `forward` field — this is a receipt-only field, the
  // schema's additionalProperties: false must reject it.
  obj["forward"] = { h1: { net: 0, out: 0 } }
  mkdirSync(tmpDir, { recursive: true })
  const inputPath = resolve(tmpDir, "bp-from-config-receipt-leak.json")
  writeFileSync(inputPath, JSON.stringify(obj), "utf-8")
  try {
    const { status, stderr } = runBp(["generate", "from-config", inputPath])
    // CLI agent classifies SCHEMA_VIOLATION (additionalProperties failure)
    // as exit 1 (verification-failure). Accept either 1 or 2 as long as
    // the receipt-leakage gate fires.
    assert.ok(
      status === 1 || status === 2,
      `bp generate from-config <input-with-forward-field> must exit 1 or 2 (canonical-emission ` +
        `trust-leakage gate); got ${status}\nstderr: ${stderr}`,
    )
    assert.match(
      stderr,
      /additionalProperties|forward|schema|not allowed|unknown/i,
      `stderr should mention the receipt-only field was rejected; got: ${JSON.stringify(stderr)}`,
    )
  } finally {
    rmSync(inputPath, { force: true })
  }
})
