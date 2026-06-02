# Security Policy

## Supported versions

Security fixes are issued for the current and previous minor releases.
Older versions are not supported — upgrade to a supported line.

| Version | Supported |
|---------|-----------|
| 0.12.x  | yes (current)         |
| 0.11.x  | yes (previous minor)  |
| 0.10.x  | best-effort           |
| < 0.10  | no                    |

backprop-trace remains pre-v1.0 — see the README "What's not in this version
(yet)" section for the product-completeness gaps that block v1.0.0 promotion.
Most of the earlier gaps have since shipped (multi-step observer-mode,
Adam/AdamW + SGD momentum, batching, the PyTorch live helper); the remaining
v1.0 blockers are a **real-world hero fixture** (a tiny conv→ReLU→dense net)
and **adopter validation**. Versions and the supported window will be
re-anchored at v1.0.0 release.

## Reporting a vulnerability

Open a GitHub Security Advisory at:

https://github.com/mcp-tool-shop-org/backprop-trace/security/advisories

Please do **not** open a public issue for security findings until a fix has shipped.

## In-scope

backprop-trace is a verifier. A security finding is anything that causes a receipt to be accepted when it should be rejected. Specifically:

- **NaN poisoning** — a receipt whose stored numbers contain `NaN` (or `Infinity`) and would silently pass reconciliation because the tolerance comparison reads `NaN > tol` as `false`.
- **Schema bypass** — a receipt with unknown keys, missing required fields, or wrong-typed fields that nonetheless reaches the reconciler.
- **Canonical-emission divergence** — on a supported platform, producing non-byte-equal output for the same input from two runs of the same engine version.
- **Anti-circularity violation** — the reconciler consulting `fixture_status` lifecycle metadata before completing rule checks, allowing a deliberately-broken receipt to pass solely because it self-declares as broken. This includes **provenance laundering**: a receipt carrying observer markers (`source_framework` / `attestor.import_provenance`) cannot dodge the Rule 14 engine-recompute differential by relabeling or stripping `fixture_status.authoring_state` — Rule 14 is gated on marker presence, not on the self-declared label.
- **Tolerance gaming** — a receipt declaring a loose `numeric_policy.tolerance` or `attestor.differential_tolerance` so the reconciler accepts incorrect math. The verifier **owns** the effective tolerance: declared values are clamped to verifier maxima (numeric `atol ≤ 1e-8, rtol ≤ 1e-6`; differential `atol ≤ 1e-5, rtol ≤ 1e-3`) before any rule runs, and a receipt exceeding the ceiling is rejected (Rule 0). **Documented residual:** within the ceiling a deviation below the cap is accepted as within-tolerance — the numeric window (≈1e-6 relative) is sub-ppm; the differential window (≈1e-3 relative) is the inherent cross-framework FP-drift tradeoff (legitimate float32-vs-float64 recompute drift can reach ≈1e-4). The ceiling collapses the pre-v0.12 *unbounded* hole; it does not make the tolerance zero.

## Out-of-scope

- **Supply-chain attacks on npm** — releases published through CI (`release.yml`, OIDC Trusted Publishing) carry npm provenance (Sigstore/Rekor). **Caveat:** v0.11.0 was published locally and does **not** carry a provenance signature; v0.12.0+ are published via CI with provenance. Always verify the specific version you install with `npm view @mcptoolshop/backprop-trace@<version> dist.signatures` rather than assuming provenance is present.
- **`Math.exp` drift on unsupported Node majors** — `engines` field pins the supported Node major. Running on an out-of-pin Node is unsupported and may produce different doubles in the last few ULPs.
- **Cross-engine portability** (Hermes, JSC, Bun-JSC) — explicitly not in v0.1's verifier surface. Receipts generated on V8/Node 22 may not byte-equal under another engine; this is a documented scope limitation, not a vulnerability.

## Disclosure timeline

Standard 90-day disclosure window from initial private report to public advisory. Coordinated disclosure preferred; faster timelines negotiable for actively-exploited findings.
