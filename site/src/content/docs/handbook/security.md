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
2. Every numerical claim in the receipt is internally consistent — the named factors recompute the claimed value within hybrid tolerance
3. For observer-mode receipts (imported from a foreign framework via `bp import`), the engine independently recomputes the step from the sidecar's named factors and AGREES within differential tolerance (Rule 14)
4. For multi-step bundles, the parameter chain is intact (Rule 9) and the trace identity is consistent (Rule 10)
5. For helper-emitted sidecars, the helper's `helper` block is structurally valid — name, version, source_hash, framework info, runtime info, extraction timestamp all present and well-typed

That's all. It's a strong claim about **per-step structural consistency** under deterministic CPU.

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

1. **The reconciler does not read `fixture_status`** — the receipt's lifecycle metadata (authoring_state, verification_state, canonical) is operator-facing only. Reading it to decide whether to reject would let an attacker bypass the verifier by mutating one metadata field. Every bad fixture must be reject-by-math.

2. **The importer's Rule 14 does not trust the foreign framework's claims** — the engine recomputes from named factors and disagrees on bytewise difference. The foreign claim is treated as suspect input, exactly as Randoop ([Pacheco et al. ICSE 2007](https://doi.org/10.1109/ICSE.2007.37)) and syzkaller treat their generators' outputs.

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

If you find a way to construct a receipt that backprop-trace ACCEPTS but should reject — schema bypass, NaN/Infinity poisoning, canonical-emission divergence, anti-circularity violation (reconciler consulting fixture_status before completing rule checks), engine-recompute disagreement that Rule 14 missed — that's the in-scope vulnerability class. Open an issue or email per SECURITY.md.

## Next steps

- **Architecture in depth** → [Architecture](../architecture/)
- **Live PyTorch helper trust statement (verbatim with full citations)** → [`docs/live-helpers.md`](https://github.com/mcp-tool-shop-org/backprop-trace/blob/main/docs/live-helpers.md)
