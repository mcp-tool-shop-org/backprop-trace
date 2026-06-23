---
title: Security & trust boundary
description: What backprop-trace proves, what it doesn't, and why the trust layers are separate.
sidebar:
  order: 6
---

This page is the operator-facing complement to [SECURITY.md](https://github.com/mcp-tool-shop-org/backprop-trace/blob/main/SECURITY.md) (which covers disclosure timeline + severity rubric).

## What backprop-trace actually proves

When `bp verify <subject>` exits 0, you have a verifier-checked claim that:

1. The receipt's schema is well-formed (Ajv against `schemas/receipt.v0.X.0.json`)
2. Every numerical claim in the receipt is internally consistent — the named factors recompute the claimed value within a **verifier-owned** hybrid tolerance (the receipt cannot widen this; see the ceiling model below)
3. For observer-mode receipts (imported from a foreign framework via `bp import`), the engine independently recomputes the step from the sidecar's named factors and AGREES within differential tolerance (Rule 14) — and that agreement is **complete**, covering every engine-updated parameter, not just the fields the sidecar chose to present
4. For multi-step bundles, the parameter chain is intact (Rule 9) and the trace identity is consistent (Rule 10)
5. For helper-emitted sidecars, the helper's `helper` block is structurally valid — name, version, source_hash, framework info, runtime info, extraction timestamp all present and well-typed

That's all. It's a strong claim about **per-step structural consistency** under deterministic CPU.

## The trust invariants (v0.12.0)

v0.12.0 codified **12 trust invariants** — the properties a verifier must hold for its PASS verdict to mean anything. Each now has a non-vacuous test proving it (a test that would actually fail if the invariant broke, not a test that passes trivially). The load-bearing ones:

- **A receipt cannot widen its own pass band.** Comparison tolerance is clamped to a verifier-owned ceiling *before any rule runs*. A receipt may request a tighter tolerance; it can never loosen past the floor.
- **An import cannot dodge re-derivation.** Rule 14 fires on the presence of observer markers (`source_framework` / `import_provenance`), so stripping or relabeling `authoring_state` cannot turn off the only math gate on imported traces.
- **A self-declared skip is never a PASS.** A multi-step trace that announces its own math gate was skipped is treated as NON-PASS on every path — the verifier does not take the producer's word that a check can be safely skipped.
- **Agreement implies completeness.** Rule 14 asserts the update set covers every engine-updated parameter and `parameters_after == topology.parameter_order` — a sidecar cannot pass by omitting the parameters it got wrong.
- **An unrecognized optimizer is rejected, not skipped.** A name outside `{sgd, sgd_momentum, adam, adamw}` is a Rule 0 structural reject — the update-equation rules are never silently bypassed.
- **The verifier never throws on adversarial input.** `reconcileReceipt` always returns a structured result; malformed input becomes a failure record, not an exception. Oversized input becomes a structured `INPUT_TOO_LARGE` error, not a raw stack trace.
- **Oversized inputs fail cleanly, not via OOM/hang.** Verifier-owned caps (`MAX_BATCH_SAMPLES`, `TOPOLOGY_SIZE_CEILING`) reject before the engine spins up an unbounded recompute.

The full set (plus the anti-circularity, byte-equality, and per-framework-discipline invariants documented elsewhere in this handbook) is enforced by the 940-test suite (v1.0.0). v1.0.0 closed two further false-PASS classes on top of the v0.12.0 floor: **Rule 0.9 (forward-map completeness)** — a softmax receipt could reconcile `ok:true` while its probabilities did not sum to 1.0 (Rules 0.8/11/12 silently skipped a dropped forward unit); and a deeper **Rule 14 completeness** check across `post_update_forward` / `post_update_loss` and the batched per-sample maps, closing selective-omission laundering.

## The residual tolerance windows (what "within tolerance" admits)

A consistency verifier compares floating-point recomputations, so "PASS" means "agrees **within a bounded window**," not "bit-identical." Those windows are now verifier-owned ceilings — a receipt cannot widen them — but they are non-zero by necessity, and an honest threat model names them:

| Comparison path | Ceiling (`atol`, `rtol`) | Why it's non-zero |
|---|---|---|
| Engine-authored numeric rules | `1e-8`, `1e-6` | Engine recompute order vs. emitted decimal-string round-trip; tightest band. |
| Observer-mode numeric rules | `1e-5`, `1e-3` | Foreign-framework FP drift + float32 sidecars carry legitimate last-place divergence from Node binary64. |
| Rule 14 differential | `1e-5`, `1e-3` | Same: the engine (binary64) vs. a foreign producer's claimed values. |

**The residual risk:** a crafted receipt whose error is real but smaller than the ceiling would pass. The ceilings are set as tight as legitimate FP drift allows — the observer/differential band is the looser one precisely because foreign frameworks need it; engine-authored receipts get the tight `1e-8`/`1e-6` band. Tightening further would false-FAIL honest float32 imports (the v0.12.0 fix went the other way — it stopped false-FAILing them). This is the inherent floor of a deterministic-CPU consistency verifier; it is documented, not hidden. If you find a receipt that exploits a window to pass with a meaningful error, that is the in-scope vulnerability class (see "Coordinated disclosure" below).

## What backprop-trace does NOT prove

- **NOT producer authenticity.** The receipt doesn't prove WHO produced it. An attacker with byte-control over the receipt can synthesize a structurally-valid receipt that any number of bad humans never produced. Use Sigstore / cosign / an out-of-band signature for producer-identity binding. Rule 16 (`attestor.signed_subject_digest`) is the seam, but the signing layer itself is operator work, not built-in.
- **NOT bundle authenticity at the producer level.** Rule 17 catches bundle-integrity failures (splice, post-binding mutation, inconsistent bundle roots) but does NOT prove the bundle came from a specific producer. Producer-identity binding requires combining `bundle_root_digest` with Rule 16, an external signature, or an out-of-band attestation.
- **NOT training-run correctness.** The verifier proves each STEP is mathematically consistent. It says nothing about whether the loss is going down, whether the model is learning the right thing, or whether the training dataset is the one you think it is.
- **NOT model correctness.** The receipt only describes the gradient update math. The model itself could be misspecified, the loss could be wrong, the gradients could be perfectly consistent but mathematically meaningless for the task.
- **NOT side-channel security.** Timing / cache / power-analysis attacks on the verifier process are out of scope.
- **NOT cross-engine reproducibility.** Bit-equal output is guaranteed only on Node 22.x + the same backprop-trace version + the same canonical-emission spec version. Cross-engine (Bun, Deno, browsers) and cross-Node-major (24.x+) are non-goals.
- **NOT GPU reproducibility.** cuDNN ConvolutionBackwardFilter atomics defeat bit-exactness across runs even on identical hardware (per [CMU SEI](https://www.sei.cmu.edu/blog/the-myth-of-machine-learning-reproducibility-and-randomness-for-acquisitions-and-testing-evaluation-verification-and-validation/)). The product position is the deterministic CPU corner.

## Why the trust layers are separate (the Csmith/CompCert ratchet)

The doctrinal anchor is [Csmith (Yang/Chen/Eide/Regehr, PLDI 2011)](https://doi.org/10.1145/1993498.1993532) and [CompCert (Leroy, CACM 2009)](https://doi.org/10.1145/1538788.1538814): **the oracle must not consult the artifact it judges**. Csmith's oracle is majority-voted differential testing across compilers, never the compiler-under-test's own output. CompCert's verifier is a separate Coq-checked simulation relation, never the compiler's claim about itself.

backprop-trace applies this in three places:

1. **The reconciler does not read `fixture_status` to decide whether to reject** — the receipt's lifecycle metadata (authoring_state, verification_state, canonical) is operator-facing only. Reading it as gate logic would let an attacker bypass the verifier by mutating one metadata field. Every bad fixture must be reject-by-math. v0.12.0 closed the last seam here: Rule 14 used to *gate* on `authoring_state === "external_imported"`, so stripping that field disabled the import math gate. It now gates on the presence of observer markers (`source_framework` / `import_provenance`) — a structural fact of being an import, not a self-declared label.

2. **The importer's Rule 14 does not trust the foreign framework's claims** — the engine recomputes from named factors and disagrees on difference beyond the verifier-owned ceiling. The foreign claim is treated as suspect input, exactly as Randoop ([Pacheco et al. ICSE 2007](https://doi.org/10.1109/ICSE.2007.37)) and syzkaller treat their generators' outputs. Crucially, the *tolerance* of that comparison is also verifier-owned (clamped to `DIFFERENTIAL_TOLERANCE_CEILING`) — a sidecar cannot request a pass band wide enough to wave its own divergence through.

3. **The live PyTorch helper does not predict the verifier's verdict** — no field named `rule14_passed` / `verification_passed` / `expected_outcome` / `differential_passed`. The schema's `additionalProperties: false` enforces this — the helper would fail validation if it tried. Rule 14 owns the verdict.

## The Proof-of-Learning spoofing analog

[Fang et al. EuroS&P 2023 — "'Adversarial Examples' for Proof-of-Learning"](https://arxiv.org/abs/2208.03567) demonstrated that a producer with byte-control over the training trace can synthesize a structurally-valid Proof-of-Learning ([Jia et al. IEEE S&P 2021](https://arxiv.org/abs/2103.05633)) that satisfies every structural check yet was never the result of real training. The defense is **independent recomputation against an authority the producer doesn't control**, not richer self-attestation.

backprop-trace's Rule 14 IS that independent recomputation. The engine is the authority. The helper / framework / importer / sidecar are all suspect input — Rule 14 doesn't care what they claim.

This is what makes backprop-trace **complementary** to PoL, not a replacement: both are spoofable in isolation; combining them (PoL for the end-to-end weight-trajectory; backprop-trace for per-step structural consistency) covers more ground than either alone. Wrap a backprop-trace receipt in a [Sigstore](https://github.com/sigstore/model-transparency)-signed envelope and you've added producer authenticity to per-step structural consistency. That's three orthogonal claims.

## The forensic `helper` block (v0.7.0+)

When a sidecar comes from the live PyTorch helper, it carries a `helper` block with:

- `name`, `version`, `distribution` (closed enum: `repo-script | pypi | vendored`)
- `source_hash` — SHA-256 of the helper file bytes
- `framework` — name, version, optional commit
- `runtime` — python version, torch version, deterministic_mode (torch_use_deterministic_algorithms, cudnn_deterministic, cudnn_benchmark, seed)
- `extraction` — timestamp (ISO-8601), optional duration_ms, device (CPU / CUDA / MPS / XLA)

**This block is FORENSIC, not credential.** A wrong / spoofed / missing `source_hash` does NOT bypass Rule 14. The block exists for post-hoc attribution when Rule 14 disagrees — operators can pin which helper version produced the disagreeing sidecar. The block is reader-facing context, not gate logic.

The helper computes its own `source_hash` (it hashes the file it's running from). This is acceptable BECAUSE the hash is forensic. If it were credential, helper-self-hashing would be the Fang-class trap. Documented in the helper file's docstring + `docs/live-helpers.md`.

The **live JAX helper** (v1.0.0) adds one more forensic field to the block: a `jax.make_jaxpr(jax.grad(loss))` digest — the gradient computation graph PyTorch eager has no first-class equivalent for. It is forensic on exactly the same terms as `source_hash`: a spoofed or missing jaxpr does NOT bypass Rule 14; it enriches attribution when the differential disagrees. The JAX helper additionally refuses to run without `jax_enable_x64` + CPU, so a float32 or GPU sidecar fails loudly at the boundary rather than producing a receipt that would later trip the differential.

## Distribution integrity (v0.10.2+)

The tarball that ships to npm must actually carry what the repo claims exists. `scripts/pack-install-smoke.mjs` enforces this on every CI push across ubuntu + macos + windows:

- Tarball size ceiling (10 MB) — catches accidental bloat
- Required file presence — helper, examples, schemas v0.6.0+v0.7.0+receipt v0.7.0, three helper-emitted goldens, Mazur golden, adversarial fixtures
- Cold-install via `npm install <abs-tarball>` into `mkdtemp` — proves the package works from a fresh state
- CLI smoke against the installed copy — `bp --help`, `bp --version`, `bp examples pytorch`, `bp examples pytorch --print` (with HELPER_VERSION lockstep check), `bp verify mazur`, `bp import pytorch <installed-sidecar>`
- Pipe smoke via stdin + file roundtrip

This caught three real distribution-integrity bugs during v0.10.2 development. The slice's whole proposition — distribution integrity is a load-bearing trust property — earned it a permanent CI gate.

## Coordinated disclosure

See [SECURITY.md](https://github.com/mcp-tool-shop-org/backprop-trace/blob/main/SECURITY.md) for the disclosure timeline (90-day standard), severity rubric, and the supported-versions table.

If you find a way to construct a receipt that backprop-trace ACCEPTS but should reject — schema bypass, NaN/Infinity poisoning, canonical-emission divergence, anti-circularity violation (reconciler consulting fixture_status before completing rule checks), engine-recompute disagreement that Rule 14 missed, a tolerance window exploited to pass a meaningful error, an import that dodges Rule 14, a self-declared skip treated as a pass, or an incomplete update set that passes — that's the in-scope vulnerability class. The five false-PASS holes v0.12.0 closed are exactly this class; an adversarial audit found them, and the bounty for more is open. Open an issue or email per SECURITY.md.

## Compliance, honestly scoped (v1.0.0)

v1.0.0 ships a worked [compliance audit bundle](https://github.com/mcp-tool-shop-org/backprop-trace/blob/main/docs/compliance.md) showing how a receipt functions as one evidence artifact inside an ML compliance bundle — and, just as important, what it does **not** attest. The honest mapping:

- **EU AI Act Annex IV §2(g)** (test logs, dated/signed) — *primary fit.* A receipt **is** a machine-checkable test log of one training step's math; `bp verify` is the re-run; canonical bytes are signable/datable.
- **Annex IV §2(b)** (general algorithmic logic) and **Article 15** (accuracy & robustness, resilience to error/tamper) — *strong fit.* The 26 rules document the exact optimizer recurrence; the adversarial verifier rejects tampered receipts before reading status metadata.
- **Article 10** (data & data governance) — **out of scope.** A receipt attests *math*, not data quality or provenance. Do not claim Article 10 coverage.

A receipt is the numerical-consistency leaf of a compliance tree; it composes *below* model-signing (SLSA-for-ML / Sigstore), it does not replace it. The bundle uses the hero classifier fixture as its worked example and pins the canonical bytes into an in-toto v1 statement.

## Next steps

- **Architecture in depth** → [Architecture](../architecture/)
- **Live PyTorch + JAX helper trust statements (verbatim with full citations)** → [`docs/live-helpers.md`](https://github.com/mcp-tool-shop-org/backprop-trace/blob/main/docs/live-helpers.md)
- **The worked compliance bundle** → [`docs/compliance.md`](https://github.com/mcp-tool-shop-org/backprop-trace/blob/main/docs/compliance.md)
