---
title: Reference
description: Every bp verb, every public library export, every flag.
sidebar:
  order: 4
---

## CLI

Exit codes are 5-bucket:

| Code | Meaning |
|---|---|
| 0 | Success / pass |
| 1 | Reconciliation or verification failure (or import differential disagreement) |
| 2 | Usage or I/O error (missing file, permission denied, malformed JSON, …) |
| 3 | Invalid CLI argument (unknown flag, malformed `--color` value, …) |
| 4 | Reserved (framework adapter declared but not implemented) |

### Reconcile / verify

```
bp reconcile receipt <file>      Reconcile a receipt against all 26 rules. Exit 1 on first failure.
bp verify mazur [<file>]         Full Mazur gate: schema + reconcile + engine-reproduce + byte-equal-vs-golden + drift.
                                 Default subject: bundled fixtures/mazur.golden.jsonl.
bp verify general <file>         Generalized gate for any v0.2+ receipt (XOR, iris, softmax+CE, observer-mode).
bp verify multi <file.jsonl>     Multi-record JSONL; per-record Rules 1-8 + cross-record Rules 9, 10.
bp validate <file>               Schema-only validation (auto-detects v0.1-v0.7).
```

### Generate canonical receipts (engine-authored)

```
bp generate mazur  [--out F] [--check]    Re-run the Mazur engine, emit canonical bytes.
bp generate xor    [--out F] [--check]    Re-run the XOR engine.
bp generate iris   [--out F] [--check]    Re-run the iris engine.
bp generate from-config <file> [--out F]  Re-run engine from a topology+input JSON.
```

`--check` compares vs. the bundled golden, exit 1 on drift.

### Ingest external framework traces (v0.6+; observer-mode)

```
bp import pytorch    <sidecar.jsonl>          Single-step PyTorch trace.
bp import jax        <sidecar.jsonl>          Single-step JAX trace.
bp import tensorflow <sidecar.jsonl>          Single-step TensorFlow trace.
bp import pytorch    multi <sidecar.jsonl>    Multi-step PyTorch JSONL stream.
bp import jax        multi <sidecar.jsonl>    Multi-step JAX JSONL stream.
bp import tensorflow multi <sidecar.jsonl>    Multi-step TensorFlow JSONL stream.
```

Per-framework subcommand discipline: `bp import pytorch` rejects JAX sidecars and vice versa. No content-based auto-detection. Multi-step bundles also reject heterogeneous-framework streams.

### Author + validate topology+input configs

```
bp scaffold topology --topology mazur|xor|iris [--out F]    Write a starter GeneralInput JSON.
bp validate-input <file>                                    Schema-validate a topology+input config (no engine).
```

### Live framework helpers (v0.10+)

```
bp examples pytorch [--print]    Print absolute path of (or cat to stdout) the bundled PyTorch helper.
```

`bp examples pytorch --print > pytorch_trace_helper.py` is the locked v0.10 workflow. The helper is observer-only; Rule 14 is the authority. See [Usage](../usage/) for the workflow.

### Meta

```
bp --version    Print version, exit 0.
bp --help       Print usage, exit 0.
```

### Common flags

```
--json                       Machine-readable JSON output (Tier-1 error envelope)
--verbose, -V                Diagnostic stderr (file path, schema_version, fixture id)
--color=auto|never|always    ANSI color (honors NO_COLOR)
--out <file>                 (generate / scaffold / import) write to file instead of stdout
--check                      (generate) compare vs golden, exit 1 on drift
--warn-as-fail               (verify) treat WARN as failure
--strict                     (verify) treat any non-PASS as failure
<file> = "-"                 Read from stdin (reconcile, validate, verify general, verify multi)
```

## Library (TypeScript)

```ts
import {
  // Reconciler
  reconcileReceipt,
  reconcileMultiStep,
  type ReconciliationFailure,

  // Engines
  runMazurStep,
  runGeneralStep,
  runBatchedGeneralStep,
  MAZUR_INPUT,
  XOR_INPUT,
  IRIS_INPUT,

  // Schema validation
  validateReceiptSchema,
  validateReceiptOrThrow,
  validateTopologyInput,
  validateFrameworkTraceSidecar,

  // Canonical emission
  emitMazurReceipt,
  emitGeneralReceipt,
  hashReceipt,

  // Engine reproduction
  verifyEngineReproduces,
  verifyGeneralEngineReproduces,

  // Observer-mode import (v0.6+)
  importPytorchSidecar,
  importJaxSidecar,
  importTensorflowSidecar,
  importPytorchSidecarStream,    // multi-step
  importJaxSidecarStream,
  importTensorflowSidecarStream,
} from '@mcptoolshop/backprop-trace';
```

