<p align="center">
  <a href="README.ja.md">日本語</a> | <a href="README.zh.md">中文</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.hi.md">हिन्दी</a> | <a href="README.it.md">Italiano</a> | <a href="README.pt-BR.md">Português (BR)</a>
</p>

# @mcptoolshop/backprop-trace

Deterministic training-trace engine — produces canonical JSONL receipts of single backprop steps, verified by a 10-rule reconciler (all 10 rules wired in v0.3).

## Why backprop-trace?

If you teach, audit, or verify neural-network training, you need a way to say "this trace adds up." backprop-trace produces canonical bytewise receipts of single backprop steps and a reconciler that re-derives every value from the named factors. v0.1 ships the Mazur 2-2-2 fixture — the most-cited pedagogical backprop example on the open web — as a byte-equal regression baseline, plus an anti-circularity bad-fixture that proves the verifier rejects what it should reject.

This is **not** an ML metrics logger (use MLflow / W&B / TensorBoard for that). It **is** a structural-trace verifier in the Proof-of-Learning lineage (Jia et al. IEEE S&P 2021), scoped to pedagogical single-step examples — at the unit-test scale rather than the full-training-run scale.

## 30-second quickstart

```bash
pnpm add @mcptoolshop/backprop-trace

npx bp verify mazur
# exit 0 — schema + reconcile + engine-reproduce + byte-equal + drift all pass

npx bp reconcile receipt node_modules/@mcptoolshop/backprop-trace/fixtures/bad/mazur.bad-gradient.jsonl
# exit 1 — Rule 4: update.gradient mismatch on w5; Rule 5 cascade (v0.2+)
# (this is correct — that fixture is deliberately broken; the verifier
#  must catch it BEFORE consulting fixture_status lifecycle metadata)

npx bp generate mazur | sha256sum
# canonical-byte sha256 of the engine output; the in-toto v1 attestation seam
```

For a longer walk-through, see [`docs/quickstart.md`](./docs/quickstart.md); for the CLI reference, [`docs/cli.md`](./docs/cli.md); for the attestation path, [`docs/attestation.md`](./docs/attestation.md).

## Install

```
pnpm add @mcptoolshop/backprop-trace
```

Or with npm:

```
npm install @mcptoolshop/backprop-trace
```

## CLI usage

v0.3 ships eight subcommands. Full reference: [`docs/cli.md`](./docs/cli.md).

```
bp reconcile receipt <file>     Reconcile a receipt against the 10 rules.
bp verify mazur [<file>]        Full gate (Mazur): schema + reconcile + engine-reproduce + byte-equal + drift.
bp verify general <file>        Generalized verify gate for any v0.2.0-schema receipt (XOR, iris, custom).
bp verify multi <file.jsonl>    Multi-record verify; runs Rules 9, 10 + per-record Rules 1-8.
bp generate mazur [--out F]     Re-run the Mazur engine, emit canonical bytes.
bp generate xor [--out F]       Re-run the XOR engine, emit canonical bytes.
bp generate iris [--out F]      Re-run the iris engine, emit canonical bytes.
bp validate <file>              Schema-only validation (auto-detects v0.1 vs v0.2).
```

### Quick demos

```bash
# Generate an XOR receipt and reconcile it
npx bp generate xor | tee /tmp/xor.jsonl | npx bp verify general -

# Or verify the bundled iris fixture
npx bp verify general node_modules/@mcptoolshop/backprop-trace/fixtures/iris.golden.jsonl
```

Common flags (per [`docs/cli.md`](./docs/cli.md) for full reference):

- `--json` — machine-readable JSON output (CI consumers).
- `--verbose`, `-V` — diagnostic stderr before the run.
- `--color=auto|never|always` — color output; honors `NO_COLOR`.
- File argument `-` reads from stdin (`reconcile receipt`, `validate`, `verify mazur`).

Exit codes: 0 pass, 1 verification failure, 2 I/O / malformed input, 3 invalid CLI argument.

`bp --version` and `bp --help` work without a subcommand; `bp <subcommand> --help` shows subcommand-specific usage.

## Library usage

```ts
import {
  reconcileReceipt,
  runMazurStep,
  MAZUR_INPUT,
  validateReceiptSchema,
  hashReceipt,
  verifyEngineReproduces,
} from '@mcptoolshop/backprop-trace';

const receipt = runMazurStep(MAZUR_INPUT);

// Validate against the bundled JSON Schema (v0.2+).
const validated = validateReceiptSchema(receipt);
if (!validated.ok) { console.error(validated.errors); process.exit(1); }

// Reconcile the math against all 8 rules.
const result = reconcileReceipt(receipt);
if (!result.ok) { console.error(result.failures); process.exit(1); }

// Hash the canonical bytes — in-toto v1 attestation seam (v0.2+).
const sha = hashReceipt(receipt);

// Confirm the engine reproduces a receipt byte-for-byte (v0.2+).
const v = verifyEngineReproduces(receipt);
if (!v.matches) { console.error('diverges at byte', v.firstDifferingByte); }
```

See [`docs/attestation.md`](./docs/attestation.md) for the in-toto v1 mapping.

Subpath imports are exported (`./reconcile`, `./engine`, `./general-engine`, `./mazur`, `./topology`, `./activations`, `./emit`, `./format`, `./runtime-format`, `./validate`, `./parse`, `./hash`, `./schema-loader`, `./verify-engine`, `./extract`, `./schema`, `./schema/0.1.0`, `./schema/0.2.0`).

## What this is

A *structural-trace verifier* with canonical bytewise encoding. The receipt is the contract; the reconciler walks every claim a receipt makes and checks the math line up.

