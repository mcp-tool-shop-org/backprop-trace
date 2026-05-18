<p align="center">
  <a href="README.zh.md">中文</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.hi.md">हिन्दी</a> | <a href="README.it.md">Italiano</a> | <a href="README.pt-BR.md">Português (BR)</a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/mcp-tool-shop-org/brand/main/logos/backprop-trace/readme.png" alt="backprop-trace" width="400">
</p>

<p align="center">
  <a href="https://github.com/mcp-tool-shop-org/backprop-trace/actions"><img alt="CI" src="https://github.com/mcp-tool-shop-org/backprop-trace/actions/workflows/ci.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="MIT License" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
  <a href="https://mcp-tool-shop-org.github.io/backprop-trace/"><img alt="Landing Page" src="https://img.shields.io/badge/landing-page-blue.svg"></a>
</p>

A deterministic 26-rule verifier for neural-network training steps. You hand it a receipt naming every factor that contributed to one gradient update; the reconciler re-derives every claim and rejects on disagreement. In the Csmith/CompCert lineage of *"the oracle must not consult the artifact it judges."*

> **Status: mid-v0 (v0.10.3).** CPU-only. Verifier covers SGD + Adam + AdamW + PyTorch-style SGD momentum (classical + Nesterov + dampening).
> Live PyTorch helper (`scripts/extract/pytorch.py`) covers the same optimizer matrix. Observer-only — [Rule 14](./docs/reconciliation.md) is the authority.
> No tag · no npm publish · no v1 framing until the [v1.0 gaps](#whats-not-in-this-version-yet) close. See [`docs/live-helpers.md`](./docs/live-helpers.md) before production use.

## 30-second quickstart

```bash
pnpm add @mcptoolshop/backprop-trace

# 1. Success path — verifier accepts a well-formed receipt
npx bp verify mazur
# exit 0 — schema + reconcile + engine-reproduce + byte-equal-vs-golden

# 2. Rejection path — verifier rejects a deliberately-broken receipt
npx bp reconcile receipt node_modules/@mcptoolshop/backprop-trace/fixtures/bad/mazur.bad-gradient.jsonl
# exit 1 — Rule 4: update.gradient mismatch on w5
# (the fixture is broken on purpose; the verifier rejects it BEFORE
#  consulting fixture_status metadata — the anti-circularity ratchet)

# 3. Canonical bytes — what an attestation envelope would wrap
npx bp generate mazur | sha256sum
# 9-sig-fig canonical bytes (V8/Node 22.x) — in-toto v1 attestation seam
```

The Mazur 2-2-2 is the most-cited single-step backprop walkthrough on the open web ([Matt Mazur, 2015](https://mattmazur.com/2015/03/17/a-step-by-step-backpropagation-example/)). Every number in it is derivable by hand.

## What this is

A numerical-correctness verifier for one training step. The reconciler walks 26 rules that re-derive each claim from the named factors. If any rule disagrees within hybrid tolerance (`atol + rtol`), the receipt is rejected. Multi-step (Rules 9 + 10), batched (Rules 18 + 19), Adam moment recurrences (Rules 22-24), SGD momentum recurrence (Rules 20 + 21a/21b/21c + 25 + 26), and engine-recompute differential on imported framework traces (Rule 14) cover the production-relevant surfaces.

It does **not** validate the overall training run, prove the model is correct, or replace an experiment tracker. It proves each recorded step is mathematically consistent and that the chain is intact. Adversarial corpora prove a verifier ([Csmith PLDI 2011](https://users.cs.utah.edu/~regehr/papers/pldi11-preprint.pdf); [CompCert CACM 2009](https://xavierleroy.org/publi/compcert-CACM.pdf)) — every rule ships with a paired bad fixture under [`fixtures/bad/`](./fixtures/bad) that the verifier must reject *before* reading any `fixture_status` metadata.

## Live PyTorch helper (v0.10+)

Single auditable Python file. No pip package by design — copy it into your repo, read it, run it.

```bash
# 1. Install + copy the helper
pnpm add @mcptoolshop/backprop-trace
npx bp examples pytorch --print > pytorch_trace_helper.py

# 2. Wrap your training loop (5-line diff)
#    from pytorch_trace_helper import TraceDumper
#    dumper = TraceDumper(model, optimizer, loss_fn, out="trace.jsonl")
#    with dumper.step(inputs=..., targets=...):
#        optimizer.zero_grad(); loss.backward(); optimizer.step()
python my_train.py

# 3. Verify
npx bp import pytorch trace.jsonl | npx bp verify multi -
# exit 0 — clean · 1 — Rule violation · 2 — I/O error
```

The helper emits a `framework-trace.v0.7.0` sidecar with a forensic `helper` block (name, version, source_hash, framework version, runtime, extraction timestamp). The block is **not a credential** — Rule 14 (engine-recompute differential) is the authority on every helper-emitted sidecar regardless of what the helper claims. A spoofed/wrong/missing `source_hash` does NOT bypass Rule 14. See [`docs/live-helpers.md`](./docs/live-helpers.md) for the trust-boundary statement, the forbidden list, the 9-fixture adversarial catalog, and the no-pip-distribution flip-signal contract.

**Supported (v0.10.x)**: PyTorch SGD + Adam + AdamW + sgd_momentum (classical/Nesterov/dampening, with the `momentum_buffer` ascent→descent sign-flip per [PyTorch issue #1099](https://github.com/pytorch/pytorch/issues/1099)). CPU-first. Single + multi-step.
**Rejected at boundary**: AMP/autocast, CUDA/MPS/XLA, SGD coupled-L2 weight decay, AMSGrad/NAdam/RAdam/Lion/LBFGS, multi-hidden-layer topologies. Hand-authored sidecars for those frameworks/optimizers continue to work via the standard `bp import` path.

## What this isn't

- **Not an experiment tracker.** Use [MLflow](https://mlflow.org), [Weights & Biases](https://wandb.ai), [TensorBoard](https://www.tensorflow.org/tensorboard) — those log claims; backprop-trace re-derives whether the math is internally consistent.
- **Not Proof-of-Learning or zkML.** [PoL](https://arxiv.org/abs/2103.05633) was shown forgeable on real training ([Fang et al. EuroS&P 2023](https://arxiv.org/abs/2208.03567)); zkML produces cryptographic proofs. backprop-trace is non-cryptographic, single-step, audience-is-a-human-or-CI-reviewer.
- **Not supply-chain attestation.** [Sigstore model-signing](https://github.com/sigstore/model-transparency), [SLSA-for-models](https://slsa.dev), [CycloneDX ML-BOM](https://cyclonedx.org/capabilities/mlbom/) attest pipeline provenance; backprop-trace attests numerical consistency. An ML-BOM can reference a backprop-trace receipt as an internal-consistency predicate.

## Threat model

In scope: any receipt that should be rejected but is accepted — schema bypass, NaN/Infinity poisoning, canonical-emission divergence, anti-circularity violations, engine-recompute disagreement on imported sidecars. Out of scope: trustworthiness of the training run itself, side-channel attacks on the verifier process. Determinism is bounded: byte-identical output is guaranteed only across the same backprop-trace version, Node.js 22.x, and the same canonical-emission spec. See [SECURITY.md](./SECURITY.md) for the full enumeration + disclosure timeline.

## Install

```bash
pnpm add @mcptoolshop/backprop-trace   # or: npm install @mcptoolshop/backprop-trace
```

Pinned to Node 22.x (V8 fdlibm `Math.exp` determinism is load-bearing — see [`docs/computation-order.md`](./docs/computation-order.md)).

## CLI

Full reference: [`docs/cli.md`](./docs/cli.md).

| Verb | Purpose |
|---|---|
| `bp reconcile receipt <file>` | Run all 26 rules; exit 1 on first failure |
| `bp verify mazur` | Full gate on the bundled Mazur fixture |
| `bp verify general <file>` | Generalized gate (v0.2+ receipts: XOR, iris, softmax+CE, observer-mode) |
| `bp verify multi <file.jsonl>` | Multi-record JSONL + cross-record Rules 9/10 |
| `bp generate {mazur,xor,iris}` | Re-run the named engine, emit canonical bytes |
| `bp generate from-config <file>` | Re-run engine from a topology+input JSON |
| `bp scaffold topology --topology mazur\|xor\|iris` | Write a starter input config |
| `bp validate-input <file>` | Schema-validate a topology+input config |
| `bp validate <file>` | Schema-validate a receipt (auto-detects v0.1-v0.7) |
| `bp import {pytorch,jax,tensorflow} [multi] <sidecar>` | Ingest external framework trace |
| `bp examples pytorch [--print]` | Print path of (or cat) the bundled PyTorch helper |

Common flags: `--out <file>`, `--json`, `--verbose`/`-V`, `--color=auto\|never\|always`, file arg `-` = stdin. Exit codes: `0` pass · `1` verification failure · `2` usage/I-O · `3` invalid CLI arg · `4` framework not implemented.

## Library

```ts
import {
  reconcileReceipt, runMazurStep, MAZUR_INPUT,
  validateReceiptSchema, hashReceipt, verifyEngineReproduces,
  importPytorchSidecar, importJaxSidecar, importTensorflowSidecar,
} from '@mcptoolshop/backprop-trace';

const receipt = runMazurStep(MAZUR_INPUT);
const validated = validateReceiptSchema(receipt);    // schema gate
const result = reconcileReceipt(receipt);             // 26-rule gate
const sha = hashReceipt(receipt);                     // in-toto seam
const repro = verifyEngineReproduces(receipt);        // bit-equal recompute

const { receipt: imported, differentialPassed } =
  importPytorchSidecar(sidecarBytes);                 // observer-mode + Rule 14
```

Subpath imports: `./reconcile`, `./engine`, `./general-engine`, `./mazur`, `./topology`, `./activations`, `./emit`, `./validate`, `./parse`, `./parse-input`, `./hash`, `./schema-loader`, `./verify-engine`, `./extract`, `./import-pytorch`, `./import-jax`, `./import-tensorflow`, `./import-observer`, plus the schema family `./schema/...`.

## The 26 rules

Full statements + adversarial fixtures: [`docs/reconciliation.md`](./docs/reconciliation.md).

| # | Rule |
|---|---|
| 0 | Structural-failure sentinel (schema-level) |
| 0.8 | Probability bounds — softmax outputs in [0, 1] |
| 1-4 | Error signals (output, downstream, hidden) + update gradient consistency |
| 5-7 | Update value, weight progression, final state (AdamW branch on Rules 6/7 for decoupled wd) |
| 8 | Provenance reference consistency |
| 9-10 | Multi-step parameter chain + trace identity |
| 11-13 | Softmax normalization + loss formula + dual-form (GATED) |
| 14 | Engine-recompute differential (MANDATORY on observer-mode imports) |
| 15-17 | Skip-basis + signed-digest binding + bundle-root binding (GATED) |
| 18-19 | Batch reduction consistency + sample-set coherence (GATED) |
| 20 | Optimizer-state shape (Adam `{m, v}` / sgd_momentum `{buffer}`) |
| 21 | **PyTorch-style SGD momentum**: 21a buffer recurrence + 21b effective direction + 21c parameter update |
| 22-24 | Adam moment recurrences + bias correction + parameter update (epsilon OUTSIDE sqrt) |
| 25-26 | Multi-step optimizer-state chain + optimizer-config constancy |

## Determinism scope

Contractual on Node 22.x × {ubuntu, macos, windows} × backprop-trace 0.10.x: byte-equal goldens (Mazur, XOR, iris, softmax+CE, multi-step, batched, external sidecars); the Mazur anchor `post_update_loss.total = 0.29102777369359933`; per-rule reconciliation within `atol=1e-12`, `rtol=1e-9` for engine-authored.

NOT contractual: cross-engine (Bun, Deno, browsers); cross-Node-major (24.x+); arbitrary V8 minor bumps. A `Math.exp(-0.5)` canary fires on every CI cell as a V8 fdlibm drift siren.

## What's not in this version (yet)

backprop-trace v0.10.3 is mid-v0. The engine, reconciler, canonical-emission contract, external ingestion path, and PyTorch live helper are real and stable. v1.0 requires these to close:

- **Heterogeneous multi-framework traces** — single-framework bundles only; mixed-framework streams not supported. *May stay out of scope.*
- **Producer-identity binding on multi-step traces** — Rule 17 catches bundle-integrity failures, not producer authenticity. Combine with Rule 16 / Sigstore / out-of-band attestation. Operator surface, not a built-in.
- **SGD coupled-L2 weight decay** — Rule 7 third branch; *v0.11.*
- **AMSGrad / NAdam / RAdam / Lion / per-parameter groups / LR schedules / gradient clipping / mixed precision** — *v0.10+.*
- **Per-sample gradients in batched receipts** — reduced gradients only today; per-sample decomposition useful for influence audits. *v0.10.x / v0.11.*
- **Heterogeneous batch sizes across steps** — fixed batch_size per stream. *May stay out of scope.*
- **JAX / TensorFlow live helpers** — hand-authored sidecars work; live helpers are *v0.11 (JAX, adopter-pull triggered) / v0.12+ (TF).*
- **Real-world fixture** — Mazur 2-2-2 + softmax+CE + sgd_momentum-Mazur are the heroes; small CNN / transformer-block fixture is *v0.11.*
- **Adopter validation** — no external researcher case study, no course adoption, no compliance bundle in the wild. *v0.12 before v1.0.*
- **GPU determinism** — out of scope and likely permanent (cuDNN ConvolutionBackwardFilter atomics defeat bit-exactness per [CMU SEI](https://www.sei.cmu.edu/blog/the-myth-of-machine-learning-reproducibility-and-randomness-for-acquisitions-and-testing-evaluation-verification-and-validation/)). The product position is the deterministic CPU corner.

If your workflow depends on any of these, this isn't the right version for you yet.

## Author a custom topology

```bash
bp scaffold topology --topology xor --out my-net.input.json
# edit my-net.input.json
bp validate-input my-net.input.json
bp generate from-config my-net.input.json --out my-net.golden.jsonl
bp verify general my-net.golden.jsonl
```

See [`docs/authoring.md`](./docs/authoring.md) — input vs receipt schemas, canonical-emission trust boundary.

## Where this fits

- **Reproducibility-first paper authors** (NeurIPS/ICML/CoLLAs; [REFORMS](https://www.science.org/doi/10.1126/sciadv.adk3452)-aware) — re-derivable per-step evidence the reviewer runs in 30 seconds.
- **ML pedagogy** (Karpathy zero-to-hero, university DL courses, interview prep) — a single named training step with every factor visible and a reconciler that *rejects* deliberately-broken fixtures.
- **ML framework / compiler engineers** (PyTorch / JAX / MLIR / XLA contributors) — known-good per-op trace for differential testing.
- **ML compliance / audit engineers** ([EU AI Act Article 10](https://artificialintelligenceact.eu/annex/4/); SLSA-for-ML) — per-step receipt below model-signing, attached to a model card or audit bundle.

## The law stack

From `docs/canonical-emission.md`:

> Contract precedes engine. Formatter policy precedes runtime formatting. Bad receipts precede good receipts. Runtime formatting precedes Mazur. Mazur precedes diagnostics.

## Links

- [`docs/quickstart.md`](./docs/quickstart.md) — five-minute walk-through
- [`docs/cli.md`](./docs/cli.md) — `bp` subcommand reference
- [`docs/live-helpers.md`](./docs/live-helpers.md) — v0.10 live PyTorch helper: workflow, trust boundary, adversarial catalog, no-pip rationale
- [`docs/authoring.md`](./docs/authoring.md) — author a custom topology
- [`docs/reconciliation.md`](./docs/reconciliation.md) — the 26 reconciler rules in full
- [`docs/topology.md`](./docs/topology.md) — general-topology authoring
- [`docs/multi-step.md`](./docs/multi-step.md) — multi-step training receipts
- [`docs/canonical-emission.md`](./docs/canonical-emission.md) — byte-level encoding contract
- [`docs/computation-order.md`](./docs/computation-order.md) — IEEE 754 ordering; FMA prohibition; determinism boundary
- [`docs/schema.md`](./docs/schema.md) — field-by-field schema walk-through
- [`docs/attestation.md`](./docs/attestation.md) — in-toto v1 attestation seam
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — anti-circularity ratchet; bad-receipts-precede-good doctrine
- [`SECURITY.md`](./SECURITY.md) — what counts as a vulnerability for a verifier
- [`CHANGELOG.md`](./CHANGELOG.md) — version-by-version history

## License

MIT — see [LICENSE](./LICENSE).

<sub>Built by <a href="https://mcp-tool-shop.github.io/">MCP Tool Shop</a></sub>
