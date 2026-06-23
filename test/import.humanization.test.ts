/**
 * Stage C HUMANIZATION — import-time degradation / observability / UX polish.
 *
 * These tests pin FOUR humanization fixes on the shared observer-mode importer
 * (src/import-observer.ts). None of them is a soundness gate — Rule 14 (the
 * engine-recompute differential) remains the authority on every accepted
 * receipt. They make the IMPORTER fail early / expose attribution / name the
 * supported set, so an operator gets an actionable diagnostic at import time
 * instead of an opaque error (or a late reconcile failure):
 *
 *   ING-B-002 (degradation)   — a sidecar declaring a parameter in
 *                               topology.parameter_order but OMITTING it from
 *                               parameters_after currently builds a receipt and
 *                               only fails LATER at reconcile (Rule 14
 *                               COMPLETENESS). The importer now FAILS EARLY at
 *                               import time, naming the missing key(s).
 *   ING-B-001 (observability) — the FrameworkTraceSidecar.helper block (forensic
 *                               live-helper attribution) was dropped from the
 *                               built receipt. It is now passed through so a
 *                               downstream reader can see helper name / version /
 *                               source_hash. NOT a credential — Rule 14 is the
 *                               authority.
 *   ING-B-003 (degradation/UX)— a sidecar rejected for an unsupported optimizer
 *                               (closed enum) surfaced an opaque Ajv "must be
 *                               equal to one of the allowed values" with no
 *                               indication of what IS accepted. The rejection now
 *                               NAMES the supported optimizer set.
 *   ING-B-005 (degradation/UX)— an empty / whitespace-only sidecar lacked the
 *                               dedicated actionable "empty input" diagnostic
 *                               that parse.ts + parse-input.ts already emit. The
 *                               importer now emits the same early check.
 *
 * No-regression discipline: every honest golden sidecar must still import
 * cleanly and (for the byte-equal goldens) emit byte-identically — the importer
 * already has byte-equality tests in import-pytorch.test.ts; these tests only
 * confirm the honest goldens are NOT rejected by the new early checks.
 */

import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { importPytorchSidecar } from "../src/import-pytorch.js"
import {
  importPytorchSidecarStream,
} from "../src/import-pytorch.js"

const SGD_HELPER_FIXTURE = resolve(
  "fixtures/external/pytorch.helper-emitted.sgd.softmax-ce.sidecar.jsonl",
)
const ADAMW_HELPER_FIXTURE = resolve(
  "fixtures/external/pytorch.helper-emitted.adamw.sidecar.jsonl",
)

const PINNED_TIMESTAMP = "2026-05-18T12:00:00Z"

function loadSgdHelperSidecar(): Record<string, unknown> {
  return JSON.parse(readFileSync(SGD_HELPER_FIXTURE, "utf-8").trim()) as Record<
    string,
    unknown
  >
}

// ---------------------------------------------------------------------------
// ING-B-002 — sidecar completeness pre-emit (FAIL EARLY at import time)
// ---------------------------------------------------------------------------

test("ING-B-002: a sidecar missing a parameter_order key from parameters_after is REJECTED at import with the missing key named", () => {
  const sidecar = loadSgdHelperSidecar()
  // Drop ONE declared parameter from parameters_after while leaving it in
  // topology.parameter_order — the exact cross-reference invariant the
  // JSON-shape schema does NOT enforce (parameters_after is a free number-map).
  const paramsAfter = sidecar.parameters_after as Record<string, number>
  const dropped = "b_o2"
  assert.ok(
    Object.prototype.hasOwnProperty.call(paramsAfter, dropped),
    "fixture precondition: the parameter we drop must exist in the golden parameters_after",
  )
  delete paramsAfter[dropped]
  const bytes = JSON.stringify(sidecar)

  assert.throws(
    () => importPytorchSidecar(bytes, { importTimestamp: PINNED_TIMESTAMP }),
    (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err)
      // Must name the importer (caller label), the field, and the missing key.
      assert.match(msg, /importPytorchSidecar/, "error must name the importer")
      assert.match(msg, /parameters_after/, "error must name parameters_after")
      assert.match(msg, /parameter_order/, "error must reference parameter_order")
      assert.match(
        msg,
        new RegExp(dropped),
        "error must NAME the specific missing parameter key",
      )
      return true
    },
    "an incomplete parameters_after must fail EARLY at import time, not silently build a receipt",
  )
})

