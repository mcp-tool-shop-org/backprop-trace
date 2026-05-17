/**
 * v0.6 — Generate the canonical PyTorch softmax+CE fixture pair:
 *   - fixtures/external/pytorch.softmax-ce.sidecar.jsonl
 *       (framework-trace.v0.1.0 sidecar — what a PyTorch user would emit
 *        from their training loop via a ~30 LOC Python helper)
 *   - fixtures/external/pytorch.softmax-ce.golden.jsonl
 *       (observer-mode v0.4.0 receipt — what `bp import pytorch` produces
 *        from the sidecar)
 *
 * The sidecar's CLAIMED math is identical to what `runGeneralStep(SOFTMAX_CE_INPUT)`
 * produces, because in v0.6.0 we don't yet have a real PyTorch in CI — we
 * are demonstrating the shape of an external trace. A future fixture
 * authored from an actual PyTorch run would carry minor FP drift in the
 * claimed fields (within attestor.differential_tolerance); the v0.6.0
 * canonical fixture uses engine-equivalent bytes so the differential check
 * passes cleanly and proves the boundary works.
 *
 * Reproducibility: this script reads NO files. Running it from clean
 * reproduces both fixtures byte-for-byte. If V8 Math.exp ever drifts, the
 * canary tests fire BEFORE this script's output drifts silently.
 */

import { writeFileSync } from "node:fs"
import { runGeneralStep } from "../src/general-engine.js"
import { SOFTMAX_CE_INPUT } from "../src/mazur.js"
import { importPytorchSidecar } from "../src/import-pytorch.js"

const PINNED_TIMESTAMP = "2026-05-17T05:30:00Z"
const PINNED_PYTORCH_VERSION = "2.5.0"

// ---- Step 1: produce the engine receipt (this IS what the foreign
//      framework's "claimed" values will mirror for this v0.6.0 demo
//      fixture). The numeric_policy is the v0.5 softmax+CE policy.
const engineReceipt = runGeneralStep(SOFTMAX_CE_INPUT)

// ---- Step 2: build the sidecar. Foreign-claim fields are copied
//      verbatim from the engine output; source_framework declares
//      pytorch + a pinned version. No fixture_status / no schema_version
//      — those are receipt-level fields the importer adds.
const sidecar = {
  format: "framework-trace.v0.1.0",
  source_framework: {
    name: "pytorch",
    version: PINNED_PYTORCH_VERSION,
    information_uri: "https://pytorch.org",
    extractor: {
      name: "bp-import-pytorch-helper",
      version: "0.6.0",
    },
  },
  topology: SOFTMAX_CE_INPUT.topology,
  learning_rate: SOFTMAX_CE_INPUT.learning_rate,
  numeric_policy: SOFTMAX_CE_INPUT.numeric_policy,
  bias_policy: SOFTMAX_CE_INPUT.bias_policy,
  inputs: SOFTMAX_CE_INPUT.inputs,
  targets: SOFTMAX_CE_INPUT.targets,
  parameters_before: SOFTMAX_CE_INPUT.parameters_before,
  forward: engineReceipt.forward,
  loss: engineReceipt.loss,
  backward: engineReceipt.backward,
  updates: engineReceipt.updates,
  parameters_after: engineReceipt.parameters_after,
  // post_update_forward must be flattened to {status, <unit>:..., <unit>:...}
  // for sidecar shape — the engine's runtime shape carries nested `units`
  // but the schema's wire shape uses additionalProperties = ForwardUnit
  // at the same level as `status`.
  post_update_forward: {
    status: engineReceipt.post_update_forward.status,
    ...engineReceipt.post_update_forward.units,
  },
  post_update_loss: engineReceipt.post_update_loss,
}

const sidecarBytes = JSON.stringify(sidecar) + "\n"
writeFileSync("fixtures/external/pytorch.softmax-ce.sidecar.jsonl", sidecarBytes)
console.log("wrote fixtures/external/pytorch.softmax-ce.sidecar.jsonl")

// ---- Step 3: run the importer on the sidecar to produce the v0.4.0
//      observer-mode receipt. PINNED_TIMESTAMP keeps the receipt
//      deterministic across re-runs.
const result = importPytorchSidecar(sidecarBytes, {
  importTimestamp: PINNED_TIMESTAMP,
  fixtureLabel: "pytorch-softmax-ce-imported",
})

writeFileSync(
  "fixtures/external/pytorch.softmax-ce.golden.jsonl",
  result.emittedBytes,
)
console.log("wrote fixtures/external/pytorch.softmax-ce.golden.jsonl")
console.log(`  differentialPassed: ${result.differentialPassed}`)
console.log(`  schema_version: ${result.receipt.schema_version}`)
console.log(
  `  fixture_status: ${result.receipt.fixture_status.authoring_state} / ${result.receipt.fixture_status.verification_state}`,
)
console.log(
  `  source_hash: ${result.receipt.attestor?.import_provenance?.source_hash}`,
)