v0.3 generalizes the engine beyond Mazur 2-2-2 — ship XOR 2-2-1 and iris 4-3-3 fixtures using the same 10-rule reconciler. Hybrid tolerance (atol + rtol, symmetric max form) replaces the v0.1 pure-absolute 1e-9. Multi-step training receipts (`trace_id` + `step_index`) verified by Rules 9 + 10.

Reference class:

- Proof-of-Learning (Jia et al. IEEE S&P 2021 — https://ar5iv.labs.arxiv.org/html/2103.05633)
- REFORMS (Kapoor et al. Science Advances 2024 — https://www.science.org/doi/10.1126/sciadv.adk3452)
- Csmith (Yang et al. PLDI 2011 — https://users.cs.utah.edu/~regehr/papers/pldi11-preprint.pdf) + CompCert (Leroy CACM 2009 — https://xavierleroy.org/publi/compcert-CACM.pdf) for the bad-receipts-precede-good doctrine

NOT zkML (no cryptographic succinctness). NOT opML (no fraud-proof game). NOT an ML metrics logger — backprop-trace writes decimal strings instead of binary floats; closer to Jest snapshots / Rust insta in spirit.

## Determinism scope

9-sig-fig trace fidelity within V8/Node 22 ULP envelope. Pinned engine values assume scalar IEEE 754 doubles on V8.

Cross-engine portability (Hermes, JSC, Bun-JSC) is **not tested**. The widely-cited downstream anchor `0.291027924` differs from the engine value `0.29102777369359933` by ~1.5e-7; see `fixtures/mazur.published.json` for the drift ledger.

v0.3 is pinned to Node 22.x. ReLU and identity activations are exact arithmetic; sigmoid inherits the Math.exp ULP envelope. Hybrid tolerance (`atol = 1e-12`, `rtol = 1e-9`) covers the v0.1 product drift previously documented in `fixtures/bad/mazur.bad-gradient.meta.json`.

## The ten rules

1. Output error signal consistency
2. Downstream contribution and backpropagated sum
3. Hidden error signal consistency
4. Update gradient consistency
5. Update value consistency
6. Weight progression
7. Final state consistency
8. Provenance reference consistency
9. Multi-step parameter chain (`parameters_before[N]` equals prior `parameters_after[N-1]`)
10. Multi-step trace identity (shared `trace_id` + sequential `step_index`)

Rules 1-8 are wired in v0.2 (Rule 4 originally shipped in v0.1). Rules 9 + 10 ship in v0.3 and fire only on the multi-record verify path (`bp verify multi`). Full rule statements in [`docs/reconciliation.md`](./docs/reconciliation.md); each rule ships with a deliberately-broken `fixtures/bad/<kind>.jsonl` fixture per the Csmith doctrine.

## The law stack

From `docs/canonical-emission.md`:

> Contract precedes engine. Formatter policy precedes runtime formatting. Bad receipts precede good receipts. Runtime formatting precedes Mazur. Mazur precedes diagnostics.

## v0.3 scope

- Generalized N-input N-hidden N-output topology (Mazur 2-2-2, XOR 2-2-1, iris 4-3-3 ship as fixtures; layer sizes 1-64)
- Sigmoid / identity / ReLU activations
- Half-squared-error (MSE) loss only
- Per-layer biases (per-neuron deferred)
- SGD optimizer (no momentum, no Adam, no weight decay)
- Hybrid tolerance (`atol + rtol`, symmetric max form)
- Single-step + multi-step training receipts (`trace_id` + `step_index` overlay)
- CPU-only (no GPU determinism claims)
- V8 / Node 22.x only

Alternative losses (cross-entropy, softmax), per-neuron biases, richer
optimizers (momentum, Adam), and tanh activation are reserved for v0.4+
(see [`CHANGELOG.md`](./CHANGELOG.md) for what landed in v0.3).

## Links

- [`docs/quickstart.md`](./docs/quickstart.md) — five-minute walk-through (Mazur, XOR, iris)
- [`docs/cli.md`](./docs/cli.md) — `bp` subcommand reference (v0.3+)
- [`docs/reconciliation.md`](./docs/reconciliation.md) — the ten reconciler rules
- [`docs/topology.md`](./docs/topology.md) — general-topology authoring guide (v0.3+)
- [`docs/multi-step.md`](./docs/multi-step.md) — multi-step training receipts, `trace_id` + `step_index` (v0.3+)
- [`docs/canonical-emission.md`](./docs/canonical-emission.md) — byte-level encoding contract
- [`docs/computation-order.md`](./docs/computation-order.md) — IEEE 754 ordering rules; FMA prohibition; hybrid tolerance (v0.3+)
- [`docs/schema.md`](./docs/schema.md) — field-by-field walk-through of the receipt schema (v0.1.0 and v0.2.0)
- [`docs/attestation.md`](./docs/attestation.md) — in-toto v1 attestation seam (v0.2+)
- `fixtures/` — canonical goldens (Mazur, XOR, iris), published ledgers, formatter policy, deliberately-broken bad-* receipts (one per reconciler rule plus multi-step bad-chain and bad-trace-id)
- `schemas/receipt.v0.1.0.json` + `schemas/receipt.v0.2.0.json` — receipt JSON Schemas (closed, `x-order`-annotated, additive)
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — the law stack, the anti-circularity ratchet, the bad-receipts-precede-good doctrine
- [`SECURITY.md`](./SECURITY.md) — what counts as a vulnerability for a verifier

## License

MIT — see `LICENSE`.
