---
title: Architecture
description: Engine + reconciler + schemas + importer + live helper + trust boundary — how the parts fit.
sidebar:
  order: 5
---

backprop-trace is six interlocking layers:

```
                              ┌─────────────────────────────┐
   topology+input config  ──▶ │        Engine               │ ─▶ canonical JSONL receipt
   (schemas/topology-           │  runMazurStep              │
    input.v0.4.0.json)          │  runGeneralStep            │
                              │  runBatchedGeneralStep      │
                              └──────────┬──────────────────┘
                                         │
                                         ▼
                              ┌─────────────────────────────┐
   framework sidecar  ──────▶ │        Importer             │ ─▶ observer-mode receipt
   (schemas/framework-          │  importPytorchSidecar      │     + Rule 14 differential
    trace.v0.{1..7}.0.json)     │  importJaxSidecar          │
                              │  importTensorflowSidecar    │
                              └──────────┬──────────────────┘
                                         │
                                         ▼
                              ┌─────────────────────────────┐
   any receipt        ──────▶ │       Reconciler            │ ─▶ {ok, failures[]}
   (schemas/receipt.            │  26 rules                  │
    v0.{1..7}.0.json)           │  hybrid tolerance          │
                              └─────────────────────────────┘
                                         ▲
                                         │
                              ┌─────────────────────────────┐
   real PyTorch / JAX step ─▶ │   Live helpers              │ ─▶ framework-trace sidecar
   (user's training loop)      │  scripts/extract/pytorch.py │     (+ forensic helper block)
                              │  scripts/extract/jax.py     │
                              │  TraceDumper context manager│
                              └─────────────────────────────┘
```

## The engine

