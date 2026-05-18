# Multi-step training receipts (v0.3+)

v0.3 adds multi-step training receipts: a JSONL file containing N
self-contained receipts, one per training step, that the verifier walks
end-to-end. Chain integrity is checked by parameter equality across step
boundaries (Rule 9) and trace identity by a shared `trace_id` plus a
dense `step_index` sequence (Rule 10).

For the single-step verifier surface (`bp verify mazur`,
`bp verify general`, `reconcileReceipt`) see
[`docs/reconciliation.md`](./reconciliation.md) and
[`docs/cli.md`](./cli.md). This doc is specifically about the
multi-record path.

## Design choices

v0.3 makes three explicit decisions about multi-step receipts (per the
v0.3 design memo §4):

1. **Per-step independence (Option A).** Each step is a fully self-
   contained receipt. Reading a single record gives a complete picture
   of one training step — forward, backward, updates, before/after
   state — without consulting siblings. A consumer that only cares
   about step K loads receipt K and walks Rules 1-8 against it
   directly.
2. **trace_id + step_index overlay (Option D).** Each receipt carries
   a shared `trace_id` (128-bit lowercase hex, W3C TraceContext shape)
   and a 0-based `step_index`. The verifier reads both off every
   receipt and uses them for Rule 10 (trace identity) before checking
   Rule 9 (parameter chain).
3. **Multi-record JSONL framing.** Each receipt is one JSON object
   terminated by LF. Concatenating two emitter outputs is itself a
   valid emitter output. `bp verify multi <file.jsonl>` reads N
   records.

The design memo explicitly REJECTS:

- A `steps: []` array inside a composite receipt — breaks streaming,
  breaks per-step verification, breaks JSONL framing.
- Merkle digest chains for parameter integrity — Rule 9 reads
  `parameters_after` and `parameters_before` directly off the receipts,
  no separate ledger required.

