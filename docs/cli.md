# `bp` CLI reference

The `bp` binary is the user-facing entry point for `@mcptoolshop/backprop-trace`.
It exposes subcommands that compose the library's primitives into the
common verification, authoring, and ingestion flows:

- **reconcile** (per-record math check against the 26 rules; see [`docs/reconciliation.md`](./reconciliation.md))
- **verify** (full gate; Mazur / general / multi-step)
- **generate** (Mazur / XOR / iris / from-config)
- **import** (v0.6+ external trace ingestion; per-framework subcommands)
- **scaffold topology** (write a starter input file; v0.4+)
- **validate-input** (schema-validate a topology input config; v0.4+)
- **validate** (schema-validate a receipt)

The CLI is dependency-free (no commander / yargs / citty); the argv dispatch
is hand-rolled at `src/bin/bp.ts` per the study-swarm CLI-ergonomics finding
(`commander` and `citty` don't add value at the v0.4 surface size).

```
bp <verb> <noun> [args]
```

Run `bp --help` for the at-a-glance summary, `bp <subcommand> --help` for
the subcommand-specific text.

## Subcommands at a glance

| Command | Purpose | Typical exit |
|---|---|---|
| `bp reconcile receipt <file>` | Run the per-record reconciliation rules against a receipt | 0 / 1 |
| `bp verify mazur [<file>]` | Full gate (Mazur): schema + reconcile + engine-reproduce + byte-equal + drift | 0 / 1 |
| `bp verify general <file>` | Generalized verify gate for any v0.2.0-schema receipt | 0 / 1 |
| `bp verify multi <file.jsonl>` | Multi-record verify: cross-record Rules 9 + 10 (+ 17/25/26 when gated) + the per-record rules on each receipt (v0.3+) | 0 / 1 |
| `bp generate mazur [--out F] [--check]` | Re-run the Mazur engine, emit canonical JSONL | 0 / 1 |
| `bp generate xor [--out F]` | Re-run the XOR engine, emit canonical JSONL (v0.3+) | 0 / 1 |
| `bp generate iris [--out F]` | Re-run the iris engine, emit canonical JSONL (v0.3+) | 0 / 1 |
| `bp generate from-config <file> [--out F] [--check]` | Read a topology+input JSON, emit a canonical receipt (v0.4+) | 0 / 1 |
| `bp scaffold topology --topology mazur\|xor\|iris [--out F]` | Write a sample input file to bootstrap a new topology (v0.4+) | 0 / 1 |
| `bp validate-input <file>` | Schema-validate a topology-input config without running the engine (v0.4+) | 0 / 1 |
| `bp validate <file>` | Schema-only validation of a receipt; auto-detects v0.1.0 / v0.2.0 / v0.3.0 / v0.4.0 | 0 / 1 |
| `bp import pytorch <sidecar.jsonl> [--out F]` | Convert a framework-trace.v0.1.0 (unbatched) OR v0.3.0 (batched, v0.9+) PyTorch sidecar to an observer-mode v0.4.0 receipt (v0.6+) | 0 / 1 / 2 / 4 |
| `bp import jax <sidecar.jsonl> [--out F]` | Same as `bp import pytorch` but accepts `source_framework.name == "jax"` sidecars (v0.6.1+) | 0 / 1 / 2 / 4 |
| `bp import tensorflow <sidecar.jsonl> [--out F]` | Same as `bp import pytorch` but accepts `source_framework.name == "tensorflow"` sidecars (v0.7.0+) | 0 / 1 / 2 / 4 |
| `bp import pytorch multi <sidecar.jsonl> [--out F]` | Convert a framework-trace.v0.2.0 (multi-step) OR v0.3.0 (multi-step + batched) PyTorch JSONL stream to N observer-mode v0.4.0 receipts (v0.8+; batched v0.9+) | 0 / 1 / 2 / 3 |
| `bp import jax multi <sidecar.jsonl> [--out F]` | Same as `bp import pytorch multi` but JAX (v0.8+) | 0 / 1 / 2 / 3 |
| `bp import tensorflow multi <sidecar.jsonl> [--out F]` | Same as `bp import pytorch multi` but TensorFlow (v0.8+) | 0 / 1 / 2 / 3 |

All subcommands accept `-` as the file argument to read from stdin
(except `generate mazur / xor / iris`, which write rather than read, and
`scaffold topology`, which writes but takes no file input).

## Subcommand: `bp import pytorch` (v0.6+)

```
bp import pytorch <sidecar.jsonl> [--out <file>] [--json] [--verbose]
```

Convert a `framework-trace.v0.1.0` sidecar (emitted by a PyTorch training
loop via a ~30 LOC user-authored Python helper, or hand-authored for
fixture work) into a canonical observer-mode v0.4.0 receipt.

**The trust boundary.** The sidecar carries the foreign framework's
claimed forward / loss / backward / updates / parameters_after as
canonical fields. The importer:

1. Schema-validates the sidecar against `framework-trace.v0.1.0.json`.
2. Computes `sha256` of the raw sidecar bytes for `attestor.import_provenance.source_hash`.
3. Runs the backprop-trace engine differentially via `runGeneralStep` on
   the same inputs (`parameters_before` + `inputs` + `targets` + topology).
4. Compares engine output to foreign claims field-by-field within the
   **verifier-clamped** `attestor.differential_tolerance`. A receipt may
   declare its own value, but as of v0.12.0 the verifier clamps it to the
   differential ceiling (`atol ≤ 1e-5, rtol ≤ 1e-3`) before any rule
   runs — a receipt can no longer widen its own pass band, and one that
   declares a value exceeding the ceiling is rejected (Rule 0). The
   default emitted value is `{atol: 1e-6, rtol: 1e-4}`.
5. Emits a v0.4.0 receipt with:
   - `fixture_status.authoring_state: "external_imported"`.
   - `fixture_status.verification_state` = either
     `"engine_recompute_matched_within_tolerance"` or
     `"engine_recompute_disagreed"` depending on the differential outcome.
   - `source_framework.{name, version, extractor}` naming the producer.
   - `attestor.{computed_by, verified_by, differential_tolerance, import_provenance}`.

**Critically:** the importer does NOT execute foreign code. It does NOT
read pickle / `torch.save` / `.pt` files — only plain-JSON sidecars. The
`bp` core takes NO runtime dependency on PyTorch / JAX / TensorFlow.

The differential check runs at import time AND again on
`bp verify general` of the produced receipt (Reproducible Builds discipline:
the producer's claim is not the verifier's truth). Rule 14 fires in both
contexts and is the load-bearing defense against collapsed-trace laundering.

**Exit codes:**

| Code | Meaning |
|------|---------|
| 0 | Import succeeded; engine-recompute differential agreed within tolerance |
| 1 | Import succeeded; differential check DISAGREED. Receipt still emitted (verification_state = `engine_recompute_disagreed`) for audit |
| 2 | Sidecar invalid / I/O error / schema validation failed |
| 3 | Invalid CLI argument |
| 4 | Framework adapter not implemented (e.g., `bp import jax` in v0.6.0) |

**Examples:**

```bash
# Import a PyTorch sidecar to stdout
bp import pytorch trace.jsonl > receipt.jsonl

# Import to a file
bp import pytorch trace.jsonl --out receipt.jsonl

# Then re-verify independently
bp verify general receipt.jsonl

# Machine-readable summary
bp import pytorch trace.jsonl --json
# → {"ok":true,"differential":{"passed":true,"disagreements":[]}}
```

**Frameworks (per-framework subcommands, no auto-detection):**

| Subcommand | Status |
|---|---|
| `bp import pytorch <file>` | **Shipped in v0.6.0** (single-step) |
| `bp import jax <file>` | **Shipped in v0.6.1** (single-step) |
| `bp import tensorflow <file>` | **Shipped in v0.7.0** (single-step) |
| `bp import pytorch multi <file>` | **Shipped in v0.8.0** (multi-step) |
| `bp import jax multi <file>` | **Shipped in v0.8.0** (multi-step) |
| `bp import tensorflow multi <file>` | **Shipped in v0.8.0** (multi-step) |

The CLI does **not** auto-detect framework from file contents — name it
explicitly. This is a deliberate choice per the v0.6 study consolidator
(Agent 3 finding, mirrors SARIF Multitool `-tool <name>` discipline):
silent misdetection in a verifier defeats the purpose of the verifier.

**Per-framework subcommand discipline at the library layer**: `importJaxSidecar`
rejects sidecars whose `source_framework.name !== "jax"` even if they
otherwise pass schema validation. Same for `importPytorchSidecar` and
"pytorch". You cannot accidentally feed a JAX sidecar to the PyTorch
importer or vice versa — the dispatch is explicit.

### JAX-specific authoring notes (v0.6.1)

`bp import jax` shares 100% of the trust model with `bp import pytorch`.
The differences are extractor-side (user's Python helper that emits the
sidecar):

- **Pytree flattening**: JAX users iterate parameters via
  `jax.tree_util.tree_flatten`, which produces a stable but non-obvious
  order. The user's helper MUST pair flattened values with their
  `parameter_id`s correctly; a swap surfaces as Rule 14 disagreement
  (covered by `fixtures/bad/jax.bad-pytree-flatten-order.jsonl`).
- **float32 vs binary64**: JAX runs in float32 by default; the engine
  runs in Node binary64. The default `attestor.differential_tolerance`
  `{atol:1e-6, rtol:1e-4}` absorbs cross-precision drift for small
  networks. A receipt may declare a looser value, but only up to the
  verifier's differential ceiling (`atol ≤ 1e-5, rtol ≤ 1e-3`, clamped
  as of v0.12.0) — it cannot widen its own pass band beyond that, and a
  larger declared value is rejected. Networks that genuinely need more
  than the ceiling allows are out of the deterministic-CPU corner this
  verifier covers.
