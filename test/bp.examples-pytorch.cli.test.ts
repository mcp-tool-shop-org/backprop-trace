/**
 * v0.10 — Tests for `bp examples pytorch` and `bp examples pytorch --print`.
 *
 * Verifies:
 *   (a) `bp examples pytorch` prints the absolute path of scripts/extract/pytorch.py
 *       and exits 0.
 *   (b) `bp examples pytorch --print` cats the helper bytes to stdout.
 *   (c) The bundled helper file:
 *        - exists at scripts/extract/pytorch.py
 *        - looks like Python (starts with """ docstring or import)
 *        - mentions the v0.10 trust-boundary statement
 *        - mentions the momentum_buffer sign-flip pin for v0.10.1
 *        - mentions the helper version constant matching package.json
 *   (d) `bp examples pytorch --help` prints usage and exits 0.
 *   (e) `bp examples pytorch --bogus-flag` exits 3 (invalid CLI argument).
 *   (f) `bp examples` with no subnoun prints usage and exits 2 (incomplete).
 *
 * The Python helper is NOT executed in CI — that requires PyTorch
 * installed and is out of scope for this Node-only test suite. Helper
 * execution coverage is via the fixture plate
 * (test/import-pytorch-helper.test.ts + reconcile.bad-pytorch-helper.test.ts).
 */

import test from "node:test"
import assert from "node:assert/strict"
import { existsSync, readFileSync, statSync } from "node:fs"
import { resolve } from "node:path"
import { spawnSync } from "node:child_process"

const REPO_ROOT = resolve(".")
const BP = resolve(REPO_ROOT, "dist/bin/bp.js")
const HELPER_PATH = resolve(REPO_ROOT, "scripts/extract/pytorch.py")

function runBp(args: string[]): { code: number; stdout: string; stderr: string } {
  const result = spawnSync("node", [BP, ...args], {
    encoding: "utf-8",
    env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
  })
  return {
    code: result.status ?? -1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  }
}

test("bp dist build exists (prerequisite for CLI tests)", () => {
  assert.ok(existsSync(BP), `dist build missing at ${BP}; run 'pnpm build' first`)
})

test("scripts/extract/pytorch.py exists on disk (v0.10 helper file)", () => {
  assert.ok(existsSync(HELPER_PATH), `helper missing at ${HELPER_PATH}`)
  const stat = statSync(HELPER_PATH)
  assert.ok(stat.size > 1024, "helper file must be non-trivial (>1KB); v0.10 helper is ~15KB")
})

test("scripts/extract/pytorch.py: trust-boundary statement present", () => {
  const text = readFileSync(HELPER_PATH, "utf-8")
  assert.match(text, /OBSERVER/i, "helper docstring must include 'OBSERVER' (trust-boundary statement)")
  assert.match(text, /NEVER\s+a\s+verifier/i, "helper docstring must state 'NEVER a verifier'")
  assert.match(text, /Rule\s+14/, "helper docstring must reference Rule 14 as the authority")
  assert.match(text, /FORENSIC/i, "helper docstring must describe source_hash as FORENSIC")
})

test("scripts/extract/pytorch.py: momentum_buffer sign-flip pin documented for v0.10.1", () => {
  const text = readFileSync(HELPER_PATH, "utf-8")
  assert.match(text, /momentum_buffer/i, "helper must document momentum_buffer behavior")
  assert.match(text, /sign[-_\s]flip/i, "helper must document the sign-flip pin")
  assert.match(text, /v0\.10\.1/, "helper must declare sgd_momentum as v0.10.1 deferral")
})

test("scripts/extract/pytorch.py: helper version matches package.json (forensic identity)", () => {
  const text = readFileSync(HELPER_PATH, "utf-8")
  const pkg = JSON.parse(readFileSync(resolve(REPO_ROOT, "package.json"), "utf-8")) as { version: string }
  assert.match(
    text,
    new RegExp(`HELPER_VERSION\\s*=\\s*"${pkg.version.replace(/\./g, "\\.")}"`),
    `helper HELPER_VERSION must match package.json version (${pkg.version})`,
  )
})

test("bp examples pytorch: prints absolute helper path and exits 0", () => {
  const { code, stdout } = runBp(["examples", "pytorch"])
  assert.equal(code, 0)
  assert.ok(stdout.includes("scripts"), `stdout should contain 'scripts'; got: ${stdout.slice(0, 200)}`)
  assert.ok(stdout.includes("pytorch.py"), `stdout should contain 'pytorch.py'; got: ${stdout.slice(0, 200)}`)
  // Path must be ABSOLUTE so the user can copy it without resolution ambiguity.
  const path = stdout.trim()
  assert.ok(
    path.startsWith("/") || /^[A-Z]:\\/.test(path),
    `path must be absolute; got '${path}'`,
  )
})

test("bp examples pytorch --print: cats helper bytes to stdout", () => {
  const { code, stdout } = runBp(["examples", "pytorch", "--print"])
  assert.equal(code, 0)
  assert.ok(stdout.length > 1024, "stdout must contain helper content (>1KB)")
  assert.match(stdout, /^"""/, "stdout must start with the helper's docstring")
  assert.match(stdout, /TraceDumper/, "stdout must contain the TraceDumper class")
  assert.match(stdout, /HELPER_VERSION/, "stdout must contain the HELPER_VERSION constant")
})

test("bp examples pytorch --print: stdout is byte-identical to scripts/extract/pytorch.py", () => {
  const { code, stdout } = runBp(["examples", "pytorch", "--print"])
  assert.equal(code, 0)
  const onDisk = readFileSync(HELPER_PATH, "utf-8")
  assert.equal(stdout, onDisk, "bp examples pytorch --print must emit byte-identical bytes to the on-disk file")
})

test("bp examples pytorch --help: prints usage and exits 0", () => {
  const { code, stdout } = runBp(["examples", "pytorch", "--help"])
  assert.equal(code, 0)
  assert.match(stdout, /Usage: bp examples pytorch/, "help must include the canonical usage line")
  assert.match(stdout, /TRUST BOUNDARY|observer/i, "help should mention the trust boundary or observer-only framing")
})

test("bp examples --help: prints usage and exits 0", () => {
  const { code, stdout } = runBp(["examples", "--help"])
  assert.equal(code, 0)
  assert.match(stdout, /Usage: bp examples/, "help must include 'Usage: bp examples'")
})

test("bp examples (no subnoun): prints usage and exits 2 (incomplete command)", () => {
  const { code, stdout } = runBp(["examples"])
  assert.equal(code, 2, "incomplete-command exit code is 2 (usage)")
  assert.match(stdout, /Usage: bp examples/)
})

test("bp examples pytorch --bogus-flag: exits 3 (invalid CLI argument)", () => {
  const { code } = runBp(["examples", "pytorch", "--bogus-flag"])
  assert.equal(code, 3, "unrecognized flag on a known subcommand exits 3")
})

test("bp --help: top-level help mentions the v0.10 examples verb", () => {
  const { code, stdout } = runBp(["--help"])
  assert.equal(code, 0)
  assert.match(stdout, /bp examples pytorch/, "top-level --help must mention bp examples pytorch in the v0.10+ section")
})
