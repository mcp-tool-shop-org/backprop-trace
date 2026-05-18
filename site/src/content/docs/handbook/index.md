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

**Mid-v0 (v0.10.3)**. CPU-only. The 26-rule reconciler, canonical-emission contract, external ingestion path, and PyTorch live helper are real and stable.

Not v1.0 yet — see the [README's "What's not in this version (yet)" section](https://github.com/mcp-tool-shop-org/backprop-trace#whats-not-in-this-version-yet) for the gaps that block promotion. The verifier surface is strong; the distribution surface now ships correctly (pack-install smoke is CI-gated across ubuntu + macos + windows); the live helper covers the same optimizer matrix the verifier supports. What's missing is adopter validation, a real-world (CNN / transformer) fixture, multi-framework live helpers, and SGD coupled-L2 weight decay.

No tag. No npm publish. No GitHub release. We will revisit publishing when those gaps close.