This is the Proof-of-Learning lineage (Jia et al. IEEE S&P 2021 —
https://ar5iv.labs.arxiv.org/html/2103.05633): chain integrity is
parameter equality across step boundaries, not a separate cryptographic
digest. The receipt set is the audit trail.

## Receipt fields

Two optional top-level fields on the v0.2.0 schema:

```json
"trace_id":   "5f8b3c0a7d2e4f1b9c6e8a7d3f5b2c1a",
"step_index": 0
```

The v0.2.0 schema's `allOf` clause enforces "trace_id present iff
step_index present" — a receipt may not carry one without the other.
Receipts without these fields are valid single-step receipts (the
shipped XOR and iris fixtures are this shape).

### `trace_id` is 128-bit hex (W3C TraceContext convention)

W3C TraceContext (https://www.w3.org/TR/trace-context/) defines
`trace-id` as a 32-character lowercase hex string representing a 128-bit
value. backprop-trace adopts the same shape: the v0.2.0 schema enforces
`pattern: "^[0-9a-f]{32}$"`.

Receipt emitters generate the id ONCE at training-run start and reuse it
across every step receipt. A common pattern is `crypto.randomUUID()`
with the dashes stripped — gives 32 lowercase hex characters drawn from
a cryptographically-random 122-bit pool, which fits the TraceContext
shape modulo the 6 version/variant bits (consumers are not required to
treat the value as a UUID).

```ts
import { randomUUID } from 'node:crypto';
const trace_id = randomUUID().replace(/-/g, '');  // 32-hex
```

Two distinct training runs MUST use distinct `trace_id` values. Rule 10
catches accidental cross-run concatenation by failing on any receipt
whose `trace_id` differs from the first receipt's.

### `step_index` is 0-based, monotonic, dense

The first receipt of a run carries `step_index: 0`; the Nth (1-based)
carries `step_index: N - 1`. Rule 10 fails on:

- Sparse sequences — `[0, 1, 3]` rejects (step 2 missing).
- Non-monotonic sequences — `[0, 2, 1]` rejects (descending).
- Non-zero starts — `[1, 2, 3]` rejects (must start at 0).
- Repeated indices — `[0, 0, 1]` rejects (duplicate at step 0).

Dense means every step in `[0, N-1]` is present exactly once.

## Multi-record JSONL framing

Each receipt is one JSON object on one line, terminated by LF (`\n`,
not CRLF). The last record also ends in LF — strict ndjson convention
(https://ndjson.org/). The `emitReceipts` helper produces the
trailing-LF-per-record framing naturally:

```
{record_0_object}\n{record_1_object}\n{record_2_object}\n...{record_N-1_object}\n
```

A 5-step XOR training run produces 5 lines, each ~3-4 KB depending on
topology size. No JSON whitespace inside records (canonical emission
rules from [`docs/canonical-emission.md`](./canonical-emission.md)
apply unchanged).

Concatenating two multi-step JSONL files at the byte level produces a
syntactically valid JSONL file — but Rule 10 will fail on the seam
because the two runs have distinct `trace_id`s. This is the intended
behavior: cross-run concatenation is detected, not silently accepted.

## Two-phase verification model

`bp verify multi <file.jsonl>` runs two phases:

### Phase 1: per-record reconciliation

For each receipt in the file, the reconciler runs the standard 8-rule
pass (Rules 1-8 from `docs/reconciliation.md`). Any per-record failure
surfaces immediately with the same field-path / stored / recomputed /
delta / tolerance quartet as `bp reconcile receipt`.

If any per-record failure is detected, the verifier reports the failure
list and exits — Phase 2 only runs against receipts that pass per-record
reconciliation. Per-record failures are pinned to a specific
`step_index` in the report so the auditor knows which record carries
the math error.

### Phase 2: cross-record reconciliation

Rule 10 (trace identity) fires FIRST. A mismatched `trace_id` set or
non-dense `step_index` sequence short-circuits before Rule 9 runs —
parameter-chain integrity across two unrelated traces has no meaningful
interpretation.

If Rule 10 passes, Rule 9 (parameter chain) fires across adjacent
receipts in `step_index` order:

```
For K = 1, 2, ..., N-1:
  For every id in receipt[K].parameter_order:
    require receipt[K].parameters_before[id] == receipt[K-1].parameters_after[id]
            within receipt[K].numeric_policy.tolerance (hybrid form)
```

The `step_index = 0` receipt has no prior anchor and is skipped by
Rule 9 (its `parameters_before` is the training-run initial state).

## Library entry points

```ts
import {
  runGeneralStep,
  runMultiStep,
  emitReceipts,
  reconcileMultiStep,
  XOR_INPUT,
} from '@mcptoolshop/backprop-trace';

// Convenience: re-run runGeneralStep N times, threading parameters_after
// from step K into parameters_before for step K+1.
const receipts = runMultiStep(
  { ...XOR_INPUT, trace_id: 'a'.repeat(32), step_index: 0 },
  /* stepCount */ 5
);

// Reconcile per-record + cross-record (Phase 1 + Phase 2).
const result = reconcileMultiStep(receipts);
if (!result.ok) for (const f of result.failures) console.error(f);

// Multi-record JSONL — concat of canonical per-record emissions.
const jsonl = emitReceipts(receipts);
```

`runMultiStep` is a convenience wrapper around `runGeneralStep`; manual
loops work equally well if you want to inspect intermediate state or
inject mid-run modifications.

`reconcileMultiStep(receipts: unknown[])` returns the same
`ReconciliationResult` shape as `reconcileReceipt`. Failures from Rules
1-8 carry the originating `step_index` in the field-path prefix
(`step[K].field_path`); failures from Rules 9 / 10 are top-level and
identify the failing pair / sequence directly.

## CLI entry points

```bash
# Verify a training-run JSONL.
bp verify multi training-run.jsonl

# JSON output for CI; warn-as-fail to escalate soft drift to failure.
bp verify multi training-run.jsonl --json --warn-as-fail

# Pipe directly from runMultiStep emission.
node -e 'require("@mcptoolshop/backprop-trace").runMultiStep(...).forEach(r =>
  process.stdout.write(require("@mcptoolshop/backprop-trace").emitGeneralReceipt(r)))' \
  | bp verify multi -
```

`bp verify multi` REJECTS single-record JSONL files with exit 2 — use
`bp verify general` for those. See
[`docs/cli.md`](./cli.md#subcommand-bp-verify-multi-v03) for the full
flag reference.

## Bad fixtures (Csmith doctrine)

Rules 9 and 10 each ship with a deliberately-broken bad fixture per the
anti-circularity ratchet (Csmith / CompCert lineage; see
[`docs/reconciliation.md` "Academic lineage"](./reconciliation.md#academic-lineage)):

- **`fixtures/bad/multi-step.bad-chain.jsonl`** — a 2-step run where
  the second receipt's `parameters_before` does NOT match the first
  receipt's `parameters_after` for one weight. The reconciler must
  surface a Rule 9 failure naming the affected parameter id and step
  pair.
- **`fixtures/bad/multi-step.bad-trace-id.jsonl`** — a 3-step run
  where one receipt declares a different `trace_id` than the others.
  The reconciler must surface a Rule 10 failure naming the divergent
  receipt's `step_index`.

Each ships with a sibling `.meta.json` documenting the mutation, the
targeted invariant, expected cascades, and the expected `bp verify
multi` output. The fixtures are byte-precise mutations of a canonical
multi-step run; they test the verifier, not the engine.

## Observer-mode multi-step (v0.8+)

v0.8 extends the multi-step path to external framework traces. v0.3–v0.7
multi-step was engine-authored only (`bp verify multi` on a JSONL stream
of engine-authored receipts). v0.8 adds **multi-step observer-mode
ingestion** via `bp import {pytorch,jax,tensorflow} multi <sidecar.jsonl>`.

### Sidecar format

A multi-step observer sidecar is a **framework-trace.v0.2.0** JSONL
stream — one record per training step, in step order. Each record is
self-contained (same shape as v0.1.0 single-step) plus optional `trace_id`
+ `step_index` (mirroring the receipt's v0.4.0 schema fields). v0.1.0
single-step sidecars do NOT validate against v0.2.0: the `format` const
discriminator distinguishes them, and the importer dispatches on it.

```jsonl
{"format":"framework-trace.v0.2.0","source_framework":{"name":"pytorch","version":"2.4.0",...},"trace_id":"<hex>","step_index":0,"topology":{...},...}
{"format":"framework-trace.v0.2.0","source_framework":{"name":"pytorch","version":"2.4.0",...},"trace_id":"<hex>","step_index":1,"topology":{...},...}
{"format":"framework-trace.v0.2.0","source_framework":{"name":"pytorch","version":"2.4.0",...},"trace_id":"<hex>","step_index":2,"topology":{...},...}
```

### Intra-stream invariants enforced at ingest

- Every record declares `format: "framework-trace.v0.2.0"` (v0.1.0 records rejected).
- Every record declares `source_framework.name` matching the subcommand framework (heterogeneous bundles rejected at first divergent record).
- All records share `source_framework.name + version`.
- `trace_id` is declared on all records or none (co-presence).
- `step_index` is dense + monotonic from 0 to N-1 (or all absent, in which case the importer synthesizes 0..N-1).
- ≥1 record (empty streams rejected).

### What the importer produces

For each step, an observer-mode v0.4.0 receipt. All N receipts share:

- The same `attestor.import_provenance.source_hash` (SHA-256 of the whole sidecar bytes BEFORE parsing — single byte-stream binding).
- The same `attestor.import_provenance.source_format = "framework-trace.v0.2.0"`.
- The same `trace_id`.
- An identical `attestor.bundle_root_digest` computed in a two-pass canonical emit (see Rule 17 below).
- Dense `step_index` 0..N-1.
- `fixture_status.authoring_state = "external_imported"` and per-step `verification_state` (matched/disagreed).

### Verification flow

```bash
bp import pytorch multi train.multi-step.sidecar.jsonl | bp verify multi -
```

The pipe is the canonical workflow. Stage 1 (`bp import`) runs per-step
Rule 14 differentials at ingest time. Stage 2 (`bp verify multi`) runs
the full reconciler: Rules 1-8 per-receipt + Rules 9 (parameter chain)
+ 10 (trace identity) + Rule 17 (bundle binding) across the stream.

### Rule 17 — Trace-bundle binding (GATED) — honest framing

When `attestor.bundle_root_digest` is present on any receipt in a
multi-record sequence, Rule 17 fires. It asserts three properties:

1. **Co-presence**: every receipt in the bundle declares the field.
2. **Value consistency**: every receipt's `bundle_root_digest` is the
   same string.
3. **Recompute**: the canonical-byte concatenation of all receipts
   (each emitted with `bundle_root_digest` stripped) hashes to the
   declared value.

Rule 17 catches **bundle-integrity** failures: accidental splice, post-
binding mutation of a receipt's bytes, inconsistent bundle roots when
the digest was not recomputed after the change, receipt reordering after
binding.

**Rule 17 is NOT a producer-authenticity check.** An attacker who
controls all receipt bytes AND recomputes the bundle digest passes Rule
17 trivially — the recomputed value matches the declared value because
the attacker chose both. For producer-identity binding, combine
`bundle_root_digest` with Rule 16 `signed_subject_digest` (which fires
on a per-receipt SolarWinds-style "signed-but-substituted" attack
signature) or an external cryptographic signature over the bundle root.

Rule 17 is a **tamper-evidence layer**, not an authentication layer.
This framing is preserved in:

- The schema docstring for `attestor.bundle_root_digest`.
- The TS doc comment for `Attestor.bundle_root_digest`.
- The Rule 17 failure-message text (the message itself names the caveat
  so a CI consumer parsing the diagnostic cannot miss it).
- The README's "Bring your own training trace" → "Multi-step ingestion
  (v0.8+)" subsection.
- `bp import <framework> multi --help`.

### Adversarial fixtures (v0.8 plate, fixtures/bad/)

Five fixtures, each load-bearing for a distinct cross-step attack class:

- `multi-step-external.bad-step-index-gap.jsonl` → Rule 10 (sequence [0, 2] not dense from 0)
- `multi-step-external.bad-chain-break-cross-step-internally-consistent.jsonl` → Rule 9 (each step internally consistent but chain broken; proves Rule 9 still necessary on the observer path)
- `multi-step-external.bad-fabricated-mid-step.jsonl` → Rule 9 (step 1 generated from independent random parameters)
- `multi-step-external.bad-cross-trace-splice.jsonl` → Rule 17 (receipt bytes mutated without recomputing bundle root)
- `multi-step-external.bad-bundle-digest-tampered.jsonl` → Rule 17 (bundle_root_digest replaced on one receipt; value-consistency violation)

All fixtures honor the anti-circularity ratchet: the reconciler detects
the violation BEFORE consulting `fixture_status` metadata.

## Citations

- **Jia, Yu, Iyer, Yaghini, Zhang, Papernot. "Proof-of-Learning: Definitions
  and Practice." IEEE S&P 2021.** arXiv:2103.05633 —
  https://ar5iv.labs.arxiv.org/html/2103.05633. The parameter-chain
  integrity pattern Rules 9 + 10 implement is a direct translation of
  Jia et al.'s PoL definition into the receipt-format setting.
- **W3C TraceContext.** https://www.w3.org/TR/trace-context/. The
  128-bit hex `trace-id` shape. backprop-trace adopts this shape so
  multi-step training traces can be cross-referenced with general
  observability tooling that already speaks TraceContext.
- **ndjson.org / RFC 7464.** https://ndjson.org/,
  https://datatracker.ietf.org/doc/html/rfc7464. The trailing-LF-per-
  record framing.
