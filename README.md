<p align="center">
  <a href="README.zh.md">中文</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.hi.md">हिन्दी</a> | <a href="README.it.md">Italiano</a> | <a href="README.pt-BR.md">Português (BR)</a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/mcp-tool-shop-org/brand/main/logos/backprop-trace/readme.png" alt="backprop-trace" width="400">
</p>

<p align="center">
  <a href="https://github.com/mcp-tool-shop-org/backprop-trace/actions"><img alt="CI" src="https://github.com/mcp-tool-shop-org/backprop-trace/actions/workflows/ci.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="MIT License" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
  <a href="https://www.npmjs.com/package/@mcptoolshop/backprop-trace"><img alt="npm" src="https://img.shields.io/npm/v/@mcptoolshop/backprop-trace.svg"></a>
</p>

A deterministic structural-trace verifier for single neural-network training steps — a 16-rule reconciler that re-derives gradients, signals, and parameter updates from named factors and emits canonical bytewise JSONL receipts. In the Csmith/CompCert lineage of *"the oracle must not consult the artifact it judges."*

> **Status: mid-v0 (v0.7.0).** The core engine and reconciler are real and shipping. Single-step, CPU-only, SGD-only, single-sample. External framework traces are hand-authored sidecars today. See [What's not in this version (yet)](#whats-not-in-this-version-yet) before you pick this up for production work.

## 30-second quickstart

```bash
pnpm add @mcptoolshop/backprop-trace

# 1. Success path — the verifier accepts a well-formed receipt
npx bp verify mazur
# exit 0 — 16 rules pass on the bundled Mazur 2-2-2 fixture
#          (schema + reconcile + engine-reproduce + byte-equal-vs-golden)

# 2. Rejection path — the verifier rejects a deliberately-broken receipt
npx bp reconcile receipt node_modules/@mcptoolshop/backprop-trace/fixtures/bad/mazur.bad-gradient.jsonl
# exit 1 — Rule 4: update.gradient mismatch on w5
# (the fixture is broken on purpose; the verifier must reject it
#  BEFORE consulting fixture_status metadata — the anti-circularity ratchet)

# 3. Canonical bytes — what an attestation envelope would wrap
npx bp generate mazur | sha256sum
# 9-sig-fig canonical bytes (V8/Node 22.x) — in-toto v1 attestation seam
```

The Mazur 2-2-2 is the most-cited single-step backprop walkthrough on the open web (Matt Mazur, 2015 — [mattmazur.com/2015/03/17/a-step-by-step-backpropagation-example](https://mattmazur.com/2015/03/17/a-step-by-step-backpropagation-example/)). It's the hero fixture because every number in it is derivable by hand. For your own trace, see [Bring your own training trace](#bring-your-own-training-trace).

## What this is

backprop-trace is a numerical-correctness verifier for *one* neural-network training step. You hand it a receipt — a JSONL record naming every factor that contributed to a single gradient update — and the reconciler walks 16 rules that re-derive every claim from the named factors. If any rule disagrees within hybrid tolerance (`atol + rtol`, symmetric max form), the receipt is rejected.

The doctrinal anchor is Csmith (Yang, Chen, Eide, Regehr — PLDI 2011, [https://users.cs.utah.edu/~regehr/papers/pldi11-preprint.pdf](https://users.cs.utah.edu/~regehr/papers/pldi11-preprint.pdf)) and CompCert (Leroy, CACM 2009, [https://xavierleroy.org/publi/compcert-CACM.pdf](https://xavierleroy.org/publi/compcert-CACM.pdf)): adversarial corpora prove a verifier, passing tests do not. Every reconciler rule ships with a deliberately-broken fixture in [`fixtures/bad/`](./fixtures/bad) that the verifier must reject *before* reading any `fixture_status` lifecycle metadata. This anti-circularity discipline — the oracle must not consult the artifact it judges — is the load-bearing property.

## What this is *not*

- **Not an experiment tracker.** If you want loss curves, dashboards, or longitudinal run storage, use [MLflow](https://mlflow.org), [Weights & Biases](https://wandb.ai), or [TensorBoard](https://www.tensorflow.org/tensorboard). Those log what the trainer claims happened. backprop-trace re-derives whether the math is internally consistent. Complementary, not overlapping.
- **Not Proof-of-Learning or zkML.** The PoL line (Jia et al., IEEE S&P 2021 — [arxiv.org/abs/2103.05633](https://arxiv.org/abs/2103.05633)) was shown to be forgeable on real training (Fang et al., EuroS&P 2023 — [https://experts.illinois.edu/en/publications/proof-of-learning-is-currently-more-broken-than-you-think/](https://experts.illinois.edu/en/publications/proof-of-learning-is-currently-more-broken-than-you-think/)). zkML/opML (EZKL, Modulus, ORA) produces cryptographic or economically-backed proofs for trustless on-chain settlement. backprop-trace is non-cryptographic, single-step, audience-is-a-human-or-CI-reviewer.
- **Not supply-chain attestation.** [Sigstore model-signing](https://github.com/sigstore/model-transparency), [SLSA-for-models](https://slsa.dev), and [CycloneDX ML-BOM](https://cyclonedx.org/capabilities/mlbom/) attest that *artifact X was produced by pipeline Y*. backprop-trace attests that *this update is mathematically derivable from these factors*. Complementary — an ML-BOM can reference a backprop-trace receipt as an internal-consistency predicate.

## Threat model

backprop-trace is a deterministic verifier: in scope is any receipt that should be rejected but is accepted — schema bypass, NaN/Infinity poisoning, canonical-emission divergence, anti-circularity violations (the reconciler consulting `fixture_status` before completing rule checks), and engine-recompute disagreement on imported framework traces. Out of scope is the trustworthiness of the training run itself, the correctness of the model being trained, side-channel or timing attacks against the verifier process, and anything beyond the receipt-acceptance decision. Determinism is bounded: byte-identical output is guaranteed only across the same backprop-trace version, the same Node.js major (currently 22.x), and the same canonical-emission spec version. Cross-engine (Hermes, JSC, Bun-JSC) and cross-Node-major (24.x, 26.x, …) reproduction are non-goals. The verifier trusts the receipt format and the canonical-emission contract; it does not trust the producer. See [SECURITY.md](./SECURITY.md) for the disclosure timeline, severity rubric, and full enumeration.

## Install

```bash
pnpm add @mcptoolshop/backprop-trace
# or
npm install @mcptoolshop/backprop-trace
```

Pinned to Node 22.x (V8 fdlibm `Math.exp` determinism is load-bearing — see [`docs/computation-order.md`](./docs/computation-order.md)).

## CLI usage

v0.7 ships 16 subcommands. Full reference: [`docs/cli.md`](./docs/cli.md).

```
bp reconcile receipt <file>          Reconcile a receipt against the 16 rules.
bp verify mazur [<file>]             Full gate (Mazur 2-2-2): schema + reconcile + engine-reproduce + byte-equal + drift.
bp verify general <file>             Generalized verify for any v0.2+ receipt (XOR, iris, softmax+CE, custom).
bp verify multi <file.jsonl>         Multi-record JSONL; per-record Rules 1-8 + cross-record Rules 9 + 10.
bp generate mazur [--out F]          Re-run the Mazur engine, emit canonical bytes.
bp generate xor [--out F]            Re-run the XOR engine, emit canonical bytes.
bp generate iris [--out F]           Re-run the iris engine, emit canonical bytes.
bp generate from-config <file>       Read a topology+input JSON, emit a canonical receipt.
bp scaffold topology --topology T    Write a sample input file (T = mazur|xor|iris).
bp validate-input <file>             Schema-validate an input config without running the engine.
bp validate <file>                   Schema-only validation of a receipt (auto-detects v0.1/0.2/0.3/0.4).
bp import pytorch <sidecar.jsonl>    Ingest a PyTorch framework trace; emit observer-mode receipt + Rule 14 diff.
bp import jax <sidecar.jsonl>        Ingest a JAX framework trace; same shape as PyTorch.
bp import tensorflow <sidecar.jsonl> Ingest a TensorFlow framework trace; same shape as PyTorch / JAX.
```

Common flags (see [`docs/cli.md`](./docs/cli.md)):

- `--out <file>` — write to file instead of stdout
- `--json` — machine-readable JSON output (CI consumers)
- `--verbose`, `-V` — diagnostic stderr before the run
- `--color=auto|never|always` — color output; honors `NO_COLOR`
- File argument `-` reads from stdin (`reconcile receipt`, `validate`, `verify general`)

Exit codes: `0` pass · `1` verification failure · `2` usage or I/O error · `3` invalid CLI argument · `4` framework not implemented.

## Library usage

```ts
import {
  reconcileReceipt,
  runMazurStep,
  MAZUR_INPUT,
  validateReceiptSchema,
  hashReceipt,
  verifyEngineReproduces,
  importPytorchSidecar,
  importJaxSidecar,
  importTensorflowSidecar,
} from '@mcptoolshop/backprop-trace';

// Engine-authored receipt (built-in Mazur / XOR / iris path)
const receipt = runMazurStep(MAZUR_INPUT);

const validated = validateReceiptSchema(receipt);
if (!validated.ok) { console.error(validated.errors); process.exit(1); }

const result = reconcileReceipt(receipt);
if (!result.ok) { console.error(result.failures); process.exit(1); }

const sha = hashReceipt(receipt);                  // in-toto v1 attestation seam
const repro = verifyEngineReproduces(receipt);     // confirm engine reproduces bit-equal

// External framework trace (observer-mode receipt path — v0.6+)
const { emittedBytes, receipt: imported, differentialPassed } =
  importPytorchSidecar(sidecarBytes, { importTimestamp: '2026-05-17T00:00:00Z' });
if (!differentialPassed) { /* engine recomputation disagreed; see receipt.attestor */ }
```

Subpath imports: `./reconcile`, `./engine`, `./general-engine`, `./mazur`, `./topology`, `./activations`, `./emit`, `./format`, `./runtime-format`, `./validate`, `./parse`, `./parse-input`, `./hash`, `./schema-loader`, `./verify-engine`, `./extract`, `./import-pytorch`, `./import-jax`, `./import-tensorflow`, `./import-observer`, `./schema`, `./schema/0.1.0`, `./schema/0.2.0`, `./schema/0.3.0`, `./schema/receipt-0.4.0`, `./schema/0.4.0` (topology-input), `./schema/framework-trace-0.1.0`.

## Bring your own training trace

The v0.6 external-ingestion path lets PyTorch / JAX / TensorFlow users verify their own single-step backprop traces against the same 16 rules — but **today the sidecar is hand-authored**. There is no `pip install backprop-trace-pytorch` helper yet. To produce a sidecar:

1. Read the [`framework-trace.v0.1.0`](./schemas/framework-trace.v0.1.0.json) schema — it defines a JSONL contract for one training step (topology + input + forward + gradients + parameters_before + parameters_after + provenance).
2. Extract those values from your training step (PyTorch `autograd`, JAX `grad`/`value_and_grad`, TF `tf.GradientTape` — all expose the necessary per-tensor numerics).
3. Emit the sidecar as canonical JSONL (decimal strings, not binary floats — see [`docs/canonical-emission.md`](./docs/canonical-emission.md)).
4. Run `bp import pytorch <sidecar.jsonl>` (or `import jax` / `import tensorflow`).
5. The importer produces an **observer-mode receipt**: the framework's claims live as canonical fields; the backprop-trace engine recomputes the same step and runs **Rule 14** as a differential check. Disagreement = your extractor lied, or your framework drifted, or something is wrong with the trace.

This is a real workflow today, but it is friction-heavy. See [What's not in this version (yet)](#whats-not-in-this-version-yet) for the live-helper packaging gap.

Per-framework subcommand discipline is enforced: `bp import pytorch` rejects JAX sidecars and vice versa. No auto-detection (no live framework runtime dependency in this package — by design).

## The 16 rules

| # | Rule |
|---|---|
| 0 | Structural-failure sentinel (schema-level) |
| 0.8 | Probability bounds — softmax outputs in [0, 1] |
| 1 | Output error signal consistency |
| 2 | Downstream contribution and backpropagated sum |
| 3 | Hidden error signal consistency |
| 4 | Update gradient consistency |
| 5 | Update value consistency |
| 6 | Weight progression |
| 7 | Final state consistency |
| 8 | Provenance reference consistency |
| 9 | Multi-step parameter chain (`parameters_before[N]` = prior `parameters_after[N-1]`) |
| 10 | Multi-step trace identity (shared `trace_id` + sequential `step_index`) |
| 11 | Softmax normalization (`sum(forward[output].out) == 1.0`) |
| 12 | Loss formula consistency (half-squared-error + cross-entropy-softmax branches) |
| 13 | Dual-form consistency (softmax+CE jacobian decomposition; GATED — fires only when `dual_form` present) |
| 14 | Engine-recompute differential (MANDATORY for observer-mode imported receipts) |
| 15 | Skip-basis required (closed enum `EXTERNAL_TRUST_BASIS`, 4 values) |
| 16 | Attestation digest binding (GATED — fires when `attestor.signed_subject_digest` present) |

Full statements in [`docs/reconciliation.md`](./docs/reconciliation.md). Every rule ships with a paired bad fixture in `fixtures/bad/` per the Csmith doctrine.

## Determinism scope

What's contractual on the pinned matrix (Node 22.x × {ubuntu, macos, windows} × backprop-trace 0.7.x):

- Byte-equal `mazur.golden.jsonl` / `xor.golden.jsonl` / `iris.golden.jsonl` / `softmax-ce.golden.jsonl` / `xor-per-neuron-bias.golden.jsonl` / `xor.multi-step.jsonl`
- Byte-equal external goldens for the bundled framework sidecars: `pytorch.softmax-ce.golden.jsonl`, `jax.softmax-ce.golden.jsonl`, `tensorflow.softmax-ce.golden.jsonl`
- The Mazur 2-2-2 anchor: `post_update_loss.total = 0.29102777369359933` (vs widely-cited downstream `0.291027924` — drift ~1.5e-7; see `fixtures/mazur.published.json` for the ledger)
- Per-rule reconciliation within hybrid tolerance (`atol = 1e-12`, `rtol = 1e-9` for engine-authored; tighter where the math is exact)

What's NOT contractual:

- Cross-engine (Bun, Deno, browsers) — different `Math.exp` implementations
- Cross-Node-major (24.x, 26.x, …) — V8 fdlibm port may be revised
- Arbitrary V8 minor bumps — ECMA-262 §21.3 leaves `Math.exp` precision implementation-defined
- Bit-stability of values that flow through `Math.exp` (sigmoid, tanh, softmax) across V8 versions

A `Math.exp(-0.5)` canary runs on every CI cell as an early-warning siren for V8 fdlibm drift. A failure means "investigate V8 changelog," not "engine bug."

## What's not in this version (yet)

backprop-trace v0.7.0 is a **mid-v0 product**. The core engine, the reconciler, the canonical-emission contract, and the external-ingestion path are real and stable. But several things a v1.0 verifier needs are not yet in:

- **Multi-step observer-mode receipts.** External ingestion is single-step today. Real training runs are thousands of steps. *Targeted next: v0.8.*
- **Optimizers beyond vanilla SGD.** No Adam, AdamW, momentum, or weight decay. Real ML training in 2026 is overwhelmingly Adam; SGD-only is a real limitation. *Roadmap target: v0.9.*
- **Batch dimension.** Currently single-sample. Real PyTorch/JAX/TF training is batched. A user with their actual training step cannot import it without manually unrolling per-sample. *Roadmap target: v0.9.*
- **Live framework helpers.** The sidecar is hand-authored today; no `pip install backprop-trace-pytorch` package, no `scripts/python-helpers/dump_pytorch_trace.py` ready-to-run extractor. The path from "I have a PyTorch step" to "I have a receipt" is too long. *Roadmap target: v0.10.*
- **Real-world fixture.** The hero is the Mazur 2-2-2 pedagogical example. A v1.0 verifier should have at least one recognizable architecture (small CNN forward+backward, small transformer block) as a built-in fixture. *Roadmap target: v0.11.*
- **Adopter validation.** No external researcher case study, no course adopting this for pedagogy, no compliance engineer who used it for an audit bundle. *Roadmap target: before any v1.0 promotion.*
- **GPU determinism.** Out of scope (and likely will remain so — cuDNN ConvolutionBackwardFilter atomics defeat bit-exactness across runs, [CMU SEI](https://www.sei.cmu.edu/blog/the-myth-of-machine-learning-reproducibility-and-randomness-for-acquisitions-and-testing-evaluation-verification-and-validation/)). The product position is: deterministic CPU corner.

If your workflow depends on any of these, this isn't the right version for you yet.

## Authoring custom topologies

Drive the engine from a JSON config — no TypeScript edits required:

```bash
bp scaffold topology --topology xor --out my-net.input.json
# edit my-net.input.json
bp validate-input my-net.input.json
bp generate from-config my-net.input.json --out my-net.golden.jsonl
bp verify general my-net.golden.jsonl
```

See [`docs/authoring.md`](./docs/authoring.md) for the walkthrough — input vs receipt schemas, the canonical-emission trust boundary.

## Where this fits

- **Reproducibility-first paper authors** (NeurIPS/ICML/CoLLAs submitters; REFORMS-aware researchers — Kapoor et al., *Science Advances* 2024, [https://www.science.org/doi/10.1126/sciadv.adk3452](https://www.science.org/doi/10.1126/sciadv.adk3452)) — re-derivable per-step evidence the reviewer runs in 30s.
- **ML pedagogy** (Karpathy zero-to-hero, university DL courses, ML systems interview prep) — a single named training step with every factor visible and a reconciler that *rejects* deliberately-broken fixtures.
- **ML framework / compiler engineers** (PyTorch / JAX / MLIR / XLA contributors) — generate a known-good per-op trace for differential testing against new compiler output.
- **ML compliance / audit engineers** (EU AI Act Article 10 implementers, [https://artificialintelligenceact.eu/annex/4/](https://artificialintelligenceact.eu/annex/4/); SLSA-for-ML consumers) — a per-step receipt format below model-signing, attached to a model card or audit bundle.

## Reference class

- **Proof-of-Learning lineage** — Jia et al. (IEEE S&P 2021, [arxiv.org/abs/2103.05633](https://arxiv.org/abs/2103.05633)) for the structural idea; Fang et al. (EuroS&P 2023) for the honest caveat that PoL is forgeable in practice. backprop-trace scopes down to the determinism-achievable corner: single-step CPU verification.
- **REFORMS** — Kapoor et al. (*Science Advances* 2024, [https://www.science.org/doi/10.1126/sciadv.adk3452](https://www.science.org/doi/10.1126/sciadv.adk3452)) — 32-item ML reproducibility checklist; receipt-style per-step evidence maps onto items 24-30.
- **Csmith + CompCert doctrine** — Yang et al. (PLDI 2011) and Leroy (CACM 2009) — adversarial corpora prove a verifier; the oracle must not consult the artifact it judges.
- **Supply-chain attestation** — in-toto v1, SLSA Provenance v1.0, Sigstore model-transparency ([github.com/sigstore/model-transparency](https://github.com/sigstore/model-transparency)) — backprop-trace receipts can be wrapped as DSSE statement subjects.

NOT zkML (no cryptographic succinctness). NOT opML (no fraud-proof game). NOT an ML metrics logger — backprop-trace writes decimal strings instead of binary floats; closer to Jest snapshots / Rust insta in spirit.

## The law stack

From `docs/canonical-emission.md`:

> Contract precedes engine. Formatter policy precedes runtime formatting. Bad receipts precede good receipts. Runtime formatting precedes Mazur. Mazur precedes diagnostics.

## Links

- [`docs/quickstart.md`](./docs/quickstart.md) — five-minute walk-through
- [`docs/cli.md`](./docs/cli.md) — `bp` subcommand reference
- [`docs/authoring.md`](./docs/authoring.md) — author a custom topology
- [`docs/reconciliation.md`](./docs/reconciliation.md) — the 16 reconciler rules
- [`docs/topology.md`](./docs/topology.md) — general-topology authoring
- [`docs/multi-step.md`](./docs/multi-step.md) — multi-step training receipts (engine-authored)
- [`docs/canonical-emission.md`](./docs/canonical-emission.md) — byte-level encoding contract
- [`docs/computation-order.md`](./docs/computation-order.md) — IEEE 754 ordering; FMA prohibition; hybrid tolerance; determinism boundary
- [`docs/schema.md`](./docs/schema.md) — field-by-field schema walk-through
- [`docs/attestation.md`](./docs/attestation.md) — in-toto v1 attestation seam
- `fixtures/` — canonical goldens (Mazur, XOR, XOR per-neuron-bias, iris, softmax-CE, multi-step XOR), external sidecars + observer-mode goldens (PyTorch, JAX, TensorFlow), deliberately-broken bad-* receipts (one per reconciler rule)
- `schemas/` — receipt v0.1.0 / v0.2.0 / v0.3.0 / v0.4.0, topology-input v0.4.0, framework-trace v0.1.0 (all closed, `x-order`-annotated, additive)
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — the law stack, anti-circularity ratchet, bad-receipts-precede-good doctrine
- [`SECURITY.md`](./SECURITY.md) — what counts as a vulnerability for a verifier
- [`CHANGELOG.md`](./CHANGELOG.md) — version-by-version history

## License

MIT — see `LICENSE`.
