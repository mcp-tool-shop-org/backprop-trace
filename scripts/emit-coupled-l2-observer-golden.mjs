#!/usr/bin/env node
/**
 * Emit the v0.13 SGD coupled-L2 OBSERVER receipt golden.
 *
 * Reads the real-torch coupled-L2 sidecar produced by
 * scripts/generate-pytorch-coupled-l2-helper-goldens.py, imports it through the
 * pure-TS `importPytorchSidecar` (the exact path the v0.4.0-0.7.0
 * differential_tolerance goldens were made with), and writes the canonical
 * observer-receipt bytes — which carry `attestor.differential_tolerance` — to
 * fixtures/external/pytorch.sgd-coupled-l2.golden.jsonl.
 *
 * The import timestamp is PINNED so the golden is byte-stable. Rule 14
 * (engine-recompute differential) must pass on the honest helper sidecar; the
 * script aborts loudly if it does not.
 *
 * Node-only (no torch). Reproducible: re-running regenerates byte-identical
 * output from the checked-in sidecar.
 */
import { readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { importPytorchSidecar } from "../dist/import-pytorch.js"

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, "..")
const SIDECAR = resolve(
  REPO_ROOT,
  "fixtures/external/pytorch.helper-emitted.sgd-coupled-l2.sidecar.jsonl",
)
const OUT = resolve(REPO_ROOT, "fixtures/external/pytorch.sgd-coupled-l2.golden.jsonl")

const sidecarBytes = readFileSync(SIDECAR, "utf-8").trim()

const result = importPytorchSidecar(sidecarBytes, {
  // Pinned timestamp -> byte-stable golden.
  importTimestamp: "2026-06-01T00:00:00Z",
})

if (!result.differentialPassed) {
  console.error(
    "Rule 14 differential FAILED on the honest coupled-L2 sidecar — refusing to write a dishonest golden:",
    JSON.stringify(result.differentialDisagreements.slice(0, 8), null, 2),
  )
  process.exit(1)
}

const receipt = result.receipt
const dt = receipt.attestor?.differential_tolerance
if (!dt || typeof dt.atol !== "number" || typeof dt.rtol !== "number") {
  console.error("imported receipt is missing attestor.differential_tolerance:", JSON.stringify(receipt.attestor))
  process.exit(1)
}

// emittedBytes already ends with the canonical record; normalize to one
// trailing newline (JSONL line convention, matching the sibling goldens).
const bytes = result.emittedBytes.endsWith("\n")
  ? result.emittedBytes
  : result.emittedBytes + "\n"

writeFileSync(OUT, bytes, "utf-8")
console.log(
  `wrote ${OUT.replace(REPO_ROOT + "\\", "").replace(/\\/g, "/")} ` +
    `(schema_version=${receipt.schema_version}, ` +
    `attestor.differential_tolerance={atol:${dt.atol},rtol:${dt.rtol}}, ` +
    `differentialPassed=${result.differentialPassed})`,
)
