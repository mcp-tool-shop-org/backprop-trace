/**
 * ING-2 — verifier-owned ingest bounds on observer-mode sidecar import.
 *
 * The framework-trace sidecar schemas (framework-trace.v0.1.0..v0.7.0) put NO
 * maxItems on updates[]/factors[]/summation_order[] and NO maxProperties on the
 * UnitNumberMap / ParameterMap / ForwardMap / loss.per_output object defs.
 * buildObserverReceiptFromSidecar (src/import-observer.ts) JSON.parses the whole
 * sidecar, Ajv-validates, iterates updates, and copies raw maps into the receipt
 * which JSON.stringify then walks at emit — all unbounded in attacker input.
 *
 * Verified pre-fix: a 3,000,000-unit forward map is fully parsed / validated /
 * held (~6s); a 2,000,000-entry updates[] throws a raw `Invalid string length`
 * at emit (no diagnosable cap message). The topology is already capped (units
 * 1..64) and Rule 14 batched recompute has MAX_BATCH_SAMPLES — this is the
 * INGEST path that lacked bounds.
 *
 * FIX (defense in depth, two layers):
 *   1. Schema bounds — maxItems (updates[]/factors[]/summation_order[]) and
 *      maxProperties (UnitNumberMap/ParameterMap/ForwardMap/loss.per_output)
 *      across all framework-trace schema versions, tied to the 64-unit topology
 *      ceiling with generous headroom (4096).
 *   2. A verifier-owned ingest cap in buildObserverReceiptFromSidecar — a raw
 *      MAX_SIDECAR_INGEST_BYTES byte cap (rejects BEFORE parse/validate/emit, so
 *      even the raw `Invalid string length` path becomes a diagnosable message)
 *      plus a post-validation MAX_SIDECAR_COLLECTION_ENTRIES structural cap.
 *
 * INVARIANT pinned here (both halves):
 *   - A schema-valid-but-oversized sidecar (forward map or updates array beyond
 *     the cap) is REJECTED with a DIAGNOSABLE structured error — NOT
 *     `Invalid string length`, NOT a silent accept — AND no partial/oversized
 *     receipt is emitted.
 *   - Every honest golden sidecar (fixtures/external/*.sidecar.jsonl) still
 *     imports CLEANLY (the cap does not mis-fire on legitimate inputs).
 */

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"
import {
  MAX_SIDECAR_INGEST_BYTES,
  MAX_SIDECAR_COLLECTION_ENTRIES,
} from "../src/import-observer.js"
import { importPytorchSidecar, importPytorchSidecarStream } from "../src/import-pytorch.js"
import { importJaxSidecar, importJaxSidecarStream } from "../src/import-jax.js"
import {
  importTensorflowSidecar,
  importTensorflowSidecarStream,
} from "../src/import-tensorflow.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, "..")
const externalDir = resolve(repoRoot, "fixtures/external")
const cleanSidecarPath = resolve(externalDir, "pytorch.softmax-ce.sidecar.jsonl")

const PINNED_TIMESTAMP = "2026-06-23T00:00:00Z"

/** A minimal valid v0.1.0 single-step pytorch sidecar template (cloned per use). */
function loadTemplate(): Record<string, unknown> {
  return JSON.parse(readFileSync(cleanSidecarPath, "utf-8").trim())
}

// The cap message is the same diagnosable phrase across both cap layers.
const CAP_PHRASE = /exceeds verifier ingest cap/i

// =============================================================================
// Pin the cap constants. A silent raise re-opens the DoS surface; a silent
// lower could false-reject a legitimate sidecar. Both are regressions.
// =============================================================================
test("ING-2: ingest cap constants are pinned (8 MiB bytes / 4096 entries)", () => {
  assert.strictEqual(
    MAX_SIDECAR_INGEST_BYTES,
    8 * 1024 * 1024,
    "MAX_SIDECAR_INGEST_BYTES must stay 8 MiB — pinned so a silent raise/lower surfaces in CI",
  )
  assert.strictEqual(
    MAX_SIDECAR_COLLECTION_ENTRIES,
    4096,
    "MAX_SIDECAR_COLLECTION_ENTRIES must stay 4096 — in lockstep with the schemas' maxItems/maxProperties",
  )
})

