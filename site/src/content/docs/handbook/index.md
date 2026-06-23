---
title: backprop-trace
description: Deterministic 26-rule verifier for neural-network training steps. The handbook.
sidebar:
  order: 0
---

`backprop-trace` is a deterministic structural-trace verifier for neural-network training steps. You hand it a receipt naming every factor that contributed to one gradient update; a 26-rule reconciler re-derives every claim from the named factors and rejects on disagreement.

It exists because reproducibility-first ML research, ML pedagogy, ML framework engineering, and ML compliance all need the same thing: **per-step structural evidence a third party can re-derive in 30 seconds**. Experiment trackers log what the trainer says happened; backprop-trace recomputes whether the math is internally consistent. Proof-of-Learning is forgeable on real training ([Fang et al. EuroS&P 2023](https://arxiv.org/abs/2208.03567)); zkML produces cryptographic proofs at a different cost point. backprop-trace fills the deterministic-CPU corner: per-step, single-receipt, audience-is-a-human-or-CI-reviewer.

The doctrinal anchor is [Csmith (Yang/Chen/Eide/Regehr, PLDI 2011)](https://users.cs.utah.edu/~regehr/papers/pldi11-preprint.pdf) and [CompCert (Leroy, CACM 2009)](https://xavierleroy.org/publi/compcert-CACM.pdf): adversarial corpora prove a verifier, passing tests do not. Every reconciler rule ships with a deliberately-broken fixture in `fixtures/bad/` that the verifier must reject *before* reading any `fixture_status` lifecycle metadata. The oracle must not consult the artifact it judges.

## Where to start

- New here? Read **[Getting Started](./getting-started/)** — install, verify the Mazur fixture and the hero classifier, reject a broken one.
- Want to verify your own training trace? Read **[Usage](./usage/)** — the live PyTorch and JAX helper workflows, sidecar import, multi-step verification.
- Need the CLI / library reference? Read **[Reference](./reference/)** — every `bp` verb, every public export, every flag.
- Curious about the system shape? Read **[Architecture](./architecture/)** — engine, reconciler, schemas, importer, the live helpers, trust boundary.
- Trust model questions? Read **[Security & trust boundary](./security/)** — what the verifier actually proves vs. what it doesn't, plus the honestly-scoped compliance bundle.

## Status

**v1.0.0 — the sober promotion.** CPU-only, deterministic. A comprehensive dogfood swarm took backprop-trace from honest mid-v0 to a v1.0.0 that meets the product's own gate criteria. The 26-rule reconciler, canonical-emission contract, external ingestion path, and the live PyTorch **and** JAX helpers are real and stable. **940 tests** pass (up from 792), deterministic across the CI matrix.

v1.0.0 cleared the gate criteria that defined the v0.x ceiling:

1. **SGD coupled-L2 weight decay** — the documented "Rule 7 third branch", for plain SGD and SGD-momentum (classical / Nesterov / dampening). Coupled, not decoupled — the decay folds into the gradient and enters the momentum buffer, the deliberate opposite of AdamW. New additive schemas `receipt.v0.8.0` + `framework-trace.v0.8.0`; math cross-family-verified and validated against real PyTorch.
2. **A recognizable hero fixture** — `fixtures/hero-classifier.golden.jsonl`, a 9-pixel → 16-ReLU → 4-class softmax glyph classifier (single + multi-step), byte-reproducible on CPU. A receipt a reader can picture, not just a 2-2-2 toy.
3. **A live JAX helper** — `scripts/extract/jax.py`, with a stronger trust boundary than PyTorch eager: it folds a `jax.make_jaxpr(jax.grad(loss))` digest into the forensic block (the inspectable gradient graph PyTorch eager lacks), and refuses to run without `jax_enable_x64` + CPU. A dedicated CI `jax-e2e` job validates it against real JAX.
4. **A compliance audit bundle** ([docs/compliance.md](https://github.com/mcp-tool-shop-org/backprop-trace/blob/main/docs/compliance.md)) — a worked mapping of a receipt to EU AI Act Annex IV §2(g)/§2(b) test-log records and Article 15 robustness controls (honestly *not* Article 10), composing below SLSA-for-ML / Sigstore.
5. **Rule-coverage observability** — `bp verify --json` / `--verbose` now report which of the 26 rules a PASS actually exercised (`rules_evaluated`) and which were applicable-but-gated-off (`gated_off`). An auditable PASS, not a silent one.

v1.0.0 also closed two further false-PASS classes on top of the [v0.12.0 soundness hardening](#the-v0120-soundness-floor): **Rule 0.9 (forward-map completeness)** — a softmax receipt could reconcile `ok:true` while its probabilities did not sum to 1.0; and a deeper **Rule 14 completeness** check across `post_update_forward` / `post_update_loss` and the batched per-sample maps, closing selective-omission laundering. **12 trust invariants** hold with non-vacuous tests. See [Security & trust boundary](./security/) for the invariants and the documented residual tolerance windows.

### The v0.12.0 soundness floor

v1.0.0 inherits the five false-PASS holes closed by the v0.12.0 adversarial audit — the worst defect a verifier can have, where it *accepts* a receipt it should reject:

1. **Receipt-controlled tolerance** — a receipt could name its own tolerance and widen it until every numeric rule passed. Tolerance ceilings are **verifier-owned**, clamped before any rule runs (engine `{atol 1e-8, rtol 1e-6}`, observer `{atol 1e-5, rtol 1e-3}`, differential `{atol 1e-5, rtol 1e-3}`), with schema maximums as defense-in-depth.
2. **Rule 14 bypass by relabeling** — the only math gate on imported traces could be skipped by stripping/renaming the authoring-state field. It triggers on **observer-marker presence** (`source_framework` / `import_provenance`).
3. **Multi-step self-skip** — `bp verify multi` accepted a trace that declared its own math gate skipped. A self-declared skip is a **NON-PASS on every path**.
4. **Rule 14 completeness** — it verified agreement on present fields but not coverage. It asserts the update set covers **every engine-updated parameter** and `parameters_after` matches the declared topology.
5. **Unknown optimizers** — an unrecognized optimizer name silently skipped the update-equation rules. It is a **Rule 0 structural reject**.

Verifier-owned resource caps (`MAX_BATCH_SAMPLES`, `TOPOLOGY_SIZE_CEILING`) turn OOM/hang inputs into an actionable "limit exceeded" message; oversized files return a structured `INPUT_TOO_LARGE` error, never a raw stack.

**What's deliberately not yet covered:** NAdam (+ optionally RAdam) then LR-schedule verification; AMSGrad / global-norm gradient clipping / per-group LRs / Lion, each gated on a receipt/reconciler extension; conv / multi-hidden-layer topologies (they fight bit-determinism). **Permanent scope:** GPU/fused-kernel bit-determinism is out (FP non-associativity, [arXiv:2408.05148](https://arxiv.org/abs/2408.05148)) — the product is the deterministic CPU corner. See the [README's "What's not in this version (yet)" section](https://github.com/mcp-tool-shop-org/backprop-trace#whats-not-in-this-version-yet) for the full roadmap.

`pnpm add @mcptoolshop/backprop-trace` or `npm install @mcptoolshop/backprop-trace` — released to npm as v1.0.0.