Subpath imports (smaller bundle):

```
./reconcile         ./engine            ./general-engine
./mazur             ./topology          ./activations
./emit              ./format            ./runtime-format
./validate          ./parse             ./parse-input
./hash              ./schema-loader     ./verify-engine
./extract           ./import-pytorch    ./import-jax
./import-tensorflow ./import-observer
./schema/0.1.0      ./schema/0.2.0      ./schema/0.3.0
./schema/receipt-0.4.0  ./schema/receipt-0.5.0
./schema/receipt-0.6.0  ./schema/receipt-0.7.0
./schema/0.4.0  (topology-input)
./schema/framework-trace-0.1.0  ./schema/framework-trace-0.2.0
./schema/framework-trace-0.3.0  ./schema/framework-trace-0.4.0
./schema/framework-trace-0.5.0  ./schema/framework-trace-0.6.0
./schema/framework-trace-0.7.0
```

## The 26 rules (full statements)

Full statements + paired bad fixtures live in [`docs/reconciliation.md`](https://github.com/mcp-tool-shop-org/backprop-trace/blob/main/docs/reconciliation.md). Brief table:

| # | Rule |
|---|---|
| 0 | Structural-failure sentinel (schema-level) |
| 0.8 | Probability bounds — softmax outputs in [0, 1] |
| 1 | Output error signal consistency |
| 2 | Downstream contribution + backpropagated sum |
| 3 | Hidden error signal consistency |
| 4 | Update gradient consistency |
| 5 | Update value consistency (GATED OFF for non-SGD; Adam/AdamW use Rule 24) |
| 6 | Weight progression (AdamW branch adds `(1 - lr*wd)` decoupled-decay) |
| 7 | Final state consistency (AdamW branch adds decoupled-decay) |
| 8 | Provenance reference consistency |
| 9 | Multi-step parameter chain |
| 10 | Multi-step trace identity |
| 11 | Softmax normalization |
| 12 | Loss formula consistency (skipped for batched — Rule 18 handles it) |
| 13 | Dual-form consistency (softmax+CE jacobian; GATED) |
| 14 | **Engine-recompute differential** (MANDATORY for observer-mode imports) |
| 15 | Skip-basis required (closed enum, 4 values) |
| 16 | Attestation digest binding (GATED) |
| 17 | Trace-bundle binding — bundle-integrity / post-binding mutation detection (GATED) |
| 18 | Batch reduction consistency (GATED) |
| 19 | Sample-set coherence (GATED) |
| 20 | **v0.9.1+** Optimizer-state shape consistency |
| 21 | **v0.9.2/3** PyTorch-style SGD momentum: 21a buffer recurrence + 21b effective direction + 21c parameter update |
| 22 | **v0.9.1** Adam moment recurrences (22a, 22b) |
| 23 | **v0.9.1** Adam bias correction + `t` consistency |
| 24 | **v0.9.1** Adam/AdamW parameter update (epsilon OUTSIDE sqrt — PyTorch convention) |
| 25 | **v0.9.1** Multi-step optimizer-state chain |
| 26 | **v0.9.1** Multi-step optimizer-config constancy |

## Closed enums (the schema surface)

These vocabularies are part of the contract — widening them forces a schema-version bump (documented in [`docs/schema.md`](https://github.com/mcp-tool-shop-org/backprop-trace/blob/main/docs/schema.md)).

- `optimizer.name` — `"sgd" | "adam" | "adamw" | "sgd_momentum"`
- `helper.distribution` — `"repo-script" | "pypi" | "vendored"` (v0.7.0+)
- `helper.framework.name` — `"pytorch" | "jax" | "tensorflow"` (v0.7.0+)
- `helper.extraction.device` — `"cpu" | "cuda" | "mps" | "xla"` (v0.7.0+)
- `fixture_status.authoring_state` — `"hand_authored" | "engine_generated" | "external_imported" | "deliberately_broken"`
- `fixture_status.verification_state` — `"engine_recompute_matched_within_tolerance" | "engine_recompute_disagreed" | ...`
- `EXTERNAL_TRUST_BASIS` (Rule 15) — 4 values
- `topology.activation_hidden` — `"sigmoid" | "identity" | "relu"`
- `topology.activation_output` — `"sigmoid" | "identity" | "relu" | "softmax"`
- `topology.loss` — `"half_squared_error" | "cross_entropy_softmax"`
- `topology.bias_sharing` — `"per_layer" | "per_neuron"`

## Next steps

- **Architecture overview** → [Architecture](../architecture/)
- **Trust boundary + threat model** → [Security](../security/)