`runMazurStep` (and the generalized `runGeneralStep` / batched `runBatchedGeneralStep`) is a pure function: same input ⇒ same canonical bytes, every time. It does the actual numerical computation — forward, loss, backward (per the topology's activation derivatives), optimizer update (per the optimizer config), parameter step. The output is a structured object with all 26 rules' worth of intermediate evidence.

The engine is the canonical reference. When the importer ingests a foreign sidecar, it runs the engine on the same named factors and compares — that's Rule 14. When the verifier runs `bp verify mazur`, it runs the engine and asserts byte equality against the committed golden — that's the byte-equal gate.

**Determinism scope**: bit-equal on Node 22.x (V8 fdlibm `Math.exp` is load-bearing). Cross-engine (Bun, Deno, browsers) and cross-Node-major (24.x+) are out of contract — different `Math.exp` ports produce different last-place bits. See [`docs/computation-order.md`](https://github.com/mcp-tool-shop-org/backprop-trace/blob/main/docs/computation-order.md). A `Math.exp(-0.5)` canary fires on every CI cell as the early-warning siren for V8 fdlibm drift.

## The reconciler

26 rules organized into per-receipt math (1-8), multi-step (9-10), schema-gated extensions (11-13, 18-19), engine-recompute differential (14), trust-related gates (15-17), Adam-family (20, 22-26), and SGD-momentum-family (20, 21, 25, 26). Each rule has a closed-form numerical expression — the rule re-derives the receipt's claimed value from the named factors, compares within hybrid tolerance (`atol + rtol`, symmetric max form), records {ok | failure} with the rule name + field path + numeric quartet (stored / recomputed / delta / tolerance).

Rule 7 (final-state consistency) carries three optimizer branches: the plain `weight_before + update` (SGD/Adam), the AdamW decoupled-decay `(1 - lr*wd) * weight_before + update`, and — new in v1.0.0 — **SGD coupled-L2 weight decay**, where the decay is *coupled*: it folds into the gradient and enters the momentum buffer before the update, the deliberate opposite of AdamW. The v0.8.0 schemas carry the coupled-L2 surface additively; the engine recomputes the coupled path closed-form on CPU.

A green PASS is **auditable** (v1.0.0): the reconciler reports `rules_evaluated` (which of the 26 rules actually fired) and `gated_off` (applicable-but-skipped because a feature block was absent). `bp verify --json` carries both arrays; `--verbose` renders a coverage line. A reader can distinguish "11 substantive rules ran" from "all 26 ran" rather than trusting a bare `ok: true`.

The reconciler is **pure** (no I/O), **anti-circular** (does not read `fixture_status` / `authoring_state` / `verification_state` to decide whether to reject — those are operator-facing lifecycle metadata, NOT verifier authority), and **never throws** — it always returns a structured `{ok, failures[]}` result, even on malformed input, so callers never have to wrap it in try/catch. The verifier rejects on math, not on labels. This is the Csmith/CompCert ratchet enforced in code.

### The tolerance-ceiling model (v0.12.0)

A receipt declares a comparison tolerance (`attestor.differential_tolerance`), but **the verifier owns the ceiling**. Before any rule runs, the reconciler clamps the requested tolerance to a fixed, code-defined maximum — a receipt can tighten its tolerance but can never loosen it past the floor. This closes the worst hole an adversarial-audit found: a receipt naming a giant tolerance to wave its own numeric errors through.

Three ceilings, one per comparison path:

| Path | Constant | Ceiling |
|---|---|---|
| Engine-authored numeric rules | `NUMERIC_TOLERANCE_CEILING` | `{atol: 1e-8, rtol: 1e-6}` |
| Observer-mode numeric rules | `OBSERVER_NUMERIC_TOLERANCE_CEILING` | `{atol: 1e-5, rtol: 1e-3}` |
| Rule 14 differential | `DIFFERENTIAL_TOLERANCE_CEILING` | `{atol: 1e-5, rtol: 1e-3}` |

The observer / differential ceilings are looser than the engine ceiling because foreign frameworks (and float32 sidecars) carry legitimate last-place FP drift the engine-authored path doesn't. The schema's `differential_tolerance` maximums act as a second line of defense, but the clamp is the authority — schema validation alone is not trusted to bound the numeric gate. See [Security](../security/) for the residual-tolerance-window discussion.

## The schemas

Three families, versioned independently:

- **receipt.v0.{1..7}.0.json** — what the engine + importer produce; what `bp verify` consumes. Closed (additionalProperties: false), x-order-annotated, additive across versions. Forced bumps when a closed enum / closed shape widens (every closed-const widening since v0.4.0 has forced a bump).
- **topology-input.v0.4.0.json** — what `bp generate from-config` consumes. Validates the INPUT shape before the engine runs. Prohibits receipt-only fields (forward, loss, updates, parameters_after) via additionalProperties: false. Trust-boundary preservation pinned in the v0.4 consolidator memo.
- **framework-trace.v0.{1..7}.0.json** — what `bp import {pytorch,jax,tensorflow}` consumes. Foreign-framework sidecar shape. v0.7.0 adds the live-helper `helper` block (forensic, not credential).

`docs/schema.md` documents every forced bump's rationale.

## The importer

`importPytorchSidecar` (etc.) is a thin wrapper over the shared `buildObserverReceiptFromSidecar` core. Steps:

1. Hash raw sidecar bytes for `attestor.import_provenance.source_hash` BEFORE parsing
2. JSON.parse the sidecar bytes
3. Validate against the matching framework-trace.v0.X.0 schema (dispatch on the `format` const)
4. Assert `sidecar.source_framework.name` matches the calling importer (per-framework subcommand discipline)
5. Run `runGeneralStep` from the sidecar's inputs as the differential witness
6. Compare engine output to foreign claims field-by-field within `differential_tolerance` (default `{atol: 1e-6, rtol: 1e-4}` — looser than engine-authored to absorb foreign FP drift per the v0.6 study), clamped to `DIFFERENTIAL_TOLERANCE_CEILING` (`{atol: 1e-5, rtol: 1e-3}`) so a sidecar can't request an unbounded pass band. The comparison also accounts for float32 inputs (a v0.12.0 fix — single-precision sidecars were previously false-FAILing against a double-precision tolerance)
7. Build the observer-mode receipt: foreign claims as canonical fields + `attestor` + `source_framework` + `fixture_status` (with `verification_state` reflecting the differential outcome)
8. Emit canonical bytes via `emitGeneralReceipt`

The receipt is always produced — even when Rule 14 disagrees at import time — so the operator can persist it for audit. `verification_state` records the outcome; downstream `bp verify` re-runs Rule 14 independently as the actual gate (Reproducible Builds discipline: producer's claim is not the verifier's truth).

**Rule 14 is marker-gated (v0.12.0).** The reconciler decides whether to run Rule 14 on the presence of **observer markers** — `source_framework` (the foreign producer's identity) or `attestor.import_provenance` (the import seam) — NOT on the `authoring_state` enum. A receipt carrying either marker is, by construction, an import, so stripping or relabeling `authoring_state` no longer lets it dodge re-derivation. Rule 14 also checks **completeness**, not just agreement: it asserts the update set covers every engine-updated parameter and that `parameters_after` equals `topology.parameter_order` — a sidecar can no longer pass by omitting the parameters it got wrong.

## The live PyTorch helper

`scripts/extract/pytorch.py` is a single auditable file. It is an **observer**: snapshots model parameters before + after the user's training step, snapshots optimizer state, computes a forward pass on the pre-state for the receipt's forward / loss / backward sections, emits one `framework-trace.v0.7.0` sidecar per step.

Three load-bearing details:

1. **`.detach().clone()` snapshot discipline** — `.detach()` alone returns a storage-sharing view; the next `optimizer.step()` mutates the snapshot in place. `.detach().clone()` severs both autograd and storage. (Per Adam Paszke's PyTorch forum thread + Elana Simon's 2025 post-mortem.)
2. **`optimizer.param_groups` walk order, NEVER `optimizer.state` iteration** — PyTorch keys `state` by `id(param)`; iterating it is non-deterministic across reorders. Walking `param_groups → params` is the canonical order. (Per PyTorch issue #1489.)
3. **`momentum_buffer` sign flip** — PyTorch's `momentum_buffer` lives in ascent space (PyTorch applies `param.add_(d_p, alpha=-lr)`, so `buf` accumulates `+grad`). backprop-trace's `MomentumState.buffer` lives in descent space. The helper flips ONCE at the extraction boundary: `buf_descent = -buf`. Do NOT flip gradient. (Per PyTorch issue #1099.)

**The helper has no verdict vocabulary.** No field named `rule14_passed` / `verification_passed` / `expected_outcome` / `differential_passed`. The schema's `additionalProperties: false` enforces this — the helper would fail validation if it tried. Rule 14 owns the verdict; the helper has no business predicting it.

## The live JAX helper (v1.0.0)

`scripts/extract/jax.py` is the JAX sibling of the PyTorch helper — a single auditable file, same observer-not-verifier discipline, same forensic `helper` block, same Rule 14 authority. It covers SGD and Adam. Two things make it a *stronger* trust boundary than PyTorch eager:

1. **It records the gradient jaxpr.** `jax.make_jaxpr(jax.grad(loss))` captures the gradient computation graph as an inspectable, auditable artifact, and the helper folds its digest into the forensic block. PyTorch eager has no first-class equivalent — its autograd graph is reconstructed implicitly at `.backward()` time. The jaxpr is forensic like the `source_hash`: it does NOT bypass Rule 14; it makes post-hoc attribution richer.
2. **It enforces its determinism preconditions at the boundary.** The helper refuses to run on non-CPU devices (GPU/TPU FP reductions are non-associative across kernels) and refuses to run without `jax.config.update("jax_enable_x64", True)` (JAX defaults to float32; the engine runs binary64, so a forgotten x64 flip would silently produce a float32 sidecar that Rule 14 would flag as a tolerance disagreement). Failing loudly at extraction beats a confusing differential later.

A dedicated CI `jax-e2e` job validates the helper against real JAX on every relevant push, the same way `pack-install-smoke` validates distribution.

## Distribution integrity (v0.10.2+)

`scripts/pack-install-smoke.mjs` runs on every push across ubuntu + macos + windows. Six steps: pnpm pack → tarball size ceiling (10 MB) → tarball content listing (in-process gunzip + manual tar header walk; cross-platform) → cold install into `mkdtemp` via `npm install <abs-tarball>` → CLI smoke matrix on the installed `bp` → pipe smoke (`verify multi -` via stdin + file roundtrip).

Caught real bugs during development: helper version drift from package version (forensic attribution ambiguity), `bp verify mazur` reading bundled fixtures via cwd-relative paths (worked from repo root, broke in installed package), CI workflow running `pnpm test` before `pnpm build` (CLI tests couldn't find dist/bin/bp.js). All fixed; smoke now enforces.

## Trust boundary statement (load-bearing)

The live helpers (PyTorch + JAX), the engine, and the reconciler are three separate authorities:

- **Helper** — observer; extracts named factors. NEVER a verifier. Both the PyTorch and JAX helpers obey the same boundary.
- **Engine** — independent recomputer; takes named factors, produces all 26 rules' evidence.
- **Reconciler** — judge; compares stored vs. recomputed, rejects on disagreement.

The helper has no vocabulary to predict the verdict. The engine doesn't read the receipt's claims (it takes only the input factors). The reconciler doesn't trust producer metadata. Each layer's role is locked.

This is what makes the Fang et al. 2023 PoL spoofing class inapplicable to backprop-trace receipts: an attacker who controls every byte of the sidecar cannot construct a self-consistent (g, m, v, update) quadruple that the engine ALSO produces — the engine doesn't read the sidecar's claims. The helper's `source_hash` is forensic, not credential; spoofing it doesn't bypass Rule 14.

See [Security & trust boundary](../security/) for the full statement with citations.

## Next steps

- **Security + trust model in depth** → [Security](../security/)
- **Browse the CLI + library surface** → [Reference](../reference/)
