# Scorecard — backprop-trace

**Repo:** mcp-tool-shop-org/backprop-trace
**Release:** v0.12.0 (soundness-hardening)
**Date:** 2026-06-02
**Type tags:** `[all]` `[npm]` `[cli]`
**Gate result:** hard gates A–D ✅ CLOSED within the explicit v0.x scope — **NOT a v1.0.0 promotion** (two product-completeness gaps remain)

> The live, item-by-item gate artifact is **[`SHIP_GATE.md`](./SHIP_GATE.md)**.
> This scorecard is the at-a-glance roll-up; `SHIP_GATE.md` is authoritative
> when the two disagree.

## v0.12.0 in one line

A soundness-hardening release after a comprehensive dogfood-swarm audit: it
closes 5 CRITICAL false-PASS holes (a verifier accepting receipts it must
reject — the worst defect class), adds verifier-owned tolerance ceilings and
resource caps, and grows the suite 502 → 792 deterministic tests with 12
trust invariants now holding non-vacuously. CPU-only; 26 reconciler rules;
SGD / Adam / AdamW / SGD-momentum (classical + Nesterov + dampening) +
observer-mode PyTorch/JAX/TF import (Rule 14 is the authority) + a live
PyTorch helper.

## Hard-gate roll-up (from SHIP_GATE.md)

| Gate | Result | Notes |
|------|--------|-------|
| A. Security | ✅ CLOSED | SECURITY.md content-rich; explicit README threat model; zero telemetry / zero secrets; v0.12.0 adds tolerance-gaming + provenance-laundering as named in-scope classes. |
| B. Error handling | ✅ CLOSED | Tier-1 structured error envelope (`code`/`message`/`hint`); documented 4-bucket exit codes; no raw stacks. |
| C. Operator docs | ✅ CLOSED | README + docs current to the 26-rule v0.12.0 surface; CHANGELOG + LICENSE present; `--help` accurate. Silent/debug logging flags `SKIP` (deferred to v1.0.x; `--verbose` covers the diagnostic need). |
| D. Shipping hygiene | ✅ CLOSED | `verify` script; pinned `engines.node` + `.nvmrc`; committed lockfile; CI dep scanning; pack/install smoke gate. Version-matches-tag clears at the `v0.12.0` tag. |
| E. Identity (soft) | ✅ (no block) | Logo, 8-language translations, landing page + Starlight handbook, GitHub metadata all present. |

## What still blocks v1.0.0 (product-completeness, not artifact hygiene)

These are NOT shipcheck items — they are about whether the product is what a
v1.0.0 promise would imply. Most of the original gaps have shipped (multi-step
observer-mode, Adam/AdamW + SGD momentum, batching, the PyTorch live helper).
Two remain:

1. **Real-world hero fixture** — a tiny conv→ReLU→dense net, byte-reproducible
   on CPU, so cold reviewers see recognizable ML (gated to v1.0).
2. **Adopter validation** — at least one external (or substantive internal)
   use case: a researcher case study, a course adoption, or a compliance
   audit bundle (gated to v1.0).

See [`SHIP_GATE.md`](./SHIP_GATE.md#product-completeness-gaps-blocking-v100)
for the full table with per-gap rationale, and the README's
[What's not in this version (yet)](./README.md#whats-not-in-this-version-yet)
section for the cold-user-facing version.

## Study-verified roadmap (post-v0.12.0)

- **v0.13** — SGD coupled-L2 weight decay (the documented Rule 7 third branch;
  closed-form CPU recompute).
- **v0.14** — NAdam (+ optionally RAdam) as cheap Adam variants, then
  LR-schedule verification.
- **v1.0 (gated)** — the real-world hero fixture + adopter validation above,
  plus the JAX live helper (`jax.make_jaxpr(grad)` gives a stronger trust
  boundary than PyTorch eager; CPU + `jax_enable_x64` + pinned XLA).
- **Permanent scope** — GPU / fused-kernel bit-determinism is OUT (FP
  non-associativity, arXiv:2408.05148); the product is the deterministic
  CPU corner.
