# Security Policy

## Supported versions

Security fixes are issued for the current and previous minor releases.
Older versions are not supported — upgrade to a supported line.

| Version | Supported |
|---------|-----------|
| 0.7.x   | yes (current)         |
| 0.6.x   | yes (previous minor)  |
| 0.5.x   | best-effort           |
| < 0.5   | no                    |

backprop-trace remains pre-v1.0 — see the README "What's not in this version
(yet)" section for the product-completeness gaps that block v1.0.0 promotion
(multi-step observer-mode, Adam/AdamW, batching, live framework helpers,
real-world fixtures, adopter validation). Versions and the supported window
will be re-anchored at v1.0.0 release.

## Reporting a vulnerability

Open a GitHub Security Advisory at:

https://github.com/mcp-tool-shop-org/backprop-trace/security/advisories

Please do **not** open a public issue for security findings until a fix has shipped.

## In-scope

backprop-trace is a verifier. A security finding is anything that causes a receipt to be accepted when it should be rejected. Specifically:

- **NaN poisoning** — a receipt whose stored numbers contain `NaN` (or `Infinity`) and would silently pass reconciliation because the tolerance comparison reads `NaN > tol` as `false`.
- **Schema bypass** — a receipt with unknown keys, missing required fields, or wrong-typed fields that nonetheless reaches the reconciler.
- **Canonical-emission divergence** — on a supported platform, producing non-byte-equal output for the same input from two runs of the same engine version.
- **Anti-circularity violation** — the reconciler consulting `fixture_status` lifecycle metadata before completing rule checks, allowing a deliberately-broken receipt to pass solely because it self-declares as broken.

## Out-of-scope

- **Supply-chain attacks on npm** — handled by npm provenance (Sigstore/Rekor) on every published version. Verify with `npm view @mcptoolshop/backprop-trace dist.signatures`.
- **`Math.exp` drift on unsupported Node majors** — `engines` field pins the supported Node major. Running on an out-of-pin Node is unsupported and may produce different doubles in the last few ULPs.
- **Cross-engine portability** (Hermes, JSC, Bun-JSC) — explicitly not in v0.1's verifier surface. Receipts generated on V8/Node 22 may not byte-equal under another engine; this is a documented scope limitation, not a vulnerability.

## Disclosure timeline

Standard 90-day disclosure window from initial private report to public advisory. Coordinated disclosure preferred; faster timelines negotiable for actively-exploited findings.