// =============================================================================
// HALF 1a — raw-byte cap. A sidecar whose raw bytes exceed the ingest cap is
// rejected with a DIAGNOSABLE message BEFORE parse/validate/emit — converting
// the pre-fix raw `Invalid string length` (a multi-million-entry updates[])
// into a clear "exceeds verifier ingest cap" rejection. No receipt emitted.
// =============================================================================
test("ING-2: an oversized-by-BYTES sidecar (huge updates[]) is rejected with a diagnosable cap error, NOT 'Invalid string length', and emits no receipt", () => {
  const tpl = loadTemplate()
  const realUpdate = (tpl.updates as unknown[])[0]
  // Inflate updates[] until the serialized sidecar is comfortably over the byte
  // cap. Each cloned update is the real ~hundreds-of-bytes shape, so a few tens
  // of thousands of clones crosses 8 MiB without approaching V8's ~512MB string
  // limit (we want to prove the cap fires FIRST, before any Invalid-string-length).
  const perUpdateBytes = JSON.stringify(realUpdate).length
  const needed = Math.ceil((MAX_SIDECAR_INGEST_BYTES + 1) / perUpdateBytes) + 16
  const bloatedUpdates = new Array(needed)
  for (let i = 0; i < needed; i += 1) {
    // Distinct parameter_id so nothing dedupes; structurally identical otherwise.
    bloatedUpdates[i] = { ...(realUpdate as Record<string, unknown>), parameter_id: `w_bloat_${i}` }
  }
  tpl.updates = bloatedUpdates

  const oversizedBytes = JSON.stringify(tpl) + "\n"
  assert.ok(
    Buffer.byteLength(oversizedBytes, "utf8") > MAX_SIDECAR_INGEST_BYTES,
    "test setup: the bloated sidecar must exceed the byte cap",
  )

  let threw: Error | undefined
  let returned: unknown
  try {
    returned = importPytorchSidecar(oversizedBytes, { importTimestamp: PINNED_TIMESTAMP })
  } catch (e) {
    threw = e as Error
  }

  assert.ok(threw, "oversized-by-bytes sidecar MUST be rejected (the importer must throw)")
  assert.strictEqual(returned, undefined, "no partial/oversized receipt may be returned/emitted")
  assert.match(
    threw!.message,
    CAP_PHRASE,
    `rejection must be a DIAGNOSABLE cap error; got: ${threw!.message}`,
  )
  assert.doesNotMatch(
    threw!.message,
    /Invalid string length/i,
    "the cap must convert the raw V8 'Invalid string length' path into a diagnosable message",
  )
})

// =============================================================================
// HALF 1b — structural / count cap. A sidecar whose forward map carries more
// than MAX_SIDECAR_COLLECTION_ENTRIES entries (but stays well under the byte
// cap) is also REJECTED with a diagnosable structured error (schema maxProperties
// and/or the verifier-owned structural cap) — NOT silently accepted, NOT a raw
// Ajv/runtime stack. No receipt emitted.
// =============================================================================
test("ING-2: an oversized-by-COUNT sidecar (forward map beyond the entry cap) is rejected with a diagnosable structured error and emits no receipt", () => {
  const tpl = loadTemplate()
  // Build a forward map with > cap small units (~30 bytes each ≈ 120KB total —
  // far under the 8 MiB byte cap, so this isolates the count/structural layer).
  const forward: Record<string, { net: number; out: number }> = {}
  const count = MAX_SIDECAR_COLLECTION_ENTRIES + 5
  for (let i = 0; i < count; i += 1) forward[`u${i}`] = { net: 0, out: 0 }
  tpl.forward = forward

  const oversizedBytes = JSON.stringify(tpl) + "\n"
  assert.ok(
    Buffer.byteLength(oversizedBytes, "utf8") <= MAX_SIDECAR_INGEST_BYTES,
    "test setup: the count-inflated sidecar must stay UNDER the byte cap so this isolates the structural/schema layer",
  )

  let threw: Error | undefined
  let returned: unknown
  try {
    returned = importPytorchSidecar(oversizedBytes, { importTimestamp: PINNED_TIMESTAMP })
  } catch (e) {
    threw = e as Error
  }

  assert.ok(threw, "oversized-by-count sidecar MUST be rejected (the importer must throw)")
  assert.strictEqual(returned, undefined, "no partial/oversized receipt may be returned/emitted")
  assert.doesNotMatch(
    threw!.message,
    /Invalid string length/i,
    "must not surface a raw V8 string-length error",
  )
  // Diagnosable: either the verifier-owned cap phrase OR the schema's
  // maxProperties validation error (both name the bound + the offending field).
  assert.ok(
    CAP_PHRASE.test(threw!.message) ||
      /maxProperties|must NOT have more than|framework-trace\.v.* validation/i.test(threw!.message),
    `rejection must be DIAGNOSABLE (cap phrase or schema maxProperties); got: ${threw!.message}`,
  )
})

