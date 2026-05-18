/**
 * v0.10.2 — Presence tests for the pack/install smoke gate.
 *
 * The smoke gate itself (scripts/pack-install-smoke.mjs) is too heavy
 * for `pnpm test` (runs pnpm pack + npm install in a temp dir; takes
 * 30-60s). It is invoked as a separate CI job (.github/workflows/pack-
 * smoke.yml) and as a manual `pnpm pack-smoke` script. These presence
 * tests run in the standard test suite and catch the FILE-LEVEL
 * regression class: somebody deletes the script, breaks the workflow
 * YAML, or removes the package.json script entry, and the smoke gate
 * silently stops running.
 *
 * If any of these fire, the smoke gate has been effectively disabled
 * — that's a distribution-integrity regression in itself.
 */

import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync, existsSync, statSync } from "node:fs"
import { resolve } from "node:path"

const REPO_ROOT = resolve(".")
const SCRIPT = resolve(REPO_ROOT, "scripts/pack-install-smoke.mjs")
const WORKFLOW = resolve(REPO_ROOT, ".github/workflows/pack-smoke.yml")
const PKG_JSON = resolve(REPO_ROOT, "package.json")

test("scripts/pack-install-smoke.mjs exists and is substantive", () => {
  assert.ok(existsSync(SCRIPT), `pack-install-smoke script missing at ${SCRIPT}`)
  const stat = statSync(SCRIPT)
  assert.ok(stat.size > 4096, "pack-install-smoke must be substantive (>4KB); current implementation is ~12KB")
})

test("scripts/pack-install-smoke.mjs declares all six smoke steps", () => {
  // Each step is a numbered log line in the script. If a step gets
  // accidentally removed, the smoke gate's coverage shrinks silently;
  // this presence test surfaces it.
  const text = readFileSync(SCRIPT, "utf-8")
  for (const n of [1, 2, 3, 4, 5, 6]) {
    assert.match(text, new RegExp(`step ${n}/6`), `pack-install-smoke must declare step ${n}/6 in its log output`)
  }
})

test("scripts/pack-install-smoke.mjs has required tarball entry list", () => {
  const text = readFileSync(SCRIPT, "utf-8")
  // Load-bearing entries that v0.10.x users depend on. If any of these
  // is removed from REQUIRED_TARBALL_ENTRIES, the smoke gate loses its
  // coverage for that file's tarball presence.
  const requiredInList = [
    "scripts/extract/pytorch.py",
    "examples/pytorch/extract_step.py",
    "schemas/framework-trace.v0.7.0.json",
    "schemas/receipt.v0.7.0.json",
    "fixtures/external/pytorch.helper-emitted.adamw.sidecar.jsonl",
    "fixtures/external/pytorch.helper-emitted.sgd-momentum.sidecar.jsonl",
    "fixtures/mazur.golden.jsonl",
    "dist/bin/bp.js",
  ]
  for (const path of requiredInList) {
    assert.ok(
      text.includes(path),
      `pack-install-smoke REQUIRED_TARBALL_ENTRIES must include ${path}`,
    )
  }
})

test(".github/workflows/pack-smoke.yml exists and runs on push + PR + multi-OS", () => {
  assert.ok(existsSync(WORKFLOW), `pack-smoke workflow missing at ${WORKFLOW}`)
  const text = readFileSync(WORKFLOW, "utf-8")
  assert.match(text, /name:\s*pack-smoke/, "workflow name must be 'pack-smoke'")
  assert.match(text, /push:/, "workflow must trigger on push")
  assert.match(text, /pull_request:/, "workflow must trigger on PR")
  assert.match(text, /ubuntu-latest/, "matrix must include ubuntu-latest")
  assert.match(text, /macos-latest/, "matrix must include macos-latest")
  assert.match(text, /windows-latest/, "matrix must include windows-latest")
  assert.match(text, /pnpm pack-smoke/, "workflow must invoke `pnpm pack-smoke`")
  assert.match(text, /pnpm build/, "workflow must `pnpm build` before pack (stale dist would mask real failures)")
})

test("package.json declares pack-smoke script", () => {
  const pkg = JSON.parse(readFileSync(PKG_JSON, "utf-8")) as {
    scripts?: Record<string, string>
  }
  assert.ok(pkg.scripts, "package.json must have a scripts object")
  assert.equal(
    pkg.scripts["pack-smoke"],
    "node scripts/pack-install-smoke.mjs",
    "package.json must declare `pack-smoke` script invoking the smoke runner",
  )
})

test("package.json files[] includes the live helper + examples + scripts", () => {
  // Catches a regression class where someone adds a file to scripts/extract/
  // but forgets to update files[] — the file would be on disk locally,
  // pass tests, but be absent from the tarball.
  const pkg = JSON.parse(readFileSync(PKG_JSON, "utf-8")) as { files?: string[] }
  assert.ok(Array.isArray(pkg.files), "package.json must have files[]")
  const required = ["scripts/extract/**", "examples/pytorch/**", "schemas/**", "fixtures/**", "dist/**"]
  for (const pattern of required) {
    assert.ok(
      pkg.files!.includes(pattern),
      `package.json files[] must include '${pattern}' for v0.10.x distribution integrity`,
    )
  }
})