- **JIT / XLA op fusion**: changes intermediate FP roundings; final
  scalar values agree within tolerance for deterministic ops.
- **vmap / scan / pmap**: produce batched values, not single-step
  scalars. Emit one sidecar per step; schema validation rejects extra
  dimensions at the wire layer.

## Subcommand: `bp import <framework> multi` (v0.8+)

```
bp import {pytorch,jax,tensorflow} multi <sidecar.jsonl> [--out <file>] [--json] [--verbose]
```

Multi-step observer-mode ingestion. Reads a **framework-trace.v0.2.0**
JSONL stream (one record per training step, in step order) and emits N
observer-mode v0.4.0 receipts (one per line on stdout, or to `--out
<file>`). The output is pipe-ready for `bp verify multi -`.

**End-to-end pattern:**

```bash
bp import pytorch multi train.multi-step.sidecar.jsonl | bp verify multi -
# Stage 1: per-step Rule 14 differentials at ingest
# Stage 2: per-receipt rules on each step + cross-record Rules 9 (parameter
#          chain) + 10 (trace identity) + 17 (bundle binding) + 25/26
#          (optimizer-state chain + config constancy, when stateful)
```

**Intra-stream invariants enforced at ingest** (any violation → exit 2):

- Every record declares `format: "framework-trace.v0.2.0"` (v0.1.0
  single-step sidecars are rejected — use the single-step subcommand).