// =============================================================================
// HALF 1c — the schema bound itself is wired for updates[] (maxItems). A count
// of updates beyond the cap, under the byte cap, is rejected diagnosably.
// =============================================================================
test("ING-2: an oversized-by-COUNT updates[] (beyond the entry cap, under the byte cap) is rejected diagnosably", () => {
  const tpl = loadTemplate()
  const realUpdate = (tpl.updates as unknown[])[0] as Record<string, unknown>
  const count = MAX_SIDECAR_COLLECTION_ENTRIES + 5
  const updates = new Array(count)
  for (let i = 0; i < count; i += 1) updates[i] = { ...realUpdate, parameter_id: `w_x_${i}` }
  tpl.updates = updates

  const bytes = JSON.stringify(tpl) + "\n"
  // ~hundreds of bytes * ~4101 ≈ low MB — confirm it stays under the byte cap so
  // we are exercising the count layer, not the byte layer.
  assert.ok(
    Buffer.byteLength(bytes, "utf8") <= MAX_SIDECAR_INGEST_BYTES,
    "test setup: updates[]-count sidecar must stay under the byte cap",
  )

  let threw: Error | undefined
  try {
    importPytorchSidecar(bytes, { importTimestamp: PINNED_TIMESTAMP })
  } catch (e) {
    threw = e as Error
  }
  assert.ok(threw, "oversized-by-count updates[] MUST be rejected")
  assert.doesNotMatch(threw!.message, /Invalid string length/i)
  assert.ok(
    CAP_PHRASE.test(threw!.message) ||
      /maxItems|must NOT have more than|framework-trace\.v.* validation/i.test(threw!.message),
    `rejection must be DIAGNOSABLE (cap phrase or schema maxItems); got: ${threw!.message}`,
  )
})

// =============================================================================
// HALF 2 — the cap does NOT mis-fire on legitimate inputs: every honest golden
// sidecar (fixtures/external/*.sidecar.jsonl) still imports CLEANLY through its
// correct per-framework / single-vs-multi path.
// =============================================================================
type SingleImporter = (bytes: string, opts?: { importTimestamp?: string }) => { emittedBytes: string }
type StreamImporter = (bytes: string, opts?: { importTimestamp?: string }) => { emittedBytes: string }

const SINGLE: Record<string, SingleImporter> = {
  pytorch: importPytorchSidecar,
  jax: importJaxSidecar,
  tensorflow: importTensorflowSidecar,
}
const STREAM: Record<string, StreamImporter> = {
  pytorch: importPytorchSidecarStream,
  jax: importJaxSidecarStream,
  tensorflow: importTensorflowSidecarStream,
}

test("ING-2: every honest golden sidecar still imports cleanly (cap does not mis-fire on legitimate inputs)", () => {
  const files = readdirSync(externalDir).filter((f) => f.endsWith(".sidecar.jsonl"))
  assert.ok(files.length > 0, "expected at least one honest golden sidecar fixture")

  for (const file of files) {
    const path = resolve(externalDir, file)
    const bytes = readFileSync(path, "utf-8")
    const lines = bytes.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0)
    const first = JSON.parse(lines[0]!) as {
      source_framework: { name: string }
      format: string
    }
    const fw = first.source_framework.name
    // Routing: v0.2.0 is the multi-step baseline; any file with >1 record is
    // multi-step; everything else is single-step (v0.1.0 / v0.3.0..v0.7.0).
    const isMulti = lines.length > 1 || first.format === "framework-trace.v0.2.0"

    // Honest goldens must be under the byte cap — confirm the cap never even
    // considers rejecting them.
    assert.ok(
      Buffer.byteLength(bytes, "utf8") <= MAX_SIDECAR_INGEST_BYTES,
      `golden ${file} must be under the ingest byte cap`,
    )

    const importer = isMulti ? STREAM[fw] : SINGLE[fw]
    if (!importer) {
      throw new Error(`test gap: no importer wired for framework '${fw}' (fixture ${file})`)
    }

    let result: { emittedBytes: string } | undefined
    let threw: Error | undefined
    try {
      result = importer(bytes, { importTimestamp: PINNED_TIMESTAMP })
    } catch (e) {
      threw = e as Error
    }

    // The cap must NOT be the reason any honest golden fails to import.
    if (threw) {
      assert.doesNotMatch(
        threw.message,
        CAP_PHRASE,
        `the ingest cap MUST NOT mis-fire on honest golden ${file}: ${threw.message}`,
      )
      // Any other throw is an unexpected regression in this suite's scope.
      throw new Error(`honest golden ${file} failed to import: ${threw.message}`)
    }
    assert.ok(result, `honest golden ${file} must import to a result`)
    assert.ok(
      result!.emittedBytes.length > 0,
      `honest golden ${file} must emit non-empty canonical bytes`,
    )
  }
})
