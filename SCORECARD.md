# Scorecard — backprop-trace

**Repo:** mcp-tool-shop-org/backprop-trace
**Release:** v1.0.0
**Date:** 2026-06-23
**Type tags:** `[all]` `[npm]` `[cli]`
**Gate result:** hard gates A–D ✅ CLOSED **and** the two v1.0.0 product-completeness gaps now closed (real-world hero fixture + adopter-validation compliance bundle) — **v1.0.0 promotion earned.** 940 deterministic tests.

> The live, item-by-item gate artifact is **[`SHIP_GATE.md`](./SHIP_GATE.md)**.
> This scorecard is the at-a-glance roll-up; `SHIP_GATE.md` is authoritative
> when the two disagree.

## v1.0.0 in one line

The sober v1.0.0 promotion after a comprehensive dogfood swarm: it hardens
soundness further (the Rule 0.9 forward-completeness false-PASS, per-sample
Rule 14 completeness, emit/hash integrity), adds an auditable rule-coverage
layer, and ships the four v1.0 product-completeness items — SGD coupled-L2
weight decay, a recognizable hero fixture, a real-JAX live helper, and a worked
compliance bundle. CPU-only; 26 reconciler rules; SGD / Adam / AdamW /
SGD-momentum (+ coupled-L2 weight decay); live PyTorch **and** JAX helpers
(Rule 14 is the authority on every import); 940 deterministic tests.

## Hard-gate roll-up (from SHIP_GATE.md)

| Gate | Result | Notes |
|------|--------|-------|
| A. Security | ✅ CLOSED | SECURITY.md content-rich; explicit README threat model; zero telemetry / zero secrets; v0.12.0 adds tolerance-gaming + provenance-laundering as named in-scope classes. |
| B. Error handling | ✅ CLOSED | Tier-1 structured error envelope (`code`/`message`/`hint`); documented 4-bucket exit codes; no raw stacks. |
| C. Operator docs | ✅ CLOSED | README + docs current to the 26-rule v0.12.0 surface; CHANGELOG + LICENSE present; `--help` accurate. Silent/debug logging flags `SKIP` (deferred to v1.0.x; `--verbose` covers the diagnostic need). |
| D. Shipping hygiene | ✅ CLOSED | `verify` script; pinned `engines.node` + `.nvmrc`; committed lockfile; CI dep scanning; pack/install smoke gate. Version-matches-tag clears at the `v1.0.0` tag. |
| E. Identity (soft) | ✅ (no block) | Logo, 8-language translations, landing page + Starlight handbook, GitHub metadata all present. |

## What v1.0.0 closed (the product-completeness gaps)

The two gaps that kept backprop-trace honestly mid-v0 are now closed:

1. **Real-world hero fixture** ✅ — `fixtures/hero-classifier.golden.jsonl`, a
   recognizable 9-pixel → 16-ReLU → 4-class softmax glyph classifier,
   byte-reproducible on CPU. (Conv stays out of the deterministic-CPU corner.)
2. **Adopter validation** ✅ — [`docs/compliance.md`](./docs/compliance.md), a
   worked compliance-audit-bundle (the gate's accepted substantive-internal use
   case), mapped honestly to EU AI Act Annex IV §2(g) + Article 15.

See [`SHIP_GATE.md`](./SHIP_GATE.md#product-completeness-gaps-blocking-v100)
for the per-gap detail, and the README's
[What's not in this version (yet)](./README.md#whats-not-in-this-version-yet)
roadmap for what remains deliberately out of scope.

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
