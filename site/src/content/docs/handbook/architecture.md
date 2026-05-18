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
   real PyTorch step  ──────▶ │   Live PyTorch helper       │ ─▶ framework-trace.v0.7.0
   (user's training loop)      │  scripts/extract/pytorch.py │     sidecar (+ helper block)
                              │  TraceDumper context        │
                              │  manager                    │
                              └─────────────────────────────┘
```

## The engine

`runMazurStep` (and the generalized `runGeneralStep` / batched `runBatchedGeneralStep`) is a pure function: same input ⇒ same canonical bytes, every time. It does the actual numerical computation — forward, loss, backward (per the topology's activation derivatives), optimizer update (per the optimizer config), parameter step. The output is a structured object with all 26 rules' worth of intermediate evidence.

The engine is the canonical reference. When the importer ingests a foreign sidecar, it runs the engine on the same named factors and compares — that's Rule 14. When the verifier runs `bp verify mazur`, it runs the engine and asserts byte equality against the committed golden — that's the byte-equal gate.

**Determinism scope**: bit-equal on Node 22.x (V8 fdlibm `Math.exp` is load-bearing). Cross-engine (Bun, Deno, browsers) and cross-Node-major (24.x+) are out of contract — different `Math.exp` ports produce different last-place bits. See [`docs/computation-order.md`](https://github.com/mcp-tool-shop-org/backprop-trace/blob/main/docs/computation-order.md). A `Math.exp(-0.5)` canary fires on every CI cell as the early-warning siren for V8 fdlibm drift.

## The reconciler

26 rules organized into per-receipt math (1-8), multi-step (9-10), schema-gated extensions (11-13, 18-19), engine-recompute differential (14), trust-related gates (15-17), Adam-family (20, 22-26), and SGD-momentum-family (20, 21, 25, 26). Each rule has a closed-form numerical expression — the rule re-derives the receipt's claimed value from the named factors, compares within hybrid tolerance (`atol + rtol`, symmetric max form), records {ok | failure} with the rule name + field path + numeric quartet (stored / recomputed / delta / tolerance).

The reconciler is **pure** (no I/O) and **anti-circular** (does not read `fixture_status` / `authoring_state` / `verification_state` to decide whether to reject — those are operator-facing lifecycle metadata, NOT verifier authority). The verifier rejects on math, not on labels. This is the Csmith/CompCert ratchet enforced in code.

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
6. Compare engine output to foreign claims field-by-field within `differential_tolerance` (default `{atol: 1e-6, rtol: 1e-4}` — looser than engine-authored to absorb foreign FP drift per the v0.6 study)
7. Build the observer-mode receipt: foreign claims as canonical fields + `attestor` + `source_framework` + `fixture_status` (with `verification_state` reflecting the differential outcome)
8. Emit canonical bytes via `emitGeneralReceipt`

The receipt is always produced — even when Rule 14 disagrees at import time — so the operator can persist it for audit. `verification_state` records the outcome; downstream `bp verify` re-runs Rule 14 independently as the actual gate (Reproducible Builds discipline: producer's claim is not the verifier's truth).

## The live PyTorch helper

`scripts/extract/pytorch.py` is a single auditable file. It is an **observer**: snapshots model parameters before + after the user's training step, snapshots optimizer state, computes a forward pass on the pre-state for the receipt's forward / loss / backward sections, emits one `framework-trace.v0.7.0` sidecar per step.

Three load-bearing details:

1. **`.detach().clone()` snapshot discipline** — `.detach()` alone returns a storage-sharing view; the next `optimizer.step()` mutates the snapshot in place. `.detach().clone()` severs both autograd and storage. (Per Adam Paszke's PyTorch forum thread + Elana Simon's 2025 post-mortem.)
2. **`optimizer.param_groups` walk order, NEVER `optimizer.state` iteration** — PyTorch keys `state` by `id(param)`; iterating it is non-deterministic across reorders. Walking `param_groups → params` is the canonical order. (Per PyTorch issue #1489.)
3. **`momentum_buffer` sign flip** — PyTorch's `momentum_buffer` lives in ascent space (PyTorch applies `param.add_(d_p, alpha=-lr)`, so `buf` accumulates `+grad`). backprop-trace's `MomentumState.buffer` lives in descent space. The helper flips ONCE at the extraction boundary: `buf_descent = -buf`. Do NOT flip gradient. (Per PyTorch issue #1099.)

**The helper has no verdict vocabulary.** No field named `rule14_passed` / `verification_passed` / `expected_outcome` / `differential_passed`. The schema's `additionalProperties: false` enforces this — the helper would fail validation if it tried. Rule 14 owns the verdict; the helper has no business predicting it.

## Distribution integrity (v0.10.2+)

`scripts/pack-install-smoke.mjs` runs on every push across ubuntu + macos + windows. Six steps: pnpm pack → tarball size ceiling (10 MB) → tarball content listing (in-process gunzip + manual tar header walk; cross-platform) → cold install into `mkdtemp` via `npm install <abs-tarball>` → CLI smoke matrix on the installed `bp` → pipe smoke (`verify multi -` via stdin + file roundtrip).

Caught real bugs during development: helper version drift from package version (forensic attribution ambiguity), `bp verify mazur` reading bundled fixtures via cwd-relative paths (worked from repo root, broke in installed package), CI workflow running `pnpm test` before `pnpm build` (CLI tests couldn't find dist/bin/bp.js). All fixed; smoke now enforces.

## Trust boundary statement (load-bearing)

The helper, the engine, and the reconciler are three separate authorities:

- **Helper** — observer; extracts named factors. NEVER a verifier.
- **Engine** — independent recomputer; takes named factors, produces all 26 rules' evidence.
- **Reconciler** — judge; compares stored vs. recomputed, rejects on disagreement.

The helper has no vocabulary to predict the verdict. The engine doesn't read the receipt's claims (it takes only the input factors). The reconciler doesn't trust producer metadata. Each layer's role is locked.

This is what makes the Fang et al. 2023 PoL spoofing class inapplicable to backprop-trace receipts: an attacker who controls every byte of the sidecar cannot construct a self-consistent (g, m, v, update) quadruple that the engine ALSO produces — the engine doesn't read the sidecar's claims. The helper's `source_hash` is forensic, not credential; spoofing it doesn't bypass Rule 14.

See [Security & trust boundary](../security/) for the full statement with citations.

## Next steps

- **Security + trust model in depth** → [Security](../security/)
- **Browse the CLI + library surface** → [Reference](../reference/)