- Every record's `source_framework.name` matches the subcommand
  framework (heterogeneous bundles fail fast at the first divergent
  record).
- All records share `source_framework.{name, version}`.
- `trace_id` is declared on all records or none (co-presence). If
  declared, all values must be identical; if not, the importer
  synthesizes a `trace_id` from the source hash.
- `step_index` is dense + monotonic from 0 to N-1, OR all absent (the
  importer synthesizes 0..N-1).
- ≥1 record (empty streams rejected).

**Output shape**:

- N observer-mode v0.4.0 receipts, one JSONL record per line.
- All N receipts share `attestor.import_provenance.source_hash` (SHA-256
  of the whole sidecar bytes BEFORE parsing — single byte-stream binding).
- All N receipts carry an identical `attestor.bundle_root_digest`
  computed by the importer in a two-pass canonical emit:
  1. Emit each receipt's canonical bytes WITHOUT `bundle_root_digest`.
  2. SHA-256 the concatenation of all those bytes → `bundle_root_digest`.
  3. Add `bundle_root_digest` to each receipt's attestor.
  4. Re-emit the final stream.

**Exit codes:**

| Code | Meaning |
|------|---------|
| 0 | All N steps imported AND every per-step Rule 14 differential agreed |
| 1 | All N steps imported; ≥1 step's differential DISAGREED. All N receipts still emitted (per-step `verification_state` set) for audit |
| 2 | Usage / I/O / schema-validation error (incl. mid-stream framework swap, trace_id swap, step_index gap, format-const mismatch) |
| 3 | Invalid CLI argument |

### Rule 17 — Trace-bundle binding — honest framing

`attestor.bundle_root_digest` gates Rule 17. When present on any
receipt in a multi-record reconcile (e.g., via `bp verify multi`), Rule
17 fires. It asserts:

1. **Co-presence**: every receipt declares the field.
2. **Value consistency**: every receipt's `bundle_root_digest` is the
   same string.
3. **Recompute**: the canonical-byte concatenation of all receipts (each
   with `bundle_root_digest` stripped) hashes to the declared value.

**Rule 17 is BUNDLE INTEGRITY, NOT producer-authenticity.** Catches:

- Accidental splice (a receipt was replaced after the digest was bound).
- Post-binding mutation (any receipt's bytes were changed).
- Inconsistent bundle roots (receipts from different bundles spliced
  together).
- Heterogeneous binding (some receipts declare the field, others don't).

Does NOT catch:

- An attacker who controls all receipt bytes AND recomputes the
  `bundle_root_digest`. Such an attacker passes Rule 17 trivially.

For producer-identity binding, combine `bundle_root_digest` with Rule
16 (`signed_subject_digest`) or an external cryptographic signature.
Rule 17 is a **tamper-evidence layer**, not an authentication layer.
See [`docs/multi-step.md`](./multi-step.md#observer-mode-multi-step-v08)
for the full honest-framing prose and the adversarial-fixture plate.

## Subcommand: `bp reconcile receipt`

```
bp reconcile receipt <file> [--json] [--verbose] [--color=auto|never|always]
```

Reconcile a single-record receipt against the per-record reconciliation
rules documented in [`docs/reconciliation.md`](./reconciliation.md) (the
single-record subset of the 26 rules; cross-record Rules 9/10/17/25/26
fire only on the multi-record path).

- **Math only.** This subcommand does not check byte equality vs a golden, does
  not consult `fixture_status`, does not validate against the JSON Schema
  (schema validity is an upstream pass — see `bp validate`), and does not
  reach out to the published-anchor ledger. For the full gate, use
  `bp verify mazur`.

- **Single record.** v0.1 + v0.2 accept exactly one record per `.jsonl` file
  or one whole-file `.json` document. Multi-record JSONL is reserved for
  the `bp verify` and `bp diff` v0.3+ surfaces.

### File arguments and stdin

| Form | Behavior |
|---|---|
| `bp reconcile receipt foo.json` | Parse the whole file as one JSON document. |
| `bp reconcile receipt foo.jsonl` | Strict JSONL: each non-empty line is a record. v0.1 limit: 1 record. |
| `bp reconcile receipt foo.jsonl` (pretty-printed) | Fallback: parse the whole file as one JSON document. |
| `bp reconcile receipt -` | Read from stdin. The content is parsed identically to `.json`. |

### Exit codes (this subcommand)

| Code | Meaning |
|---|---|
| 0 | All applicable per-record rules pass within the verifier-clamped `numeric_policy.tolerance`. |
| 1 | At least one reconciliation rule failed. Details on stderr (or stdout under `--json`). |
| 2 | Usage error, I/O error, malformed JSON, or `>1` record in a `.jsonl` file. |
| 3 | Invalid CLI argument (e.g. unknown flag). |

Rules 9 + 10 do NOT fire from `bp reconcile receipt` — multi-step
verification lives in `bp verify multi` (see below).

### Output

Default (text): a `reconciliation failed` marker on stderr, then one block
per failure with the canonical quartet (`stored`, `recomputed`, `delta`,
`tolerance`) plus factor decomposition where available. Matches the
example in [`docs/reconciliation.md`](./reconciliation.md#reporting-format).

`--json`: a discriminated-union envelope on stdout:

```json
{ "ok": true }
```

or

```json
{
  "ok": false,
  "failures": [
    { "rule": 4, "parameter_id": "w5", "field_path": "updates[4].gradient",
      "stored": -0.082166041, "recomputed": -0.082167041,
      "delta": 1.0e-6, "tolerance": 1.0e-9 }
  ]
}
```

### Examples

```bash
# Happy path — exit 0, no output.
bp reconcile receipt fixtures/mazur.golden.jsonl

# Anti-circularity demo — exit 1, Rule 4 failure on w5.
bp reconcile receipt fixtures/bad/mazur.bad-gradient.jsonl

# Pipe from another tool.
cat receipt.json | bp reconcile receipt -

# JSON output for CI consumers.
bp reconcile receipt receipt.json --json
```

## Subcommand: `bp verify mazur`

```
bp verify mazur [<file>] [--json] [--verbose] [--warn-as-fail] [--strict] [--color=...]
```

The **full gate** advertised at [`docs/reconciliation.md`](./reconciliation.md#command-surface).
Composes the library primitives in a fixed-order short-circuit pipeline
(sigstore-go pattern; study-swarm verifier-composition finding):

1. **Schema validation** against `schemas/receipt.v0.1.0.json` (via Ajv 2020-12).
2. **Reconciliation** against the applicable per-record rules — see `bp reconcile receipt` above. (The Mazur 2-2-2 v0.1.0 receipt exercises the core arithmetic rules 1-8; softmax/optimizer-gated rules no-op on it.)
3. **Engine reproduction** — re-run the engine with the receipt's inputs and
   confirm the produced receipt is byte-equal to the supplied one.
4. **Byte equality** against `fixtures/mazur.golden.jsonl` (the canonical
   golden file shipped in the package).
5. **`fixture_status` enum checks** — refuse to certify any receipt whose
   `fixture_status.canonical: true` while `verification_state` is not yet
   `engine_reproduced_byte_equal`.
6. **Published-anchor drift** against `fixtures/mazur.published.json`. Claims
   with `hard_gate: true` fail the build; `hard_gate: false` claims emit
   a WARN line but do not fail unless `--warn-as-fail`.

The file argument is optional: the default is `fixtures/mazur.golden.jsonl`.

### Gating knobs

| Flag | Effect |
|---|---|
| (none) | Default. Hard-gate failures => exit 1; WARN findings do not affect exit code. |
| `--warn-as-fail` | WARN findings (e.g. soft drift) escalate to FAIL. |
| `--strict` | Any non-PASS finding (WARN, SKIP) escalates to FAIL. |

These match the 4-bucket convention from the study-swarm verifier-composition
finding: 0 pass, 1 fail, 2 warn-only-when-gated, 3 input/config error.

### Output

Default:

```
verification passed

  [PASS] schema
  [PASS] reconcile
  [PASS] engine-reproduce
  [PASS] byte-equal-vs-golden
  [PASS] fixture-status
  [PASS] published-anchor-drift
```

`--json` emits a `VerifyReport` envelope with `{ overall, checks: [...] }`.

### Examples

```bash
# Verify the bundled golden.
bp verify mazur

# Verify a candidate receipt.
bp verify mazur tmp/my-receipt.jsonl

# Fail on soft drift (useful in CI).
bp verify mazur --warn-as-fail --json
```

## Subcommand: `bp generate mazur`

```
bp generate mazur [--out <file>] [--check] [--json] [--color=...]
```

Re-runs the Mazur 2-2-2 engine with the canonical `MAZUR_INPUT`
(see [`src/mazur.ts`](../src/mazur.ts)) and emits a canonical JSONL
receipt.

| Mode | Behavior |
|---|---|
| (none) | Write the canonical bytes to stdout. |
| `--out F` | Write the canonical bytes to file `F` (truncating). |
| `--check` | Re-run the engine and compare against `fixtures/mazur.golden.jsonl`; exit 1 on any byte drift. Useful in CI. |

This is the inverse of `bp verify mazur`'s engine-reproduction check: rather
than verifying that a supplied receipt matches the engine, it writes the
engine's output directly. The two together close the loop — `generate`
emits, `verify` confirms.

### Examples

```bash
# Print canonical bytes (e.g. for piping into a hasher).
bp generate mazur | sha256sum

# Update the golden after an authorized engine change.
bp generate mazur --out fixtures/mazur.golden.jsonl

# CI byte-equality gate against the committed golden.
bp generate mazur --check
```

## Subcommand: `bp verify general` (v0.3+)

```
bp verify general <file> [--json] [--verbose] [--warn-as-fail] [--strict] [--color=...]
```

Generalized verify gate. Equivalent to `bp verify mazur` but for any
v0.2.0-schema receipt (XOR, iris, or a custom-topology receipt emitted
by `runGeneralStep`). Composes the same fixed-order short-circuit
pipeline (sigstore-go pattern):

1. **Schema validation** against `schemas/receipt.v0.2.0.json`.
2. **Reconciliation** against the single-record subset of the 26 rules:
   the core arithmetic rules 1-8 plus the gated rules (0.8, 11-16, 18-24)
   as applicable to the receipt's topology and optimizer (Rules 9, 10,
   17, 25, 26 fire only on the multi-record path). For observer-mode
   imports (`fixture_status.authoring_state === "external_imported"`),
   **Rule 14** (engine-recompute differential, within the verifier-clamped
   `attestor.differential_tolerance`) fires here — it is the governing
   soundness gate for imported foreign-framework math.
3. **Engine reproduction** — re-runs `runGeneralStep` with the receipt's
   declared topology + inputs and confirms byte-equality. This runs **only
   for engine-authored receipts**. For observer-mode (`external_imported`)
   receipts it is **skipped**: their canonical bytes carry foreign
   framework math (different FP rounding, optimizer-state representation)
   that the engine will not byte-match by design, so a byte-equality check
   would always false-FAIL. Rule 14 (step 2) is the soundness gate
   instead — the report shows a `[SKIP] engine-reproduce` line naming the
   `reconcile`/Rule-14 outcome.
4. **Byte equality** against the bundled fixture corresponding to the
   receipt's `fixture` id (e.g. `fixtures/xor.golden.jsonl` for
   `fixture: "xor-sigmoid-engine-first-run"`) when one is known.
5. **`fixture_status` enum checks** (same enums as v0.2 plus
   `engine_generated_general` for non-Mazur receipts).

The file argument is REQUIRED — unlike `bp verify mazur`, there is no
single canonical default subject.

### Examples

```bash
# Verify the bundled iris fixture.
bp verify general node_modules/@mcptoolshop/backprop-trace/fixtures/iris.golden.jsonl

# Verify a fresh XOR receipt piped from generate.
bp generate xor | bp verify general -

# JSON output for CI.
bp verify general fixtures/xor.golden.jsonl --json
```

## Subcommand: `bp verify multi` (v0.3+)

```
bp verify multi <file.jsonl> [--json] [--verbose] [--warn-as-fail] [--strict] [--color=...]
```

Multi-record verify gate. The file argument MUST be a JSONL file
containing two or more v0.2.0-schema receipts in `step_index` order.

The gate runs in two phases (see
[`reconciliation.md` "Multi-step receipts"](./reconciliation.md#multi-step-receipts)):

1. **Per-record pass.** Each receipt runs through the same per-record
   reconciliation as `bp verify general`. Any per-record failure
   surfaces immediately.
2. **Cross-record pass.** Rule 10 (trace identity) fires first — a
   mismatched `trace_id` set or non-dense `step_index` sequence
   short-circuits before Rule 9. Then Rule 9 (parameter chain) fires
   across adjacent receipts.

Single-record JSONL files are rejected with exit 2 (use `bp verify
general` for those).

### Examples

```bash
# Verify a training-run JSONL.
bp verify multi training-run.jsonl

# JSON output for CI; warn-as-fail to catch soft drift.
bp verify multi training-run.jsonl --json --warn-as-fail
```

## Subcommand: `bp generate xor` (v0.3+)

```
bp generate xor [--out <file>] [--check] [--json] [--color=...]
```

Re-runs the XOR-sigmoid 2-2-1 engine with the canonical `XOR_INPUT`
(see [`src/mazur.ts`](../src/mazur.ts)) and emits a canonical JSONL
receipt. Same mode matrix as `bp generate mazur`: default writes to
stdout; `--out F` writes to file; `--check` compares against
`fixtures/xor.golden.jsonl`.

### Examples

```bash
# Print canonical XOR bytes.
bp generate xor

# CI byte-equality gate against the committed golden.
bp generate xor --check

# Pipe into a hash.
bp generate xor | sha256sum
```

## Subcommand: `bp generate iris` (v0.3+)

```
bp generate iris [--out <file>] [--check] [--json] [--color=...]
```

Re-runs the iris 4-3-3 sigmoid engine with the canonical `IRIS_INPUT`
(first iris flower `(5.1, 3.5, 1.4, 0.2)` targeting one-hot setosa
`[1, 0, 0]`). Same mode matrix as `bp generate mazur`. The output
canonical-byte sha256 is the in-toto attestation seam for an iris
training trace.

### Examples

```bash
bp generate iris --out fixtures/iris.golden.jsonl
bp generate iris --check
```

## Subcommand: `bp generate from-config` (v0.4+)

```
bp generate from-config <file> [--out <file>] [--check] [--json] [--color=...]
```

Read a topology + input config JSON file, validate it against
`schemas/topology-input.v0.4.0.json`, hand it to `runGeneralStep`, and emit
a canonical v0.2.0-schema receipt. The authoring tools surface — users can
drive the engine from JSON without writing any TypeScript.

The input file declares the network topology (`unit_order`,
`parameter_order`, `topology`, `bias_policy`, `numeric_policy`,
`learning_rate`) plus the runtime inputs (`inputs`, `targets`,
`parameters_before`) and an optional `metadata` block. The schema
PROHIBITS receipt-only fields (`forward`, `loss`, `backward`, `updates`,
`parameters_after`, `post_update_forward`, `post_update_loss`,
`fixture_status`) at the `additionalProperties: false` boundary — authored
bytes can never masquerade as receipt bytes.

| Mode | Behavior |
|---|---|
| (none) | Write the canonical bytes to stdout. |
| `--out F` | Write the canonical bytes to file `F` (truncating). |
| `--check` | Re-run the engine and compare against an existing `--out` target (or stdout-equivalent); exit 1 on byte drift. |

### Exit codes (this subcommand)

| Code | Meaning |
|---|---|
| 0 | Receipt emitted; on `--check`, bytes matched. |
| 1 | `--check` byte drift detected. |
| 2 | I/O error, malformed JSON, or input-schema validation failure. |
| 3 | Invalid CLI argument. |

### Examples

```bash
# Author a custom topology and verify it
bp scaffold topology --topology xor --out my-net.input.json
# (edit my-net.input.json)
bp validate-input my-net.input.json
bp generate from-config my-net.input.json --out my-net.golden.jsonl
bp verify general my-net.golden.jsonl

# CI byte-equality gate against a committed golden
bp generate from-config my-net.input.json --check --out my-net.golden.jsonl

# Pipe into a hash
bp generate from-config my-net.input.json | sha256sum
```

See [`docs/authoring.md`](./authoring.md) for the full walkthrough.

## Subcommand: `bp scaffold topology` (v0.4+)

```
bp scaffold topology --topology mazur|xor|iris [--out <file>] [--json] [--color=...]
```

Write a sample input file (the same JSON shape that `bp generate
from-config` consumes) to bootstrap a new topology. The output is one of
the in-memory `MAZUR_INPUT` / `XOR_INPUT` / `IRIS_INPUT` literals
serialized in canonical input-config form. Users edit the produced file
to describe their own network, then run `bp validate-input` and `bp
generate from-config`.

| Mode | Behavior |
|---|---|
| (none) | Write the input JSON to stdout. |
| `--out F` | Write the input JSON to file `F` (truncating). |

The `--topology` flag is REQUIRED — there is no default. Only the three
shipped templates (`mazur`, `xor`, `iris`) are accepted; unknown values
exit 3.

### Exit codes (this subcommand)

| Code | Meaning |
|---|---|
| 0 | Input file written. |
| 2 | I/O error writing `--out` target. |
| 3 | Missing or invalid `--topology` value. |

### Examples

```bash
# Print a starter Mazur input to stdout
bp scaffold topology --topology mazur

# Write a starter XOR input for editing
bp scaffold topology --topology xor --out my-xor.input.json

# Round-trip sanity: scaffold → generate → byte-equal to existing golden
bp scaffold topology --topology mazur --out tmp/mazur.input.json
bp generate from-config tmp/mazur.input.json --check --out fixtures/mazur.golden.jsonl
```

NOTE: `bp scaffold receipt` is intentionally NOT implemented — scaffolding
bytes that look like receipts would make authored bytes a trust source for
verification. The canonical-emission boundary is preserved: only the
engine produces receipt bytes.

## Subcommand: `bp validate-input` (v0.4+)

```
bp validate-input <file> [--json] [--verbose] [--color=...]
```

Schema-validate a topology + input config file against
`schemas/topology-input.v0.4.0.json` without running the engine. Uses Ajv
(2020-12 draft) and reports the first validation error with a field path.

This is the input-side analog of `bp validate` (which validates receipts).
Together they cover the two artifact families:

- `bp validate <file>` — receipts (engine outputs)
- `bp validate-input <file>` — input configs (engine inputs)

The input schema's `additionalProperties: false` rejects receipt-only
fields (`forward`, `loss`, `backward`, `updates`, `parameters_after`,
`post_update_forward`, `post_update_loss`, `fixture_status`) with a
named-field error — surfacing the canonical-emission trust-boundary
violation before the engine sees the file.

| Code | Meaning |
|---|---|
| 0 | Input conforms to `topology-input.v0.4.0`. |
| 1 | Input does not conform; the first error block is on stderr. |
| 2 | I/O error or malformed JSON. |
| 3 | Invalid CLI argument. |

### Examples

```bash
# Validate a scaffolded input
bp validate-input my-net.input.json

# Pipe from another tool
some-config-generator | bp validate-input -

# JSON output for CI
bp validate-input my-net.input.json --json
```

## Subcommand: `bp validate`

```
bp validate <file> [--json] [--verbose] [--color=...]
```

Schema-only validation of a RECEIPT. The validator auto-detects the
receipt's `schema_version` and dispatches against either
`schemas/receipt.v0.1.0.json` (Mazur receipts) or
`schemas/receipt.v0.2.0.json` (v0.3 generalized + multi-step receipts +
v0.4 per-neuron bias receipts via additive widening) via Ajv (2020-12
draft). Reports the first validation error (fail-fast; full-list `--all`
support is reserved for v0.5+).

For input configs (NOT receipts), use `bp validate-input` instead — it
binds to a separate schema (`topology-input.v0.4.0.json`) that
PROHIBITS receipt-only fields.

| Code | Meaning |
|---|---|
| 0 | Receipt conforms to the schema. |
| 1 | Receipt does not conform; the first error block is on stderr. |
| 2 | I/O error or malformed JSON. |
| 3 | Invalid CLI argument. |

### Examples

```bash
bp validate fixtures/mazur.golden.jsonl   # exit 0
bp validate broken.json                    # exit 1
cat receipt.json | bp validate -           # stdin
```

## Common options

These apply to every subcommand (subcommand-help notes where they don't):

| Option | Description |
|---|---|
| `--json` | Machine-readable JSON to stdout instead of human text on stderr. |
| `--verbose`, `-V` | Diagnostic stderr lines before the run (file path, schema_version, fixture id). |
| `--color=auto\|never\|always` | Color output policy. `auto` checks `process.stdout.isTTY` and honors `NO_COLOR`. |
| `--version`, `-v` | Print the npm package version and exit 0. |
| `--help`, `-h` | Print usage and exit 0. |

`NO_COLOR=1` in the environment disables color regardless of `--color`. This
matches the [no-color.org](https://no-color.org/) convention.

## Stdin support

`reconcile receipt`, `validate`, `validate-input`, `verify mazur`, `verify
general`, `verify multi`, and `generate from-config` accept `-` as the file
argument to read from stdin:

```bash
cat mazur.golden.jsonl | bp reconcile receipt -
some-other-tool | bp validate -
config-generator | bp validate-input -
config-generator | bp generate from-config -
```

`generate mazur`, `generate xor`, `generate iris`, and `scaffold topology`
do not accept stdin; they have no input to consume (each takes a fixed
in-memory literal or a `--topology` flag).

## Exit-code conventions

All subcommands follow a 4-bucket convention loosely modeled on
shellcheck:

| Code | Meaning |
|---|---|
| 0 | Success / pass |
| 1 | Verification or reconciliation failure (the receipt is bad, not the tool) |
| 2 | I/O error, malformed JSON, or unexpected file shape |
| 3 | Invalid CLI argument or unsupported flag combination |

Distinguishing these matters for CI: `set -e` shells stop on any nonzero,
but a pipeline that retries on transient I/O errors (`2`) should not retry
on a deliberate verification failure (`1`).

## Exit codes

Every subcommand follows the same 4-bucket convention:

| Code | Meaning |
|---|---|
| 0 | Success / pass |
| 1 | Verification or reconciliation failure (the receipt is bad, not the tool) |
| 2 | I/O error, malformed JSON, unexpected file shape, or missing required argument |
| 3 | Invalid CLI argument or unsupported flag combination |

`bp verify multi <file.jsonl>` additionally returns exit 2 when the
input contains fewer than 2 records (use `bp verify general` for single-
record JSONL). `bp generate xor / iris --check` returns exit 1 on byte
drift, exit 2 on golden-file read errors.

## Where the rules live

The 26 reconciliation rules that `bp reconcile receipt`, `bp verify
mazur`, `bp verify general`, and `bp verify multi` check are documented
in full at [`docs/reconciliation.md`](./reconciliation.md) (quick-
reference table at the top, then a section per rule). The always-on core
arithmetic rules:

- Rule 1: [`docs/reconciliation.md#rule-1-output-error-signal-consistency`](./reconciliation.md#rule-1-output-error-signal-consistency)
- Rule 2: [`docs/reconciliation.md#rule-2-downstream-contribution-and-backpropagated-sum`](./reconciliation.md#rule-2-downstream-contribution-and-backpropagated-sum)
- Rule 3: [`docs/reconciliation.md#rule-3-hidden-error-signal-consistency`](./reconciliation.md#rule-3-hidden-error-signal-consistency)
- Rule 4: [`docs/reconciliation.md#rule-4-update-gradient-consistency`](./reconciliation.md#rule-4-update-gradient-consistency)
- Rule 5: [`docs/reconciliation.md#rule-5-update-value-consistency`](./reconciliation.md#rule-5-update-value-consistency)
- Rule 6: [`docs/reconciliation.md#rule-6-weight-progression`](./reconciliation.md#rule-6-weight-progression)
- Rule 7: [`docs/reconciliation.md#rule-7-final-state-consistency`](./reconciliation.md#rule-7-final-state-consistency)
- Rule 8: [`docs/reconciliation.md#rule-8-provenance-reference-consistency`](./reconciliation.md#rule-8-provenance-reference-consistency)
- Rule 9: [`docs/reconciliation.md#rule-9-multi-step-parameter-chain`](./reconciliation.md#rule-9-multi-step-parameter-chain) (v0.3+; fires only under `bp verify multi`)
- Rule 10: [`docs/reconciliation.md#rule-10-multi-step-trace-identity`](./reconciliation.md#rule-10-multi-step-trace-identity) (v0.3+; fires only under `bp verify multi`)

Rules 0.8 + 11-13 (softmax + cross-entropy), 14-16 (observer-mode
imports), 17 (bundle binding), 18-19 (batching), and 20-26 (Adam / AdamW
/ SGD-momentum optimizer recurrences and their multi-step chains) are
**gated** — each fires only when the receipt declares the matching
topology, optimizer, or multi-step structure. See the quick-reference
table in [`docs/reconciliation.md`](./reconciliation.md) for the full
gating matrix.

Each rule ships with a deliberately-broken bad-* fixture per the Csmith
doctrine — bad receipts precede good receipts. Rules 1-8 use
`fixtures/bad/mazur.bad-<kind>.jsonl`; Rules 9, 10 use
`fixtures/bad/multi-step.bad-{chain,trace-id}.jsonl`; the gated rules use
optimizer- / topology-specific bad fixtures (`fixtures/bad/adam.bad-*`,
`softmax-ce.bad-*`, `external.bad-*`, etc.). The sibling
`.meta.json` documents the mutation, the targeted invariant, expected
cascades, and the expected `bp` output.
