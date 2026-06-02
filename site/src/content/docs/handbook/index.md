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

- New here? Read **[Getting Started](./getting-started/)** — install, verify the Mazur fixture, reject a broken one.
- Want to verify your own training trace? Read **[Usage](./usage/)** — the live PyTorch helper workflow, sidecar import, multi-step verification.
- Need the CLI / library reference? Read **[Reference](./reference/)** — every `bp` verb, every public export, every flag.
- Curious about the system shape? Read **[Architecture](./architecture/)** — engine, reconciler, schemas, importer, helper, trust boundary.
- Trust model questions? Read **[Security & trust boundary](./security/)** — what the verifier actually proves vs. what it doesn't.

## Status

**v0.12.0 — soundness-hardening release**, still mid-v0. CPU-only. The 26-rule reconciler, canonical-emission contract, external ingestion path, and PyTorch live helper are real and stable.

v0.12.0 follows a comprehensive adversarial audit that found five classes of **false-PASS** — the worst defect a verifier can have, where it *accepts* a receipt it should reject. All five are closed:

1. **Receipt-controlled tolerance** — a receipt could name its own tolerance and widen it until every numeric rule passed. Tolerance ceilings are now **verifier-owned**, clamped before any rule runs (engine `{atol 1e-8, rtol 1e-6}`, observer `{atol 1e-5, rtol 1e-3}`, differential `{atol 1e-5, rtol 1e-3}`), with schema maximums as defense-in-depth.
2. **Rule 14 bypass by relabeling** — the only math gate on imported traces could be skipped by stripping/renaming the authoring-state field. It now triggers on **observer-marker presence** (`source_framework` / `import_provenance`).
3. **Multi-step self-skip** — `bp verify multi` accepted a trace that declared its own math gate skipped. A self-declared skip is now a **NON-PASS on every path**.
4. **Rule 14 completeness** — it verified agreement on present fields but not coverage. It now asserts the update set covers **every engine-updated parameter** and `parameters_after` matches the declared topology.
5. **Unknown optimizers** — an unrecognized optimizer name silently skipped the update-equation rules. It is now a **Rule 0 structural reject**.

Proactively, v0.12.0 adds verifier-owned resource caps (`MAX_BATCH_SAMPLES`, `TOPOLOGY_SIZE_CEILING`) that turn OOM/hang inputs into an actionable "limit exceeded" message, graceful large-input handling (`ERR_STRING_TOO_LONG` → structured error, no raw stacks), and fixes two false-FAILs (float32 observer receipts; per-neuron biases in the live helper, now torch-validated end-to-end). **792 tests** pass (up from 502), deterministic across the CI matrix; **12 trust invariants** hold with non-vacuous tests. See [Security & trust boundary](./security/) for the invariants and the documented residual tolerance windows.

Not v1.0 yet — see the [README's "What's not in this version (yet)" section](https://github.com/mcp-tool-shop-org/backprop-trace#whats-not-in-this-version-yet) for the gaps that block promotion. The verifier surface is strong; the distribution surface ships correctly (pack-install smoke is CI-gated across ubuntu + macos + windows); the live helper covers the same optimizer matrix the verifier supports. v1.0 is gated on a real-world hero fixture (a tiny conv→ReLU→dense net, byte-reproducible on CPU) and external adopter validation.

**Study-verified roadmap:** v0.13 — SGD coupled-L2 weight decay (the documented "Rule 7 third branch"). v0.14 — NAdam (+ optionally RAdam) and LR-schedule verification. v1.0 (gated) — the real-world hero fixture, adopter validation, and a JAX live helper (`jax.make_jaxpr(grad)` is a stronger trust boundary than PyTorch eager). Later, each gated on a receipt/reconciler extension: AMSGrad, global-norm gradient clipping, per-group LRs, Lion. **Permanent scope:** GPU/fused-kernel bit-determinism is out (FP non-associativity, [arXiv:2408.05148](https://arxiv.org/abs/2408.05148)) — the product is the deterministic CPU corner.

`pnpm add @mcptoolshop/backprop-trace` or `npm install @mcptoolshop/backprop-trace` — released to npm as v0.12.0.