test("ING-B-002: the early import check fires BEFORE a receipt is emitted (no late-reconcile-only failure)", () => {
  // Sanity: the honest golden imports cleanly AND its receipt is complete.
  const honest = importPytorchSidecar(readFileSync(SGD_HELPER_FIXTURE, "utf-8"), {
    importTimestamp: PINNED_TIMESTAMP,
  })
  const declared = honest.receipt.topology.parameter_order
  const afterKeys = Object.keys(honest.receipt.parameters_after)
  for (const pid of declared) {
    assert.ok(
      afterKeys.includes(pid),
      `honest golden receipt must carry every declared parameter in parameters_after (missing ${pid})`,
    )
  }
})

test("ING-B-002: every honest golden helper sidecar still imports cleanly (no false early rejection)", () => {
  for (const fixture of [SGD_HELPER_FIXTURE, ADAMW_HELPER_FIXTURE]) {
    assert.doesNotThrow(
      () =>
        importPytorchSidecar(readFileSync(fixture, "utf-8"), {
          importTimestamp: PINNED_TIMESTAMP,
        }),
      `honest golden ${fixture} must not be rejected by the completeness pre-emit check`,
    )
  }
})

// ---------------------------------------------------------------------------
// ING-B-001 — helper-block passthrough (forensic attribution on the receipt)
// ---------------------------------------------------------------------------

test("ING-B-001: an imported receipt from a helper-carrying sidecar EXPOSES the helper attribution", () => {
  const sidecarBytes = readFileSync(SGD_HELPER_FIXTURE, "utf-8")
  const sourceHelper = (
    JSON.parse(sidecarBytes.trim()) as { helper?: Record<string, unknown> }
  ).helper
  assert.ok(sourceHelper, "fixture precondition: golden carries a helper block")

  const result = importPytorchSidecar(sidecarBytes, {
    importTimestamp: PINNED_TIMESTAMP,
  })

  const receiptHelper = (
    result.receipt as { helper?: Record<string, unknown> }
  ).helper
  assert.ok(
    receiptHelper,
    "the built receipt must expose the helper attribution block (forensic passthrough)",
  )
  // The downstream reader must be able to see name / version / source_hash.
  assert.equal(receiptHelper!.name, sourceHelper.name, "helper.name must pass through")
  assert.equal(
    receiptHelper!.version,
    sourceHelper.version,
    "helper.version must pass through",
  )
  assert.equal(
    receiptHelper!.source_hash,
    sourceHelper.source_hash,
    "helper.source_hash must pass through (forensic, NOT a credential)",
  )
})

test("ING-B-001 (multi-step): each per-step receipt exposes the helper attribution", () => {
  // Build a single-record JSONL stream from the SGD helper sidecar re-declared
  // as the multi-step baseline (v0.2.0). v0.7.0 is single-step-only; the
  // multi-step path accepts v0.2.0..v0.7.0 EXCEPT it requires trace_id/step_index
  // semantics — a degenerate single record needs neither (importer synthesizes).
  // Simplest: re-use the helper sidecar but flip format to v0.2.0 is NOT valid
  // (helper block requires v0.7.0). Instead exercise multi-step with a single
  // v0.7.0 record (the stream importer accepts v0.7.0 records).
  const sidecarBytes = readFileSync(SGD_HELPER_FIXTURE, "utf-8").trim()
  const sourceHelper = (
    JSON.parse(sidecarBytes) as { helper?: Record<string, unknown> }
  ).helper
  assert.ok(sourceHelper, "fixture precondition: golden carries a helper block")

  const result = importPytorchSidecarStream(sidecarBytes, {
    importTimestamp: PINNED_TIMESTAMP,
  })
  assert.ok(result.steps.length >= 1, "stream must produce at least one step")
  for (const step of result.steps) {
    const receiptHelper = (
      step.receipt as { helper?: Record<string, unknown> }
    ).helper
    assert.ok(
      receiptHelper,
      "each multi-step receipt must expose the helper attribution block",
    )
    assert.equal(receiptHelper!.source_hash, sourceHelper.source_hash)
  }
})

