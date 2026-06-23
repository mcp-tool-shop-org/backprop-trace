/**
 * v1.0 — Tests for `bp examples jax` and `bp examples jax --print`.
 *
 * Mirrors test/bp.examples-pytorch.cli.test.ts for the JAX live helper. Verifies
 * the CLI contract only (the helper's REAL JAX emission path is validated by the
 * gated test/import-jax-helper.jax-e2e.test.ts + the jax-e2e CI job). The Python
 * helper is not executed here (Node-only suite).
 */

import test from "node:test"
import assert from "node:assert/strict"
import { existsSync, readFileSync, statSync } from "node:fs"
import { resolve } from "node:path"
import { spawnSync } from "node:child_process"

const REPO_ROOT = resolve(".")
const BP = resolve(REPO_ROOT, "dist/bin/bp.js")
const HELPER_PATH = resolve(REPO_ROOT, "scripts/extract/jax.py")

function runBp(args: string[]): { code: number; stdout: string; stderr: string } {
  const result = spawnSync("node", [BP, ...args], {
    encoding: "utf-8",
    env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
  })
  return { code: result.status ?? -1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" }
}

test("scripts/extract/jax.py exists on disk (v1.0 JAX helper file)", () => {
  assert.ok(existsSync(HELPER_PATH), `JAX helper missing at ${HELPER_PATH}`)
  assert.ok(statSync(HELPER_PATH).size > 1024, "JAX helper must be non-trivial (>1KB)")
})

test("scripts/extract/jax.py: trust-boundary + determinism statements present", () => {
  const text = readFileSync(HELPER_PATH, "utf-8")
  assert.match(text, /OBSERVER/i, "helper must state it is an observer")
  assert.match(text, /Rule\s+14/, "helper must reference Rule 14 as the authority")
  assert.match(text, /make_jaxpr/, "helper must use jax.make_jaxpr for the stronger trust boundary")
  assert.match(text, /jax_enable_x64/, "helper must enforce the float64 determinism contract")
})

test("bp examples jax: prints the absolute path of scripts/extract/jax.py, exit 0", () => {
  const r = runBp(["examples", "jax"])
  assert.equal(r.code, 0)
  assert.equal(r.stdout.trim(), HELPER_PATH)
})

test("bp examples jax --print: cats the helper bytes to stdout, exit 0", () => {
  const r = runBp(["examples", "jax", "--print"])
  assert.equal(r.code, 0)
  assert.equal(r.stdout, readFileSync(HELPER_PATH, "utf-8"))
})

test("bp examples jax --json: emits the helper_path envelope", () => {
  const r = runBp(["examples", "jax", "--json"])
  assert.equal(r.code, 0)
  const obj = JSON.parse(r.stdout)
  assert.equal(obj.ok, true)
  assert.equal(resolve(obj.helper_path), HELPER_PATH)
})

test("bp examples jax --help: prints usage, exit 0", () => {
  const r = runBp(["examples", "jax", "--help"])
  assert.equal(r.code, 0)
  assert.match(r.stdout, /Usage: bp examples jax/)
})

test("bp examples jax --bogus-flag: exit 3 (invalid CLI argument)", () => {
  const r = runBp(["examples", "jax", "--bogus-flag"])
  assert.equal(r.code, 3)
})

test("bp examples --help: lists BOTH pytorch and jax", () => {
  const r = runBp(["examples", "--help"])
  assert.equal(r.code, 0)
  assert.match(r.stdout, /bp examples pytorch/)
  assert.match(r.stdout, /bp examples jax/)
})