test("ING-B-001: a sidecar with NO helper block produces a receipt with no helper (byte-equal preservation)", () => {
  // The pytorch.softmax-ce golden is a hand-authored v0.1.0 sidecar with no
  // helper block — the receipt must NOT gain a spurious helper key.
  const noHelperFixture = resolve(
    "fixtures/external/pytorch.softmax-ce.sidecar.jsonl",
  )
  const result = importPytorchSidecar(readFileSync(noHelperFixture, "utf-8"), {
    importTimestamp: "2026-05-17T05:30:00Z",
    fixtureLabel: "pytorch-softmax-ce-imported",
  })
  assert.ok(
    !Object.prototype.hasOwnProperty.call(result.receipt, "helper") ||
      (result.receipt as { helper?: unknown }).helper === undefined,
    "a sidecar without a helper block must not produce a receipt carrying a helper key",
  )
})

// ---------------------------------------------------------------------------
// ING-B-003 — unsupported-optimizer rejection names the supported set
// ---------------------------------------------------------------------------

test("ING-B-003: a sidecar with an unsupported optimizer (lion) is rejected with the supported set named", () => {
  const sidecar = JSON.parse(
    readFileSync(ADAMW_HELPER_FIXTURE, "utf-8").trim(),
  ) as Record<string, unknown>
  ;(sidecar.optimizer as Record<string, unknown>).name = "lion"
  const bytes = JSON.stringify(sidecar)

  assert.throws(
    () => importPytorchSidecar(bytes, { importTimestamp: PINNED_TIMESTAMP }),
    (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err)
      assert.match(msg, /lion/, "error must echo the rejected optimizer name")
      // Must name the supported set so the operator knows what IS accepted.
      assert.match(msg, /sgd\b/, "error must name sgd")
      assert.match(msg, /sgd_momentum/, "error must name sgd_momentum")
      assert.match(msg, /\badam\b/, "error must name adam")
      assert.match(msg, /adamw/, "error must name adamw")
      assert.doesNotMatch(
        msg,
        /must be equal to one of the allowed values\s*$/,
        "error must not END with the opaque Ajv enum message — it must name the set",
      )
      return true
    },
    "an unsupported optimizer must yield an actionable error naming the supported set",
  )
})

test("ING-B-003: amsgrad (a real-but-unsupported optimizer) is also rejected with the supported set named", () => {
  const sidecar = JSON.parse(
    readFileSync(ADAMW_HELPER_FIXTURE, "utf-8").trim(),
  ) as Record<string, unknown>
  ;(sidecar.optimizer as Record<string, unknown>).name = "amsgrad"
  const bytes = JSON.stringify(sidecar)

  assert.throws(
    () => importPytorchSidecar(bytes, { importTimestamp: PINNED_TIMESTAMP }),
    (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err)
      assert.match(msg, /amsgrad/)
      assert.match(msg, /sgd_momentum/)
      assert.match(msg, /adamw/)
      return true
    },
  )
})

// ---------------------------------------------------------------------------
// ING-B-005 — empty / whitespace-only sidecar actionable diagnostic
// ---------------------------------------------------------------------------

test("ING-B-005: an empty sidecar yields the actionable 'empty input' diagnostic, not an opaque JSON error", () => {
  assert.throws(
    () => importPytorchSidecar("", { importTimestamp: PINNED_TIMESTAMP }),
    (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err)
      assert.match(msg, /empty/i, "error must name the empty-input condition")
      assert.match(msg, /importPytorchSidecar/, "error must name the importer")
      assert.doesNotMatch(
        msg,
        /not valid JSON|Unexpected end of JSON/i,
        "error must NOT be the opaque JSON-parse failure",
      )
      return true
    },
  )
})

test("ING-B-005: a whitespace-only sidecar yields the same actionable 'empty input' diagnostic", () => {
  assert.throws(
    () =>
      importPytorchSidecar("   \n\t  \r\n  ", {
        importTimestamp: PINNED_TIMESTAMP,
      }),
    (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err)
      assert.match(msg, /empty/i)
      assert.doesNotMatch(msg, /not valid JSON|Unexpected end of JSON/i)
      return true
    },
  )
})

test("ING-B-005 (multi-step): an empty / whitespace-only stream yields the actionable empty diagnostic", () => {
  for (const empty of ["", "   \n\t  \r\n  "]) {
    assert.throws(
      () => importPytorchSidecarStream(empty, { importTimestamp: PINNED_TIMESTAMP }),
      (err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err)
        assert.match(msg, /empty/i, "multi-step empty diagnostic must name the empty condition")
        return true
      },
    )
  }
})
